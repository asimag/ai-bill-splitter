import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ExtractionError, type ReceiptAiAdapter, type ReceiptImage, type Extraction } from './types.js'

/**
 * Optional Tesseract adapter. It is NOT part of the automatic chain: it only
 * runs when RECEIPT_AI_MODE (or the organizer override) is explicitly set to
 * "tesseract". Its output is a low-confidence line-reading heuristic, so every
 * result carries a verify-carefully warning and still requires confirmation.
 */
export class TesseractAdapter implements ReceiptAiAdapter {
  readonly name = 'tesseract'

  constructor(private binary: string = process.env.TESSERACT_PATH ?? 'tesseract') {}

  available(): boolean {
    const probe = spawnSync(this.binary, ['--version'], { encoding: 'utf8', timeout: 5_000 })
    return probe.status === 0
  }

  async extract(image: ReceiptImage): Promise<Extraction> {
    if (!this.available())
      throw new ExtractionError('unavailable', 'tesseract binary not found (optional adapter; install it or switch provider)')
    const dir = mkdtempSync(path.join(tmpdir(), 'billsplit-ocr-'))
    try {
      const ext = image.mimeType === 'image/png' ? '.png' : image.mimeType === 'image/webp' ? '.webp' : '.jpg'
      const file = path.join(dir, `receipt${ext}`)
      writeFileSync(file, image.bytes)
      const run = spawnSync(this.binary, [file, 'stdout'], { encoding: 'utf8', timeout: 60_000 })
      if (run.error?.name === 'AbortError' || run.signal) throw new ExtractionError('timeout', 'tesseract timed out')
      if (run.status !== 0)
        throw new ExtractionError('image', `tesseract could not read the image (${run.stderr?.slice(0, 120) ?? 'unknown error'})`)
      return parseTesseractText(run.stdout ?? '')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/** Heuristic: the last amount on the last "total"-ish line is the payable total. */
export function parseTesseractText(text: string): Extraction {
  const amount = String.raw`\d{1,9}(?:[.,]\d{1,3})?`
  let total: string | null = null
  for (const line of text.split(/\r?\n/)) {
    if (!/total/i.test(line)) continue
    if (/subtotal/i.test(line) && !/\bgrand\s*total\b/i.test(line)) continue
    const matches = line.match(new RegExp(amount, 'g'))
    const last = matches?.[matches.length - 1]
    if (last) total = last.replace(',', '.')
  }
  const warnings = [
    'tesseract is a low-confidence text heuristic — verify every amount carefully',
  ]
  if (!total) warnings.push('final payable total not readable — confirm the amount manually')
  const extraction: Extraction = {
    merchant: null,
    date: null,
    currency: null,
    subtotal: null,
    tax: null,
    serviceCharge: null,
    tip: null,
    cashTendered: null,
    total,
    warnings,
  }
  return extraction
}
