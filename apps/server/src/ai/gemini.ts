import { EXTRACTION_SYSTEM_PROMPT } from './prompt.js'
import { classifyFetchError, classifyHttpError, sanitizeProviderMessage } from './errors.js'
import { extractJsonObject, parseExtraction } from './validate.js'
import { ExtractionError, type ReceiptAiAdapter, type ReceiptImage } from './types.js'

/**
 * Gemini Flash adapter (image input). The model ID is always configuration,
 * never hardcoded in business logic. Default verified 2026-11-03:
 * gemini-3.6-flash — stable Flash with image input (2.5-flash is deprecated).
 */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.6-flash'

export interface GeminiConfig {
  model: string
  apiKey: string
  timeoutMs: number
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com'

export class GeminiAdapter implements ReceiptAiAdapter {
  readonly name = 'gemini'

  constructor(private cfg: GeminiConfig) {}

  async extract(image: ReceiptImage): Promise<import('./types.js').Extraction> {
    const url = `${GEMINI_BASE}/v1beta/models/${encodeURIComponent(this.cfg.model)}:generateContent`
    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: EXTRACTION_SYSTEM_PROMPT + '\n\n---\nNow extract the attached receipt image.' },
            { inline_data: { mime_type: image.mimeType, data: image.bytes.toString('base64') } },
          ],
        },
      ],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.cfg.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      })
    } catch (err) {
      throw classifyFetchError(err, 'Gemini')
    }
    if (!res.ok) throw classifyHttpError(res.status, await res.text().catch(() => ''), 'Gemini')
    const data = (await res.json().catch(() => null)) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
      promptFeedback?: { blockReason?: string }
    } | null
    if (data?.promptFeedback?.blockReason)
      throw new ExtractionError('invalid', `Gemini: content blocked (${sanitizeProviderMessage(data.promptFeedback.blockReason)})`)
    const candidate = data?.candidates?.[0]
    if (candidate?.finishReason === 'MAX_TOKENS')
      throw new ExtractionError('invalid', 'Gemini: response truncated')
    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    if (!text.trim()) throw new ExtractionError('invalid', 'Gemini: no text content in response')
    return parseExtraction(extractJsonObject(text))
  }

  /** Key-validating probe via the models list endpoint (no generation cost). */
  async probe(): Promise<void> {
    const url = `${GEMINI_BASE}/v1beta/models?pageSize=1`
    let res: Response
    try {
      res = await fetch(url, { headers: { 'x-goog-api-key': this.cfg.apiKey }, signal: AbortSignal.timeout(this.cfg.timeoutMs) })
    } catch (err) {
      throw classifyFetchError(err, 'Gemini')
    }
    if (!res.ok) throw classifyHttpError(res.status, await res.text().catch(() => ''), 'Gemini')
  }
}
