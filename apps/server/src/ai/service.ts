import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { decryptSecret, encryptSecret } from '../crypto.js'
import { pool } from '../db.js'
import { readReceiptBytes } from '../storage.js'
import { GeminiAdapter, GEMINI_DEFAULT_MODEL } from './gemini.js'
import { LocalOpenAiAdapter, localAiConfigured } from './local.js'
import { TesseractAdapter } from './tesseract.js'
import { ExtractionError, type AiMode, type Extraction, type ReceiptAiAdapter } from './types.js'

/**
 * Provider selection and the automatic local → Gemini fallback chain.
 * One bounded attempt per provider per job; no retry loops here.
 */

export interface EffectiveAiConfig {
  mode: AiMode
  local: { baseUrl: string; model: string; apiKey: string | null }
  gemini: { model: string; apiKey: string | null; keySource: 'saved' | 'environment' | 'none' }
  timeoutMs: number
}

interface AdapterSet {
  local?: ReceiptAiAdapter
  gemini?: ReceiptAiAdapter
  tesseract?: ReceiptAiAdapter
}

/** Real adapter construction; tests replace the whole set via setAdaptersForTesting. */
function defaultAdapterFactory(cfg: EffectiveAiConfig): AdapterSet {
  const set: AdapterSet = {}
  if (cfg.local.baseUrl && cfg.local.model)
    set.local = new LocalOpenAiAdapter({ baseUrl: cfg.local.baseUrl, model: cfg.local.model, apiKey: cfg.local.apiKey ?? undefined, timeoutMs: cfg.timeoutMs })
  if (cfg.gemini.apiKey)
    set.gemini = new GeminiAdapter({ model: cfg.gemini.model, apiKey: cfg.gemini.apiKey, timeoutMs: cfg.timeoutMs })
  set.tesseract = new TesseractAdapter()
  return set
}

let adapterFactory: (cfg: EffectiveAiConfig) => AdapterSet = defaultAdapterFactory
export function setAdaptersForTesting(factory: ((cfg: EffectiveAiConfig) => AdapterSet) | null): void {
  adapterFactory = factory ?? defaultAdapterFactory
}

const VALID_MODES: AiMode[] = ['auto', 'local', 'gemini', 'tesseract']

export async function resolveAiConfig(organizerId: string): Promise<EffectiveAiConfig> {
  const { rows } = await pool.query('select mode, gemini_model, gemini_key_encrypted from organizer_ai_setting where organizer_id = $1', [
    organizerId,
  ])
  const saved = rows[0] as { mode: AiMode | null; gemini_model: string | null; gemini_key_encrypted: string | null } | undefined
  const mode = saved?.mode && VALID_MODES.includes(saved.mode) ? saved.mode : (config.receiptAiMode as AiMode)

  let savedKey: string | null = null
  let savedKeyBroken = false
  if (saved?.gemini_key_encrypted) {
    try {
      savedKey = decryptSecret(saved.gemini_key_encrypted)
    } catch {
      savedKeyBroken = true // rotated CREDENTIALS_SECRET or corrupt row — re-prompt via settings
    }
  }
  const gemini: EffectiveAiConfig['gemini'] = savedKey
    ? { model: saved?.gemini_model || config.geminiModel || GEMINI_DEFAULT_MODEL, apiKey: savedKey, keySource: 'saved' }
    : config.geminiApiKey
      ? { model: saved?.gemini_model || config.geminiModel || GEMINI_DEFAULT_MODEL, apiKey: config.geminiApiKey, keySource: 'environment' }
      : { model: saved?.gemini_model || config.geminiModel || GEMINI_DEFAULT_MODEL, apiKey: null, keySource: savedKeyBroken ? 'saved' : 'none' }

  return {
    mode,
    local: { baseUrl: config.localAiBaseUrl, model: config.localAiModel, apiKey: config.localAiApiKey || null },
    gemini,
    timeoutMs: config.receiptAiTimeoutMs,
  }
}

