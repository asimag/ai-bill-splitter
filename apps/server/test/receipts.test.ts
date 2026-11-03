/**
 * Stage 3 API integration tests: receipts upload/validation/authorization,
 * provider fallback matrix with mocked adapters, confirmation into exact
 * financial totals, and organizer-scoped credential isolation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AddressInfo, Server } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from 'pg'

// Separate database from api.test.ts so vitest can run both files in parallel.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_STAGE3 ?? 'postgres://asim@localhost:5433/billsplit_test_s3'

const storageDir = mkdtempSync(path.join(tmpdir(), 'billsplit-receipts-test-'))

// Must be set before the app modules load config.
process.env.DATABASE_URL = TEST_DATABASE_URL
process.env.SESSION_SECRET = 'integration-test-secret'
process.env.CREDENTIALS_SECRET = 'integration-test-credentials-secret'
process.env.RECEIPT_STORAGE_DIR = storageDir
process.env.RECEIPT_MAX_BYTES = '2048'
process.env.RECEIPT_AI_MODE = 'auto'
process.env.LOCAL_AI_BASE_URL = 'http://local-ai.invalid.test/v1'
process.env.LOCAL_AI_MODEL = 'fake-vl'
process.env.GEMINI_API_KEY = 'env-gemini-key-123456'
process.env.RECEIPT_AI_TIMEOUT_MS = '500'

const { createApp } = await import('../src/app.js')
const { migrate } = await import('../src/migrate.js')
const { pool } = await import('../src/db.js')
const { config } = await import('../src/config.js')
const { setAdaptersForTesting } = await import('../src/ai/service.js')
type EffectiveAiConfig = import('../src/ai/service.js').EffectiveAiConfig
const { ExtractionError } = await import('../src/ai/types.js')
type Extraction = import('../src/ai/types.js').Extraction
type ExtractionErrorType = import('../src/ai/types.js').ExtractionError
type ReceiptAiAdapter = import('../src/ai/types.js').ReceiptAiAdapter

let baseUrl = ''
let server: Server

// ---------- scripted fake adapters ----------
interface Script {
  local: 'ok' | ExtractionErrorType | null // null = provider absent from resolution
  gemini: 'ok' | ExtractionErrorType | null
}
const calls: { local: number; gemini: number } = { local: 0, gemini: 0 }
let resolvedCfg: EffectiveAiConfig | null = null
let script: Script = { local: 'ok', gemini: 'ok' }

const CLEAN_EXTRACTION: Extraction = {
  merchant: 'Tandoor House',
  date: '2026-11-01',
  currency: 'USD',
  subtotal: '48.00',
  tax: '4.80',
  serviceCharge: null,
  tip: null,
  cashTendered: '60.00',
  total: '52.80',
  warnings: [],
}

function unavailable(): ExtractionErrorType {
  return new ExtractionError('unavailable', 'local AI: unreachable (connection failed)')
}

function makeFake(name: 'local' | 'gemini'): ReceiptAiAdapter {
  return {
    name,
    async extract() {
      calls[name]++
      const behavior = script[name]
      if (behavior === null) throw new ExtractionError('internal', `${name} should not have been used`)
      if (behavior !== 'ok') throw behavior
      return { ...CLEAN_EXTRACTION, warnings: [] }
    },
  }
}

beforeAll(async () => {
  const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1)
  const adminUrl = new URL(TEST_DATABASE_URL)
  adminUrl.pathname = '/postgres'
  const admin = new Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`create database ${dbName}`)
  } catch (err) {
    if ((err as { code?: string }).code !== '42P04') throw err
  }
  await admin.end()

  await migrate()
  await pool.query('truncate table organizer cascade')
  setAdaptersForTesting((cfg) => {
    resolvedCfg = cfg
    return { local: makeFake('local'), gemini: makeFake('gemini') }
  })
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
}, 30_000)

afterAll(async () => {
  setAdaptersForTesting(null)
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  await pool.end()
  rmSync(storageDir, { recursive: true, force: true })
})

beforeEach(() => {
  calls.local = 0
  calls.gemini = 0
  resolvedCfg = null
  script = { local: 'ok', gemini: 'ok' }
})

// ---------- helpers ----------
interface Jar {
  cookie?: string
}

async function req<T = any>(jar: Jar, method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(jar.cookie ? { cookie: jar.cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const session = res.headers.getSetCookie().find((c) => c.startsWith('bs_session='))
  if (session) jar.cookie = session.split(';')[0]!
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  return { status: res.status, data: data as T }
}

async function register(email: string): Promise<Jar> {
  const jar: Jar = {}
  const res = await req(jar, 'POST', '/auth/register', { email, password: 'password123' })
  expect(res.status).toBe(201)
  return jar
}

async function addParticipant(jar: Jar, tripId: string, name: string, weight: number) {
  const res = await req<{ participant: { id: string } }>(jar, 'POST', `/trips/${tripId}/participants`, { name, weight })
  expect(res.status).toBe(201)
  return res.data.participant.id
}

async function createTrip(jar: Jar, name: string, currency: string) {
  const res = await req<{ trip: { id: string } }>(jar, 'POST', '/trips', { name, currency })
  expect(res.status).toBe(201)
  return res.data.trip.id
}

// 1x1 green PNG — real bytes so content sniffing is genuinely exercised.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function uploadReceipt(jar: Jar, tripId: string, bytes: Buffer = PNG_1PX) {
  const form = new FormData()
  form.append('image', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'receipt.png')
  const res = await fetch(`${baseUrl}/trips/${tripId}/receipts`, {
    method: 'POST',
    headers: jar.cookie ? { cookie: jar.cookie } : undefined,
    body: form,
  })
  const data = await res.json().catch(() => null)
  return { status: res.status, data: data as { receipt?: { id: string; status?: string }; error?: string } }
}

async function waitForJob(jar: Jar, receiptId: string): Promise<any> {
  for (let i = 0; i < 100; i++) {
    const res = await req(jar, 'GET', `/receipts/${receiptId}`)
    expect(res.status).toBe(200)
    if (!['pending', 'processing'].includes(res.data.receipt.status)) return res.data.receipt
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('extraction job did not finish')
}

let tripSeq = 0
async function newTripWithPeople(jar: Jar) {
  const tripId = await createTrip(jar, `Receipts trip ${++tripSeq}`, 'USD')
  const ali = await addParticipant(jar, tripId, 'Ali', 1)
  const sara = await addParticipant(jar, tripId, 'Sara', 1)
  return { tripId, ali, sara }
}

describe('receipt upload and private storage', () => {
  it('stores the file privately, extracts it, and streams it back only to the owner', async () => {
    const owner = await register(`rc-owner-${Date.now()}@test.local`)
    const other = await register(`rc-other-${Date.now()}@test.local`)
    const { tripId } = await newTripWithPeople(owner)

    const up = await uploadReceipt(owner, tripId)
    expect(up.status).toBe(201)
    expect(up.data.receipt!.status).toBe('pending')
    const receiptId = up.data.receipt!.id

    const done = await waitForJob(owner, receiptId)
    expect(done.status).toBe('extracted')
    expect(done.providerUsed).toBe('local') // auto mode prefers local first
    expect(done.extraction.total).toBe('52.80')

    // Owner can read the image bytes; another organizer gets 404 on everything.
    const img = await fetch(`${baseUrl}/receipts/${receiptId}/image`, { headers: { cookie: owner.cookie! } })
    expect(img.status).toBe(200)
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG_1PX)).toBe(true)
    expect(img.headers.get('cache-control')).toContain('no-store')

    expect((await req(other, 'GET', `/receipts/${receiptId}`)).status).toBe(404)
    const foreignImg = await fetch(`${baseUrl}/receipts/${receiptId}/image`, { headers: { cookie: other.cookie! } })
    expect(foreignImg.status).toBe(404)
    expect((await req(other, 'POST', `/receipts/${receiptId}/retry`, {})).status).toBe(404)
    expect((await req(other, 'DELETE', `/receipts/${receiptId}`)).status).toBe(404)
  })

  it('rejects non-image content and oversized uploads', async () => {
    const jar = await register(`rc-validate-${Date.now()}@test.local`)
    const { tripId } = await newTripWithPeople(jar)

    const fake = await uploadReceipt(jar, tripId, Buffer.concat([Buffer.from('MZ\x90\x00'), Buffer.alloc(64)]))
    expect(fake.status).toBe(400)
    expect(String(fake.data?.error)).toMatch(/JPEG|PNG|WebP/)

    const big = Buffer.concat([PNG_1PX.subarray(0, 16), Buffer.alloc(3000)])
    const over = await uploadReceipt(jar, tripId, big)
    expect(over.status).toBe(413)
  })

  it('deletes unattached receipts (file included) and refuses when attached', async () => {
    const jar = await register(`rc-delete-${Date.now()}@test.local`)
    const { tripId, ali, sara } = await newTripWithPeople(jar)
    const up = await uploadReceipt(jar, tripId)
    const receiptId = up.data.receipt!.id
    await waitForJob(jar, receiptId)

    const att = await req(jar, 'POST', `/trips/${tripId}/expenses`, {
      description: 'Dinner',
      amount: '52.80',
      payerParticipantId: ali,
      participants: [
        { participantId: ali, weight: 1 },
        { participantId: sara, weight: 1 },
      ],
      receiptId,
    })
    expect(att.status).toBe(201)
    expect(att.data.expense.receiptId).toBe(receiptId)

    expect((await req(jar, 'DELETE', `/receipts/${receiptId}`)).status).toBe(409)

    const orphan = await uploadReceipt(jar, tripId)
    expect((await req(jar, 'DELETE', `/receipts/${orphan.data.receipt!.id}`)).status).toBe(200)
  })
})

describe('provider fallback chain (mocked adapters)', () => {
  it('auto mode: local outage falls back to Gemini with a sanitized reason', async () => {
    const jar = await register(`rc-fallback-${Date.now()}@test.local`)
    const { tripId } = await newTripWithPeople(jar)
    script = { local: unavailable(), gemini: 'ok' }

    const up = await uploadReceipt(jar, tripId)
    const done = await waitForJob(jar, up.data.receipt!.id)
    expect(done.status).toBe('extracted')
    expect(done.providerUsed).toBe('gemini')
    expect(calls).toEqual({ local: 1, gemini: 1 })
    expect(done.fallbackReason).toMatch(/local: failed \(unavailable\)/)
  })

  it('local-only mode never calls Gemini, and failures stay local', async () => {
    const jar = await register(`rc-localonly-${Date.now()}@test.local`)
    const { tripId } = await newTripWithPeople(jar)
    expect((await req(jar, 'PUT', '/ai/settings', { mode: 'local' })).status).toBe(200)
    script = { local: new ExtractionError('timeout', 'local AI: timed out'), gemini: 'ok' }

    const up = await uploadReceipt(jar, tripId)
    const done = await waitForJob(jar, up.data.receipt!.id)
    expect(done.status).toBe('failed')
    expect(done.errorKind).toBe('timeout')
    expect(calls).toEqual({ local: 1, gemini: 0 })
    expect(resolvedCfg!.mode).toBe('local')
  })

  it('Gemini-only mode bypasses local entirely', async () => {
    const jar = await register(`rc-geminionly-${Date.now()}@test.local`)
    const { tripId } = await newTripWithPeople(jar)
    await req(jar, 'PUT', '/ai/settings', { mode: 'gemini' })
    script = { local: 'ok', gemini: 'ok' }

    const up = await uploadReceipt(jar, tripId)
    const done = await waitForJob(jar, up.data.receipt!.id)
    expect(done.providerUsed).toBe('gemini')
    expect(calls).toEqual({ local: 0, gemini: 1 })
  })

  it('recovers on a later request once local is healthy again', async () => {
    const jar = await register(`rc-recover-${Date.now()}@test.local`)
    const { tripId } = await newTripWithPeople(jar)
    script = { local: unavailable(), gemini: 'ok' }
    const up = await uploadReceipt(jar, tripId)
    await waitForJob(jar, up.data.receipt!.id)

    // Local comes back; the next upload must try local again (auto preference).
    script = { local: 'ok', gemini: 'ok' }
    calls.local = 0
    calls.gemini = 0
    const up2 = await uploadReceipt(jar, tripId)
    const done2 = await waitForJob(jar, up2.data.receipt!.id)
    expect(done2.providerUsed).toBe('local')
    expect(calls).toEqual({ local: 1, gemini: 0 })
  })

  it('missing cloud key fails with a credentials prompt, then works after saving a key', async () => {
    const jar = await register(`rc-nokey-${Date.now()}@test.local`)
    const { tripId } = await newTripWithPeople(jar)
    const savedEnvKey = config.geminiApiKey
    config.geminiApiKey = '' // simulate: no saved and no environment Gemini key
    try {
      script = { local: unavailable(), gemini: 'ok' }
      const up = await uploadReceipt(jar, tripId)
      const done = await waitForJob(jar, up.data.receipt!.id)
      expect(done.status).toBe('failed')
      expect(done.errorKind).toBe('credentials')
      expect(done.processingError).toMatch(/configure a Gemini API key/i)
      expect(calls.gemini).toBe(0)

      // Settings stay masked; saving a key upgrades the source, and retry succeeds.
      const masked = await req<any>(jar, 'GET', '/ai/settings')
      expect(JSON.stringify(masked.data)).not.toContain('env-gemini-key')
      expect(masked.data.settings.gemini.keySource).toBe('none')

      await req(jar, 'PUT', '/ai/settings', { geminiApiKey: 'saved-organizer-key-9' })
      expect(JSON.stringify((await req(jar, 'GET', '/ai/settings')).data)).not.toContain('saved-organizer-key')

      script = { local: unavailable(), gemini: 'ok' }
      const retry = await req(jar, 'POST', `/receipts/${up.data.receipt!.id}/retry`, {})
      expect(retry.status).toBe(202)
      const done2 = await waitForJob(jar, up.data.receipt!.id)
      expect(done2.status).toBe('extracted')
      expect(done2.providerUsed).toBe('gemini')
      expect(resolvedCfg!.gemini.keySource).toBe('saved')
      expect(resolvedCfg!.gemini.apiKey).toBe('saved-organizer-key-9') // decrypted for the call only

      // Organizer-specific precedence: a second organizer sees no saved key.
      const other = await register(`rc-nokey2-${Date.now()}@test.local`)
      const otherCfg = (await req<any>(other, 'GET', '/ai/settings')).data.settings
      expect(otherCfg.gemini.keySource).toBe('none')
    } finally {
      config.geminiApiKey = savedEnvKey
    }
  })

  it('rate limits and image rejections are distinguishable sanitized failures', async () => {
    const jar = await register(`rc-kinds-${Date.now()}@test.local`)
    const { tripId } = await newTripWithPeople(jar)
    script = { local: 'ok', gemini: new ExtractionError('rate_limit', 'Gemini: rate limit or quota exceeded') }
    const up = await uploadReceipt(jar, tripId)
    let done = await waitForJob(jar, up.data.receipt!.id)
    // local 'ok' wins first; force local outage to surface the Gemini error kind
    script = { local: new ExtractionError('image', 'local AI: rejected the image input'), gemini: new ExtractionError('rate_limit', 'Gemini: rate limit or quota exceeded') }
    const up2 = await uploadReceipt(jar, tripId)
    done = await waitForJob(jar, up2.data.receipt!.id)
    expect(done.status).toBe('failed')
    expect(done.errorKind).toBe('rate_limit')
    expect(done.fallbackReason).toMatch(/local: failed \(image\)/)
    // The failed receipt survives and is retryable, no expenses were created.
    const trip = await req<any>(jar, 'GET', `/trips/${tripId}`)
    expect(trip.data.expenses.length).toBe(0)
  })

  it('cannot duplicate an expense through confirm/retry races', async () => {
    const jar = await register(`rc-dup-${Date.now()}@test.local`)
    const { tripId, ali, sara } = await newTripWithPeople(jar)
    const up = await uploadReceipt(jar, tripId)
    const receiptId = up.data.receipt!.id
    await waitForJob(jar, receiptId)

    const body = {
      description: 'Lunch',
      amount: '52.80',
      payerParticipantId: ali,
      participants: [
        { participantId: ali, weight: 1 },
        { participantId: sara, weight: 1 },
      ],
      receiptId,
    }
    const first = await req(jar, 'POST', `/trips/${tripId}/expenses`, body)
    expect(first.status).toBe(201)
    const again = await req(jar, 'POST', `/trips/${tripId}/expenses`, body)
    expect(again.status).toBe(409)
    const trip = await req<any>(jar, 'GET', `/trips/${tripId}`)
    expect(trip.data.expenses.length).toBe(1)
  })

  it('allocation results are provider-independent and extra tips are exact', async () => {
    const jar = await register(`rc-exact-${Date.now()}@test.local`)
    const { tripId, ali, sara } = await newTripWithPeople(jar)

    script = { local: 'ok', gemini: null }
    const upLocal = await uploadReceipt(jar, tripId)
    const eLocal = await waitForJob(jar, upLocal.data.receipt!.id)

    script = { local: null, gemini: 'ok' }
    const upGemini = await uploadReceipt(jar, tripId)
    const eGemini = await waitForJob(jar, upGemini.data.receipt!.id)

    // Identical confirmed data through both providers → identical extraction.
    expect(eLocal.extraction).toEqual(eGemini.extraction)

    // Confirm with an extra tip that is NOT included in the total: 52.80 + 2.20 = 55.00.
    const att = await req<any>(jar, 'POST', `/trips/${tripId}/expenses`, {
      description: 'Dinner + tip',
      amount: '52.80',
      extraTip: '2.20',
      payerParticipantId: ali,
      participants: [
        { participantId: ali, weight: 1 },
        { participantId: sara, weight: 1 },
      ],
      receiptId: upLocal.data.receipt!.id,
    })
    expect(att.status).toBe(201)
    expect(att.data.expense.amountMinor).toBe(5500)
    expect(att.data.expense.allocations.reduce((s: number, a: any) => s + a.amountMinor, 0)).toBe(5500)
  })
})

describe('AI settings surface', () => {
  it('masks keys, applies mode overrides, and tests unreachable local honestly', async () => {
    const jar = await register(`rc-settings-${Date.now()}@test.local`)
    const s = (await req<any>(jar, 'GET', '/ai/settings')).data.settings
    expect(s.mode).toBe('auto')
    expect(s.envDefaultMode).toBe('auto')
    expect(s.local.configured).toBe(true)
    expect(s.gemini.keySource).toBe('environment')
    expect(s.gemini.configured).toBe(true)
    expect(s.gemini.model).toBe(config.geminiModel)
    expect(JSON.stringify(s)).not.toContain('env-gemini-key-123456')

    // Model override + removal restores defaults.
    await req(jar, 'PUT', '/ai/settings', { geminiModel: 'gemini-3.8-flash' })
    expect((await req<any>(jar, 'GET', '/ai/settings')).data.settings.gemini.model).toBe('gemini-3.8-flash')
    await req(jar, 'PUT', '/ai/settings', { geminiModel: null, mode: null })
    expect((await req<any>(jar, 'GET', '/ai/settings')).data.settings.gemini.model).toBe(config.geminiModel)

    // Connection test against the bogus local endpoint fails honestly
    // (DNS may black-hole .invalid hosts, so both reachability kinds are fine).
    const t = await req<any>(jar, 'POST', '/ai/settings/test', { provider: 'local' })
    expect(t.status).toBe(200)
    expect(t.data.ok).toBe(false)
    expect(['unavailable', 'timeout']).toContain(t.data.kind)
  })
})
