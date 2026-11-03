/**
 * Money handling in integer minor units with explicit currency precision.
 * Never use floating-point arithmetic on amounts.
 */

/** Minor-unit precision (decimal places) per ISO 4217 code. Default is 2. */
const CURRENCY_PRECISION: Record<string, number> = {
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  PYG: 0,
  UGX: 0,
  VUV: 0,
}

/** Common currencies offered in the UI (organizer picks one per trip). */
export const COMMON_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'PKR',
  'AED',
  'SAR',
  'TRY',
  'INR',
  'JPY',
  'AUD',
  'CAD',
  'SGD',
  'MYR',
  'IDR',
] as const

export function currencyPrecision(currency: string): number {
  const code = currency.toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new RangeError(`invalid currency code: ${currency}`)
  }
  return CURRENCY_PRECISION[code] ?? 2
}

export function isSupportedCurrency(currency: string): boolean {
  try {
    currencyPrecision(currency)
    return true
  } catch {
    return false
  }
}

/**
 * Parse a human-entered decimal amount ("12.34") into a positive integer
 * minor-unit value for the given currency ("1234" for a 2-decimal currency).
 * Pure string arithmetic — no floats. Rejects amounts that are not positive,
 * have too many decimal places, or exceed the safe integer range.
 */
export function parseAmountToMinor(amount: string, currency: string): number {
  const precision = currencyPrecision(currency)
  const match = /^(\d+)(?:\.(\d*))?$/.exec(amount.trim())
  if (!match) throw new RangeError(`invalid amount: ${amount}`)
  const [, whole = '0', fraction = ''] = match
  if (fraction.length > precision) {
    throw new RangeError(
      `amount ${amount} has more than ${precision} decimal place(s) for ${currency.toUpperCase()}`,
    )
  }
  const padded = fraction.padEnd(precision, '0')
  const digits = (whole.replace(/^0+(?=\d)/, '') || '0') + padded
  const value = Number(digits)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`amount must be a positive number of minor units: ${amount}`)
  }
  return value
}

/** Format minor units back to a decimal string, e.g. 1234 -> "12.34". */
export function formatMinor(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor)) throw new RangeError(`invalid minor amount: ${minor}`)
  const precision = currencyPrecision(currency)
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor).toString().padStart(precision + 1, '0')
  if (precision === 0) return `${sign}${abs}`
  const cut = abs.length - precision
  return `${sign}${abs.slice(0, cut)}.${abs.slice(cut)}`
}
