import { EXTRACTION_SYSTEM_PROMPT } from './prompt.js'
import { classifyFetchError, classifyHttpError } from './errors.js'
import { extractJsonObject, parseExtraction } from './validate.js'
import { ExtractionError, type ReceiptAiAdapter, type ReceiptImage } from './types.js'

/** OpenAI-compatible chat-completions adapter for the local vision server. */
export interface LocalAiConfig {
  baseUrl: string // e.g. http://192.168.18.100:11234/v1
  model: string
  apiKey?: string
  timeoutMs: number
}

export function localAiConfigured(cfg: Pick<LocalAiConfig, 'baseUrl' | 'model'>): boolean {
  return !!cfg.baseUrl && !!cfg.model
}

function authHeaders(cfg: LocalAiConfig): Record<string, string> {
  return cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}
}

export class LocalOpenAiAdapter implements ReceiptAiAdapter {
  readonly name = 'local'

  constructor(private cfg: LocalAiConfig) {}

  async extract(image: ReceiptImage): Promise<import('./types.js').Extraction> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`
    const body = {
      model: this.cfg.model,
      temperature: 0,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract this receipt.' },
            { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.bytes.toString('base64')}` } },
          ],
        },
      ],
    }
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(this.cfg) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      })
    } catch (err) {
      throw classifyFetchError(err, 'local AI')
    }
    if (!res.ok) throw classifyHttpError(res.status, await res.text().catch(() => ''), 'local AI')
    const data = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: unknown }; finish_reason?: string }[]
    } | null
    const choice = data?.choices?.[0]
    if (choice?.finish_reason === 'length')
      throw new ExtractionError('invalid', 'local AI: response truncated (raise max tokens or check model)')
    const content = choice?.message?.content
    if (typeof content !== 'string' || !content.trim())
      throw new ExtractionError('invalid', 'local AI: no text content in response')
    return parseExtraction(extractJsonObject(content))
  }

  /** Cheap connectivity/auth probe used by the settings "test connection". */
  async probe(): Promise<void> {
    const url = `${this.cfg.baseUrl.replace(/\/+$/, '')}/models`
    let res: Response
    try {
      res = await fetch(url, { headers: authHeaders(this.cfg), signal: AbortSignal.timeout(this.cfg.timeoutMs) })
    } catch (err) {
      throw classifyFetchError(err, 'local AI')
    }
    if (!res.ok) throw classifyHttpError(res.status, await res.text().catch(() => ''), 'local AI')
  }
}
