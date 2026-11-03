/**
 * Settlement suggestions. Pure integer logic shared by the API and the
 * browser. Suggestions are advice only: recording them as actual payments
 * (repayments) is a separate, explicit user action.
 */

export interface NetBalanceInput {
  participantId: string
  /** Net balance in minor units: positive receives, negative owes. */
  netMinor: number
}

export interface TransferSuggestion {
  /** Participant who should pay. */
  fromParticipantId: string
  /** Participant who should receive. */
  toParticipantId: string
  /** Amount to move, positive minor units. */
  amountMinor: number
}

/**
 * Greedy largest-first matching of debtors with creditors. Each step pairs
 * the current largest debt with the current largest credit and moves the
 * smaller of the two; the pair with the larger remainder stays for the next
 * step. Produces at most n-1 transfers per n unbalanced participants.
 *
 * This is a heuristic: it does NOT claim a globally minimal transfer count
 * (that problem is NP-hard), it just keeps the list short and deterministic.
 * Deterministic because both sides are sorted by remaining amount
 * descending with input order as a stable tie-breaker.
 */
export function suggestTransfers(balances: readonly NetBalanceInput[]): TransferSuggestion[] {
  let sum = 0
  for (const b of balances) {
    if (!Number.isSafeInteger(b.netMinor)) {
      throw new RangeError(`net balance must be an integer of minor units, got ${b.netMinor}`)
    }
    sum += b.netMinor
  }
  if (sum !== 0) {
    throw new RangeError(`net balances must sum to zero, got ${sum}`)
  }

  type Side = { participantId: string; remaining: number; order: number }
  const debtors: Side[] = []
  const creditors: Side[] = []
  balances.forEach((b, i) => {
    if (b.netMinor < 0) debtors.push({ participantId: b.participantId, remaining: -b.netMinor, order: i })
    else if (b.netMinor > 0) creditors.push({ participantId: b.participantId, remaining: b.netMinor, order: i })
  })
  const byLargest = (a: Side, b: Side) => b.remaining - a.remaining || a.order - b.order
  debtors.sort(byLargest)
  creditors.sort(byLargest)

  const suggestions: TransferSuggestion[] = []
  let d = 0
  let c = 0
  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d]!
    const creditor = creditors[c]!
    const amount = Math.min(debtor.remaining, creditor.remaining)
    suggestions.push({
      fromParticipantId: debtor.participantId,
      toParticipantId: creditor.participantId,
      amountMinor: amount,
    })
    debtor.remaining -= amount
    creditor.remaining -= amount
    if (debtor.remaining === 0) d++
    if (creditor.remaining === 0) c++
  }
  return suggestions
}
