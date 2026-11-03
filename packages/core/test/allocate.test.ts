import { describe, expect, it } from 'vitest'
import { allocate } from '../src/allocate'

const ids = (r: { participantId: string; amountMinor: number }[]) =>
  r.map((x) => `${x.participantId}:${x.amountMinor}`)

describe('allocate', () => {
  it('splits 6,000 at 1:2:1 into 1,500 / 3,000 / 1,500', () => {
    const result = allocate(6000, [
      { participantId: 'a', weight: 1 },
      { participantId: 'b', weight: 2 },
      { participantId: 'c', weight: 1 },
    ])
    expect(ids(result)).toEqual(['a:1500', 'b:3000', 'c:1500'])
  })

  it('gives 34 / 33 / 33 for 100 split equally in stable participant order', () => {
    const result = allocate(100, [
      { participantId: 'a', weight: 1 },
      { participantId: 'b', weight: 1 },
      { participantId: 'c', weight: 1 },
    ])
    expect(ids(result)).toEqual(['a:34', 'b:33', 'c:33'])
  })

  it('sums exactly to the total for awkward totals', () => {
    for (const total of [1, 7, 99, 100, 1000000, 12345678]) {
      for (const weights of [[1, 1, 1], [1, 2, 1], [3, 5, 7, 11], [1, 1, 1, 1, 1, 1, 1]]) {
        const result = allocate(
          total,
          weights.map((w, i) => ({ participantId: `p${i}`, weight: w })),
        )
        const sum = result.reduce((s, r) => s + r.amountMinor, 0)
        expect(sum, `total=${total} weights=${weights}`).toBe(total)
        for (const r of result) expect(Number.isSafeInteger(r.amountMinor)).toBe(true)
      }
    }
  })

  it('breaks remainder ties by stable input order', () => {
    // 10 among weights 1:1:1 -> remainders all 1; first two participants win.
    const first = allocate(10, [
      { participantId: 'x', weight: 1 },
      { participantId: 'y', weight: 1 },
      { participantId: 'z', weight: 1 },
    ])
    expect(ids(first)).toEqual(['x:4', 'y:3', 'z:3'])
    // Reordering input reorders who receives the leftover unit.
    const second = allocate(10, [
      { participantId: 'z', weight: 1 },
      { participantId: 'y', weight: 1 },
      { participantId: 'x', weight: 1 },
    ])
    expect(ids(second)).toEqual(['z:4', 'y:3', 'x:3'])
  })

  it('prefers larger fractional remainders regardless of order', () => {
    // 10 at 2:1:1: shares 5/2.5/2.5 base 5/2/2, leftovers to the two .5s in order.
    const result = allocate(10, [
      { participantId: 'heavy', weight: 2 },
      { participantId: 'light1', weight: 1 },
      { participantId: 'light2', weight: 1 },
    ])
    expect(ids(result)).toEqual(['heavy:5', 'light1:3', 'light2:2'])
  })

  it('gives the whole amount to a single included participant', () => {
    expect(allocate(4550, [{ participantId: 'solo', weight: 3 }])).toEqual([
      { participantId: 'solo', weight: 3, amountMinor: 4550, position: 0 },
    ])
  })

  it('rejects invalid input', () => {
    expect(() => allocate(0, [{ participantId: 'a', weight: 1 }])).toThrow(RangeError)
    expect(() => allocate(-5, [{ participantId: 'a', weight: 1 }])).toThrow(RangeError)
    expect(() => allocate(1.5, [{ participantId: 'a', weight: 1 }])).toThrow(RangeError)
    expect(() => allocate(100, [])).toThrow(RangeError)
    expect(() => allocate(100, [{ participantId: 'a', weight: 0 }])).toThrow(RangeError)
    expect(() => allocate(100, [{ participantId: 'a', weight: 1.5 }])).toThrow(RangeError)
    expect(() =>
      allocate(100, [
        { participantId: 'a', weight: 1 },
        { participantId: 'a', weight: 2 },
      ]),
    ).toThrow(RangeError)
  })
})