/** Which providers the mode allows, and whether each one is usable. */
function planChain(cfg: EffectiveAiConfig): { name: 'local' | 'gemini' | 'tesseract'; skipReason?: string; skipKind?: 'credentials' | 'unavailable' }[] {
  const localOk = localAiConfigured(cfg.local)
  const geminiOk = cfg.gemini.apiKey !== null
  switch (cfg.mode) {
    case 'local':
      return [{ name: 'local', ...(localOk ? {} : { skipReason: 'local AI endpoint/model not configured on this server', skipKind: 'unavailable' as const }) }]
    case 'gemini':
      return [{ name: 'gemini', ...(geminiOk ? {} : { skipReason: 'no Gemini API key configured', skipKind: 'credentials' as const }) }]
    case 'tesseract':
      return [{ name: 'tesseract' }]
    case 'auto':
    default: {
      const chain: { name: 'local' | 'gemini' | 'tesseract'; skipReason?: string; skipKind?: 'credentials' | 'unavailable' }[] = []
      if (localOk) chain.push({ name: 'local' })
      else chain.push({ name: 'local', skipReason: 'local AI not configured; cloud fallback allowed by auto mode', skipKind: 'unavailable' })
      chain.push({ name: 'gemini', ...(geminiOk ? {} : { skipReason: 'no Gemini API key configured', skipKind: 'credentials' as const }) })
      return chain
    }
  }
}

interface AttemptTrace {
  provider: string
  outcome: 'skipped' | 'failed'
  kind: string
  message: string
}

function traceSummary(trace: AttemptTrace[]): string {
  return trace.map((t) => `${t.provider}: ${t.outcome} (${t.kind}) ${t.message}`.trim()).join('; ').slice(0, 600)
}

/**
 * Run one extraction job for a receipt. Claiming the row keeps retries and
 * fallback from ever running concurrently or producing duplicate work.
 */
export async function runExtractionJob(receiptId: string): Promise<void> {
  const claim = await pool.query(
    `update receipt set status = 'processing', updated_at = now()
      where id = $1 and status in ('pending', 'failed')
      returning id, organizer_id, storage_key, content_type`,
    [receiptId],
  )
  const row = claim.rows[0] as { id: string; organizer_id: string; storage_key: string; content_type: string } | undefined
  if (!row) return // another job holds it, or it is already extracted/confirmed

  const fail = async (kind: string, message: string, fallbackReason: string | null) => {
    await pool.query(
      `update receipt set status = 'failed', error_kind = $2, processing_error = $3,
         fallback_reason = coalesce($4, fallback_reason), processed_at = now(), updated_at = now()
       where id = $1`,
      [receiptId, kind, message.slice(0, 400), fallbackReason],
    )
  }

  let cfg: EffectiveAiConfig
  try {
    cfg = await resolveAiConfig(row.organizer_id)
  } catch (err) {
    await fail('internal', `settings lookup failed: ${(err as Error).message}`, null)
    return
  }

  const adapters = adapterFactory(cfg)
  const image = { bytes: await readReceiptBytes(row.storage_key), mimeType: row.content_type }
  const trace: AttemptTrace[] = []

  for (const step of planChain(cfg)) {
    if (step.skipReason) {
      trace.push({ provider: step.name, outcome: 'skipped', kind: step.skipKind!, message: step.skipReason })
      continue
    }
    const adapter = adapters[step.name]
    if (!adapter) {
      trace.push({ provider: step.name, outcome: 'skipped', kind: 'unavailable', message: 'adapter unavailable' })
      continue
    }
    try {
      const extraction = await adapter.extract(image)
      await pool.query(
        `update receipt set status = 'extracted', extraction = $2, provider_used = $3,
           fallback_reason = $4, error_kind = null, processing_error = null,
           processed_at = now(), updated_at = now()
         where id = $1`,
        [receiptId, JSON.stringify(extraction), step.name, trace.length ? traceSummary(trace) : null],
      )
      return
    } catch (err) {
      const e = err instanceof ExtractionError ? err : new ExtractionError('internal', (err as Error)?.message ?? 'unexpected error')
      trace.push({ provider: step.name, outcome: 'failed', kind: e.kind, message: e.message })
    }
  }

  // Every provider skipped or failed: keep the receipt and its image intact.
  const last = trace[trace.length - 1]
  const blockedOnCredentials = last?.kind === 'credentials'
  const message = blockedOnCredentials
    ? 'no provider available — configure a Gemini API key in AI settings, then retry'
    : (last?.message ?? 'receipt extraction failed')
  await fail(last?.kind ?? 'internal', message, traceSummary(trace))
}

/** Fire-and-forget after the HTTP response; jobs are claimed per receipt row. */
export function enqueueExtraction(receiptId: string): void {
  setImmediate(() => {
    void runExtractionJob(receiptId).catch((err) => console.error(`receipt extraction job ${receiptId} crashed:`, err))
  })
}

