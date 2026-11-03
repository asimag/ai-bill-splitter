/**
 * Stage 3 unit tests for the extraction boundary: envelope validation,
 * amount/date normalization, error classification, key encryption,
 * and the optional Tesseract heuristic parser.
 */
import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '../src/crypto.js'
import { classifyHttpError, sanitizeProviderMessage } from '../src/ai/errors.js'
import { extractJsonObject, parseExtraction } from '../src/ai/validate.js'
import { parseTesseractText } from '../src/ai/tesseract.js'
import { ExtractionError } from '../src/ai/types.js'

describe('parseExtraction', () => {
  it('accepts a full clean extraction', () => {
    const e = parseExtraction({
      merchant: 'Tandoor House',
      date: '2026-11-01',
      currency: 'usd',
      subtotal: 48.0,
      tax: '4.80',
      service_charge: null,
      tip: '6.00',
      cash_tendered: '60',
      total: '52.80',
      warnings: ['slightly creased receipt'],
    })
    expect(e).toEqual({
      merchant: 'Tandoor House',
      date: '2026-11-01',
      currency: 'USD',
      subtotal: '48',
      tax: '4.80',
      serviceCharge: null,
      tip: '6.00',
      cashTendered: '60',
      total: '52.80',
      warnings: ['slightly creased receipt'],
    })
  })

  it('normalizes currency labels and thousands separators in amounts', () => {
    const e = parseExtraction({ total: 'JOD 1,250.000', subtotal: ' 1,200 ' })
    expect(e.total).toBe('1250.000')
    expect(e.subtotal).toBe('1200')
  })

  it('drops unreadable optional fields with warnings instead of guessing', () => {
    const e = parseExtraction({ tax: 'Rs ??', date: '01/02/2026', total: '12.00' })
    expect(e.tax).toBeNull()
    expect(e.date).toBeNull() // ambiguous DD/MM vs MM/DD is never guessed
    expect(e.total).toBe('12.00')
    expect(e.warnings.length).toBeGreaterThanOrEqual(2)
  })

  it('flags a missing total for manual confirmation', () => {
    const e = parseExtraction({ merchant: 'Cafe', subtotal: '10.00' })
    expect(e.total).toBeNull()
    expect(e.warnings.join(' ')).toMatch(/total/i)
  })

  it('rejects non-object envelopes as invalid', () => {
    expect(() => parseExtraction('no json here')).toThrow(ExtractionError)
    expect(() => parseExtraction([1, 2])).toThrow(ExtractionError)
  })
})

describe('extractJsonObject', () => {
  it('reads plain JSON and fenced JSON blocks', () => {
    expect(extractJsonObject('{"total":"1.00"}')).toEqual({ total: '1.00' })
    expect(extractJsonObject('Sure!\n```json\n{"total":"2.00"}\n```\nHope that helps')).toEqual({ total: '2.00' })
  })

  it('throws invalid on malformed JSON', () => {
    expect(() => extractJsonObject('{total: oops,}')).toThrow(/malformed JSON/)
    expect(() => extractJsonObject('nothing here')).toThrow(/no JSON object/)
  })
})

describe('credential encryption', () => {
  it('round-trips and refuses tampered payloads', () => {
    const enc = encryptSecret('fw_super_secret_key_123')
    expect(decryptSecret(enc)).toBe('fw_super_secret_key_123')
    expect(enc).not.toContain('super_secret')
    const parts = enc.split(':')
    parts[3] = Buffer.from('x' + Buffer.from(parts[3]!, 'base64url').toString()).toString('base64url')
    expect(() => decryptSecret(parts.join(':'))).toThrow()
  })
})

describe('error classification', () => {
  it('separates credential, rate-limit, image, and availability failures', () => {
    expect(classifyHttpError(401, 'Unauthorized: API key not valid', 'Gemini').kind).toBe('credentials')
    expect(classifyHttpError(403, 'permission denied on project', 'Gemini').kind).toBe('credentials')
    expect(classifyHttpError(429, 'Resource has been exhausted (quota)', 'Gemini').kind).toBe('rate_limit')
    expect(classifyHttpError(400, 'model does not support image input modality', 'local AI').kind).toBe('image')
    expect(classifyHttpError(502, 'bad gateway', 'local AI').kind).toBe('unavailable')
    expect(classifyHttpError(400, 'unknown request parameter', 'local AI').kind).toBe('invalid')
  })

  it('redacts key-shaped tokens and keeps messages single-line and bounded', () => {
    const s = sanitizeProviderMessage(`line one\nauthorization Bearer ${'A'.repeat(40)}\nline three`)
    expect(s).not.toContain('A'.repeat(40))
    expect(s).toContain('[redacted]')
    expect(s.split('\n').length).toBe(1)
    expect(sanitizeProviderMessage('x'.repeat(500)).length).toBeLessThanOrEqual(201)
  })
})

describe('parseTesseractText (optional adapter heuristic)', () => {
  it('uses the last amount on the last total line, skipping subtotal-only lines', () => {
    const text = [
      'Burger ........ 8.50',
      'Subtotal 10.00',
      'Tax 1.50',
      'TOTAL 11.50',
    ].join('\n')
    expect(parseTesseractText(text).total).toBe('11.50')
  })

  it('reports no-total instead of inventing one, always with a warning', () => {
    const e = parseTesseractText('Burger 8.50\nFries 3.00')
    expect(e.total).toBeNull()
    expect(e.warnings.join(' ')).toMatch(/verify/i)
    expect(e.warnings.join(' ')).toMatch(/not readable/i)
  })
})
