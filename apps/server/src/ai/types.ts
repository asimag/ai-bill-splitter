/**
 * Shared receipt-extraction contract. Adapters only suggest structured
 * receipt data; the application computes every share in exact integer math
 * after the organizer confirms.
 */

export type AiMode = 'auto' | 'local' | 'gemini' | 'tesseract'

/** Runtime-validated extraction result. Missing fields are null, never guessed. */
export interface Extraction {
  merchant: string | null
  /** Suggested expense category (e.g. "Food") when inferable, else null. */
  category: string | null
  /** ISO YYYY-MM-DD when confidently readable, else null. */
  date: string | null
  currency: string | null
  subtotal: string | null
  tax: string | null
  serviceCharge: string | null
  tip: string | null
  cashTendered: string | null
  /** Final payable total (included charges not added twice), decimal string. */
  total: string | null
  warnings: string[]
}

export interface ReceiptImage {
  bytes: Buffer
  mimeType: string
}

export type ExtractionErrorKind =
  | 'credentials' // missing/invalid/revoked API key
  | 'rate_limit' // quota or throttling — actionable, not a key prompt
  | 'unavailable' // endpoint unreachable / server error
  | 'timeout'
  | 'image' // model rejects this image input (image-incompatible)
  | 'invalid' // unusable or malformed structured output
  | 'internal'

export class ExtractionError extends Error {
  constructor(
    public kind: ExtractionErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'ExtractionError'
  }
}

export interface ReceiptAiAdapter {
  readonly name: 'local' | 'gemini' | 'tesseract'
  /** One bounded attempt. Throw ExtractionError with a sanitized message. */
  extract(image: ReceiptImage): Promise<Extraction>
}