/** Crash recovery: nothing should stay 'processing' after a restart. */
export async function recoverStuckReceipts(): Promise<number> {
  const { rowCount } = await pool.query(
    `update receipt set status = 'failed', error_kind = 'internal',
       processing_error = 'processing interrupted by server restart — retry'
     where status = 'processing'`,
  )
  return rowCount ?? 0
}

/* ---------- Organizer settings (masked; plaintext keys never returned) ---------- */

export interface MaskedAiSettings {
  mode: AiMode
  modeOverride: AiMode | null
  envDefaultMode: AiMode
  local: { configured: boolean; baseUrl: string | null; model: string | null }
  gemini: { configured: boolean; model: string; keySource: 'saved' | 'environment' | 'none' }
  timeoutMs: number
}

export async function getMaskedSettings(organizerId: string): Promise<MaskedAiSettings> {
  const { rows } = await pool.query('select mode, gemini_model, gemini_key_encrypted from organizer_ai_setting where organizer_id = $1', [
    organizerId,
  ])
  const saved = rows[0] as { mode: AiMode | null; gemini_model: string | null; gemini_key_encrypted: string | null } | undefined
  const keySource: MaskedAiSettings['gemini']['keySource'] = saved?.gemini_key_encrypted
    ? 'saved'
    : config.geminiApiKey
      ? 'environment'
      : 'none'
  return {
    mode: (saved?.mode && VALID_MODES.includes(saved.mode) ? saved.mode : config.receiptAiMode) as AiMode,
    modeOverride: saved?.mode ?? null,
    envDefaultMode: config.receiptAiMode as AiMode,
    local: {
      configured: localAiConfigured({ baseUrl: config.localAiBaseUrl, model: config.localAiModel }),
      baseUrl: config.localAiBaseUrl || null,
      model: config.localAiModel || null,
    },
    gemini: {
      configured: keySource !== 'none',
      model: saved?.gemini_model || config.geminiModel || GEMINI_DEFAULT_MODEL,
      keySource,
    },
    timeoutMs: config.receiptAiTimeoutMs,
  }
}

export async function updateSettings(
  organizerId: string,
  patch: { mode?: AiMode | null; geminiModel?: string | null; geminiApiKey?: string | null },
): Promise<void> {
  await pool.query(
    `insert into organizer_ai_setting (organizer_id, mode, gemini_model, gemini_key_encrypted, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (organizer_id) do update set
       mode = coalesce(excluded.mode, organizer_ai_setting.mode),
       gemini_model = coalesce(excluded.gemini_model, organizer_ai_setting.gemini_model),
       updated_at = now()`,
    [organizerId, patch.mode ?? null, patch.geminiModel ?? null, patch.geminiApiKey ? encryptSecret(patch.geminiApiKey) : null],
  )
  // Explicit removals (null in the request) must clear the column, and the
  // upsert above intentionally never nulls existing values.
  if (patch.mode === null || patch.geminiModel === null || patch.geminiApiKey === null) {
    await pool.query(
      `update organizer_ai_setting set
         mode = case when $2 then null else mode end,
         gemini_model = case when $3 then null else gemini_model end,
         gemini_key_encrypted = case when $4 then null else gemini_key_encrypted end,
         updated_at = now()
       where organizer_id = $1`,
      [organizerId, patch.mode === null, patch.geminiModel === null, patch.geminiApiKey === null],
    )
  }
}

export async function testConnection(organizerId: string, provider: 'local' | 'gemini'): Promise<{ ok: boolean; error?: string; kind?: string }> {
  const cfg = await resolveAiConfig(organizerId)
  try {
    if (provider === 'local') {
      if (!localAiConfigured(cfg.local)) return { ok: false, error: 'local endpoint/model not configured on this server (operator setting)', kind: 'unavailable' }
      await new LocalOpenAiAdapter({ ...cfg.local, apiKey: cfg.local.apiKey ?? undefined, timeoutMs: cfg.timeoutMs }).probe()
    } else {
      if (!cfg.gemini.apiKey) return { ok: false, error: 'no Gemini API key configured', kind: 'credentials' }
      await new GeminiAdapter({ model: cfg.gemini.model, apiKey: cfg.gemini.apiKey, timeoutMs: cfg.timeoutMs }).probe()
    }
    return { ok: true }
  } catch (err) {
    if (err instanceof ExtractionError) return { ok: false, error: err.message, kind: err.kind }
    return { ok: false, error: (err as Error)?.message ?? 'test failed', kind: 'internal' }
  }
}

export const newReceiptId = randomUUID
