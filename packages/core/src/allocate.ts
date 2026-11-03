/**
 * Weighted allocation engine. Pure, exact integer arithmetic (BigInt); no
 * money is ever computed with floating point. Used by the API for saved
 * expenses and by the browser for quick split, so both always agree.
 */

export interface AllocationInput {
  participantId: string
  /** Positive integer weight, e.g. 1, 2, 1 for a 1:2:1 split. */
  weight: number
}

export interface AllocationResult {
  participantId: string
  weight: number
  /** Share in minor units. The results always sum exactly to the total. */
  amountMinor: number
  /** Stable position (input order), used as the rounding tie-breaker. */
  position: number
}

/**
 * Split `totalMinor` among participants in proportion to their weights.
 *
 * Algorithm: each base share is floor(total * weight / totalWeight). The
 * rounding leftover (always < participant count) is distributed one minor
 * unit at a time by largest fractional remainder; ties keep the original
 * (stable) participant order.
 */
export function allocate(totalMinor: number, inputs: readonly AllocationInput[]): AllocationResult[] {
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) {
    throw new RangeError(`total must be a positive integer of minor units, got ${totalMinor}`)
  }
  if (inputs.length === 0) {
    throw new RangeError('at least one included participant is required')
  }
  for (const p of inputs) {
    if (!Number.isSafeInteger(p.weight) || p.weight <= 0) {
      throw new RangeError(`weight must be a positive integer, got ${p.weight}`)
    }
  }
  const ids = new Set<string>()
  for (const p of inputs) {
    if (ids.has(p.participantId)) {
      throw new RangeError(`duplicate participant: ${p.participantId}`)
    }
    ids.add(p.participantId)
  }

  const total = BigInt(totalMinor)
  const totalWeight = inputs.reduce((sum, p) => sum + BigInt(p.weight), 0n)

  const base: bigint[] = []
  const remainders: bigint[] = []
  for (const p of inputs) {
    const numerator = total * BigInt(p.weight)
    base.push(numerator / totalWeight)
    remainders.push(numerator % totalWeight)
  }

  let assigned = base.reduce((sum, b) => sum + b, 0n)
  const order = inputs.map((_, i) => i)
  // Largest fractional remainder first; stable input order breaks ties.
  order.sort((a, b) => {
    if (remainders[a] !== remainders[b]) return remainders[a]! > remainders[b]! ? -1 : 1
    return a - b
  })
  for (let k = 0; assigned < total; k++) {
    const idx = order[k % order.length]!
    base[idx] = (base[idx] ?? 0n) + 1n
    assigned += 1n
  }

  return inputs.map((p, i) => ({
    participantId: p.participantId,
    weight: p.weight,
    amountMinor: Number(base[i]),
    position: i,
  }))
}
