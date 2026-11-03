import { describe, expect, it } from 'vitest'
import { suggestTransfers, type NetBalanceInput } from '../src/settle'

const fmt = (s: { fromParticipantId: string; toParticipantId: string; amountMinor: number }[]) =>
  s.map((t) => `${t.fromParticipantId}->${t.toParticipantId}:${t.amountMinor}`)

describe('suggestTransfers', () => {
  it('matches the 9,000 at 1:2:1 example: Ahmed owes 2,250 and Sara owes 1,500, Ali receives 3,750', () => {
    const balances: NetBalanceInput[] = [
      { participantId: 'ali', netMinor: 3750 },
      { participantId: 'sara', netMinor: -1500 },
      { participantId: 'ahmed', netMinor: -2250 },
    ]
    // Largest debtor (Ahmed) pairs with the only creditor first, then Sara.
    expect(fmt(suggestTransfers(balances))).toEqual(['ahmed->ali:2250', 'sara->ali:1500'])
  })

  it('returns nothing when everyone is settled', () => {
    expect(
      suggestTransfers([
        { participantId: 'a', netMinor: 0 },
        { participantId: 'b', netMinor: 0 },
      ]),
    ).toEqual([])
  })

  it('conserves money: every debtor and creditor nets out exactly', () => {
    const balances: NetBalanceInput[] = [
      { participantId: 'a', netMinor: 100 },
      { participantId: 'b', netMinor: -30 },
      { participantId: 'c', netMinor: 45 },
      { participantId: 'd', netMinor: -115 },
    ]
    const moves = suggestTransfers(balances)
    const moved = new Map<string, number>()
    for (const t of moves) {
      expect(t.amountMinor).toBeGreaterThan(0)
      moved.set(t.fromParticipantId, (moved.get(t.fromParticipantId) ?? 0) - t.amountMinor)
      moved.set(t.toParticipantId, (moved.get(t.toParticipantId) ?? 0) + t.amountMinor)
    }
    for (const b of balances) expect(moved.get(b.participantId) ?? 0).toBe(b.netMinor)
  })

  it('is deterministic and produces at most n-1 transfers', () => {
    const balances: NetBalanceInput[] = [
      { participantId: 'a', netMinor: -500 },
      { participantId: 'b', netMinor: 250 },
      { participantId: 'c', netMinor: 150 },
      { participantId: 'd', netMinor: 100 },
    ]
    const first = fmt(suggestTransfers(balances))
    expect(fmt(suggestTransfers(balances))).toEqual(first)
    expect(first).toEqual(['a->b:250', 'a->c:150', 'a->d:100'])
    expect(first.length).toBeLessThanOrEqual(balances.length - 1)
  })

  it('splits a debtor across creditors and a creditor across debtors', () => {
    const balances: NetBalanceInput[] = [
      { participantId: 'big-owe', netMinor: -90 },
      { participantId: 'x', netMinor: 30 },
      { participantId: 'y', netMinor: 60 },
      { participantId: 'small-owe', netMinor: -60 },
      { participantId: 'z', netMinor: 60 },
    ]
    const moves = suggestTransfers(balances)
    const total = moves.reduce((s, t) => s + t.amountMinor, 0)
    expect(total).toBe(150) // total owed == total to receive
    expect(fmt(moves)).toEqual(['big-owe->y:60', 'big-owe->z:30', 'small-owe->z:30', 'small-owe->x:30'])
  })

  it('rejects unbalanced or non-integer input', () => {
    expect(() => suggestTransfers([{ participantId: 'a', netMinor: 10 }])).toThrow(RangeError)
    expect(() =>
      suggestTransfers([
        { participantId: 'a', netMinor: 10 },
        { participantId: 'b', netMinor: -9.5 },
      ]),
    ).toThrow(RangeError)
  })
})
