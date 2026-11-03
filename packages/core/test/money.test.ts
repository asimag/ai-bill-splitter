import { describe, expect, it } from 'vitest'
import { currencyPrecision, formatMinor, parseAmountToMinor } from '../src/money'

describe('money', () => {
  it('knows currency precision', () => {
    expect(currencyPrecision('USD')).toBe(2)
    expect(currencyPrecision('pkr')).toBe(2)
    expect(currencyPrecision('JPY')).toBe(0)
    expect(currencyPrecision('KWD')).toBe(3)
    expect(() => currencyPrecision('DOLLARS')).toThrow(RangeError)
  })

  it('parses decimal strings to minor units without floats', () => {
    expect(parseAmountToMinor('12.34', 'USD')).toBe(1234)
    expect(parseAmountToMinor('0.05', 'USD')).toBe(5)
    expect(parseAmountToMinor('100', 'USD')).toBe(10000)
    expect(parseAmountToMinor('100.', 'USD')).toBe(10000)
    expect(() => parseAmountToMinor('1,000', 'USD')).toThrow(RangeError) // no thousands separators
    expect(parseAmountToMinor('12', 'JPY')).toBe(12)
    expect(parseAmountToMinor('1.234', 'KWD')).toBe(1234)
    expect(parseAmountToMinor(' 8.5 ', 'USD')).toBe(850)
    expect(parseAmountToMinor('007.50', 'USD')).toBe(750)
  })

  it('rejects invalid or unsafe amounts', () => {
    expect(() => parseAmountToMinor('0', 'USD')).toThrow(RangeError)
    expect(() => parseAmountToMinor('-5', 'USD')).toThrow(RangeError)
    expect(() => parseAmountToMinor('12.345', 'USD')).toThrow(RangeError) // > precision
    expect(() => parseAmountToMinor('1.5', 'JPY')).toThrow(RangeError)
    expect(() => parseAmountToMinor('abc', 'USD')).toThrow(RangeError)
    expect(() => parseAmountToMinor('1e3', 'USD')).toThrow(RangeError)
    expect(() => parseAmountToMinor('12.34.5', 'USD')).toThrow(RangeError)
    expect(() => parseAmountToMinor('9007199254740992', 'USD')).toThrow(RangeError)
  })

  it('formats minor units back to decimal strings', () => {
    expect(formatMinor(1234, 'USD')).toBe('12.34')
    expect(formatMinor(5, 'USD')).toBe('0.05')
    expect(formatMinor(-150000, 'USD')).toBe('-1500.00')
    expect(formatMinor(4550, 'JPY')).toBe('4550')
    expect(formatMinor(1234, 'KWD')).toBe('1.234')
  })
})
