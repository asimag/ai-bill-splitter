import { formatMinor } from '@billsplit/core'

/** Display-only currency formatting; all arithmetic stays in integer minor units. */
export function money(minor: number, currency: string): string {
  const decimals = Number(formatMinor(minor, currency))
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(decimals)
  } catch {
    return `${formatMinor(minor, currency)} ${currency}`
  }
}

export function todayISO(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
