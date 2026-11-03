import { ExtractionError, type Extraction } from './types.js'

/**
 * Runtime validation of model-produced extraction data. Receipt text and
 * model output are untrusted data, never instructions.
 *
 * Lenient per-field (a garbled optional field becomes null plus a warning)
 * but strict about the envelope: no JSON object at all is an invalid result
 * that may trigger provider fallback.
 */

const AMOUNT_RE = /^\d+(\.\d{1,6})?$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** Free-text category, capped so one odd model answer cannot bloat the field. */
const CATEGORY_MAX = 40
/** Categories the expense form offers; a model answer outside them is kept as free text. */
export const KNOWN_CATEGORIES = ['Food', 'Drinks', 'Groceries', 'Transport', 'Stay', 'Activities', 'Other']

function normalizeCategory(value: unknown): string | null {
  const s = normalizeText(value, CATEGORY_MAX)
  if (!s) return null
  const match = KNOWN_CATEGORIES.find((c) => c.toLowerCase() === s.toLowerCase())
  return match ?? s
}

function normalizeAmount(value: unknown, field: string, warnings: string[]): string | null {
  if (value === null || value === undefined || value === '') return null
  let s: string
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      warnings.push(`${field}: unreadable amount dropped`)
      return null
    }
    s = String(value)
  } else if (typeof value === 'string') {
    s = value
  } else {
    warnings.push(`${field}: unreadable amount dropped`)
    return null
  }
  // Strip thousands separators, spaces, NBSP, and leading currency labels/symbols.
  s = s.replace(/[\s,\u00a0]/g, '').replace(/^[^\d.]+/, '').replace(/[^\d.].*$/, '')
  if (s === '' || s === '.' || !AMOUNT_RE.test(s)) {
    warnings.push(`${field}: unreadable amount dropped`)
    return null
  }
  const n = Number(s)
  if (!Number.isFinite(n) || n <= 0) {
    warnings.push(`${field}: unreadable amount dropped`)
    return null
  }
  return s
}

function normalizeText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const s = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return null
  return s.slice(0, max)
}

function normalizeDate(value: unknown, warnings: string[]): string | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (ISO_DATE_RE.test(s)) return s
  // Ambiguous formats (DD/MM vs MM/DD) are left null rather than guessed.
  if (s) warnings.push(`date "${s.slice(0, 20)}" was not ISO-readable and was dropped`)
  return null
}

/** Parse one model message into a validated Extraction, or throw invalid. */
export function parseExtraction(raw: unknown): Extraction {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new ExtractionError('invalid', 'model output was not a JSON object')
  const o = raw as Record<string, unknown>
  const warnings: string[] = Array.isArray(o.warnings)
    ? o.warnings.filter((w): w is string => typeof w === 'string').slice(0, 10).map((w) => w.slice(0, 200))
    : []

  const currencyRaw = typeof o.currency === 'string' ? o.currency.trim().toUpperCase() : ''
  const currency = /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : null

  const extraction: Extraction = {
    merchant: normalizeText(o.merchant, 120),
    category: normalizeCategory(o.category),
    date: normalizeDate(o.date, warnings),
    currency,
    subtotal: normalizeAmount(o.subtotal, 'subtotal', warnings),
    tax: normalizeAmount(o.tax, 'tax', warnings),
    serviceCharge: normalizeAmount(o.service_charge ?? o.serviceCharge, 'serviceCharge', warnings),
    tip: normalizeAmount(o.tip, 'tip', warnings),
    cashTendered: normalizeAmount(o.cash_tendered ?? o.cashTendered, 'cashTendered', warnings),
    total: normalizeAmount(o.total, 'total', warnings),
    warnings,
  }
  if (extraction.total === null) extraction.warnings.push('final payable total not readable — confirm the amount manually')
  return extraction
}

/** Pull the first JSON object out of a model reply (tolerates ``` fences). */
export function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = fenced ? fenced[1]! : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new ExtractionError('invalid', 'model output contained no JSON object')
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    throw new ExtractionError('invalid', 'model output contained malformed JSON')
  }
}
