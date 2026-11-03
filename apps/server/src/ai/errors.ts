import { ExtractionError, type ExtractionErrorKind } from './types.js'

/** Keep provider detail short and single-line; never log/echo API keys. */
export function sanitizeProviderMessage(raw: string, max = 200): string {
  const line = raw.replace(/\s+/g, ' ').trim()
  // Drop anything that could look like a bearer/api key fragment.
  const scrubbed = line.replace(/\b[A-Za-z0-9_\-]{32,}\b/g, '[redacted]')
  return scrubbed.length > max ? `${scrubbed.slice(0, max)}…` : scrubbed
}

const CREDENTIALS_RE = /api[\s_-]?key|apikey|auth|unauthorized|permission|denied|forbidden|invalid.*(token|credential)/i
const RATE_LIMIT_RE = /rate.?limit|quota|too many|resource.?exhausted|throttl/i
const IMAGE_RE = /image|vision|modalit|multimodal|inline.?data|unsupported.*(media|format)/i

/** Map a provider HTTP failure to a sanitized ExtractionError. */
export function classifyHttpError(status: number, bodyText: string, provider: string): ExtractionError {
  const msg = sanitizeProviderMessage(bodyText) || `HTTP ${status}`
  if (status === 401 || status === 403 || (status === 400 && CREDENTIALS_RE.test(bodyText)))
    return new ExtractionError('credentials', `${provider}: authentication failed (${msg})`)
  if (status === 429 || RATE_LIMIT_RE.test(bodyText))
    return new ExtractionError('rate_limit', `${provider}: rate limit or quota exceeded (${msg})`)
  if (status === 400 && IMAGE_RE.test(bodyText))
    return new ExtractionError('image', `${provider}: rejected the image input (${msg})`)
  if (status >= 500) return new ExtractionError('unavailable', `${provider}: server error ${status}`)
  return new ExtractionError('invalid', `${provider}: request rejected ${status} (${msg})`)
}

/** Map a fetch() throw (network / abort / DNS) to an ExtractionError. */
export function classifyFetchError(err: unknown, provider: string): ExtractionError {
  if (err instanceof ExtractionError) return err
  const name = (err as { name?: string })?.name ?? ''
  const cause = (err as { cause?: { message?: string } })?.cause?.message ?? ''
  const msg = sanitizeProviderMessage(`${(err as Error)?.message ?? ''} ${cause}`)
  if (name === 'TimeoutError' || name === 'AbortError') return new ExtractionError('timeout', `${provider}: timed out`)
  if (name === 'TypeError' || /econnrefused|enotfound|eai_again|network|fetch failed/i.test(msg))
    return new ExtractionError('unavailable', `${provider}: unreachable (${msg || 'connection failed'})`)
  return new ExtractionError('internal', `${provider}: ${msg || 'unexpected error'}`)
}
