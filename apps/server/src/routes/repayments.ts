import { Router } from 'express'
import { z } from 'zod'
import type { PoolClient } from 'pg'
import { parseAmountToMinor } from '@billsplit/core'
import { pool, transaction } from '../db.js'
import { organizerId } from '../auth.js'
import { badRequest, handler, notFound, requireOwnedTrip } from '../http.js'

const router = Router()

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

const repaymentSchema = z.object({
  fromParticipantId: z.string().uuid(),
  toParticipantId: z.string().uuid(),
  /** Decimal string in major units, e.g. "15.00"; converted with trip precision. */
  amount: z.string().trim().min(1).max(30),
  date: dateSchema.optional(),
  note: z.string().trim().max(200).nullish(),
})

const patchSchema = repaymentSchema.partial().extend({
  /** Corrections may also flip a mistaken recording back or reverse it. */
  status: z.enum(['recorded', 'reversed']).optional(),
})

function repaymentJson(r: Record<string, unknown>) {
  return {
    id: r.id as string,
    tripId: r.trip_id as string,
    fromParticipantId: r.sender_participant_id as string,
    toParticipantId: r.recipient_participant_id as string,
    amountMinor: Number(r.amount_minor as string),
    date: r.repayment_date as string,
    note: (r.note as string | null) ?? null,
    status: r.status as 'recorded' | 'reversed',
    reversedAt: (r.reversed_at as Date | null) ?? null,
    createdAt: r.created_at,
  }
}

/**
 * Reject senders/recipients outside the trip. Archived participants are
 * allowed: people who left the trip still settle what they owe or receive.
 */
async function requireTripParticipants(
  client: PoolClient,
  tripId: string,
  ids: { from: string; to: string },
) {
  if (ids.from === ids.to) throw badRequest('sender and recipient must be different people')
  const { rows } = await client.query('select id from participant where trip_id = $1 and id = any($2)', [
    tripId,
    [ids.from, ids.to],
  ])
  const found = new Set(rows.map((r) => r.id as string))
  if (!found.has(ids.from)) throw badRequest('sender must be a participant of this trip')
  if (!found.has(ids.to)) throw badRequest('recipient must be a participant of this trip')
}

async function fetchRepayment(repaymentId: string) {
  const { rows } = await pool.query('select * from repayment where id = $1', [repaymentId])
  const r = rows[0]
  if (!r) throw notFound('repayment not found')
  return repaymentJson(r)
}

/** Resolve a repayment and verify it belongs to this organizer's trip. */
async function requireOwnedRepayment(client: PoolClient, repaymentId: string, organizer: string) {
  const { rows } = await client.query(
    `select r.*, t.currency from repayment r
      join trip t on t.id = r.trip_id
     where r.id = $1 and t.organizer_id = $2
     for update of r`,
    [repaymentId, organizer],
  )
  const row = rows[0] as ({ trip_id: string; currency: string } & Record<string, unknown>) | undefined
  if (!row) throw notFound('repayment not found')
  return row
}

// Repayments are allowed even on closed trips: settling up happens after
// spending stops (Stage 5 keeps closing from blocking them).
router.post(
  '/trips/:tripId/repayments',
  handler(async (req, res) => {
    const body = repaymentSchema.parse(req.body)
    const organizer = organizerId(req)
    const created = await transaction(async (client) => {
      const trip = await requireOwnedTrip(client, organizer, req.params.tripId!)
      await requireTripParticipants(client, trip.id, { from: body.fromParticipantId, to: body.toParticipantId })
      const amountMinor = parseAmountToMinor(body.amount, String(trip.currency).trim())
      const { rows } = await client.query(
        `insert into repayment (trip_id, sender_participant_id, recipient_participant_id, amount_minor, repayment_date, note)
         values ($1, $2, $3, $4, coalesce($5, current_date), $6)
         returning *`,
        [
          trip.id,
          body.fromParticipantId,
          body.toParticipantId,
          amountMinor,
          body.date ?? null,
          body.note?.trim() || null,
        ],
      )
      return repaymentJson(rows[0]!)
    })
    res.status(201).json({ repayment: created })
  }),
)

router.put(
  '/repayments/:repaymentId',
  handler(async (req, res) => {
    const body = patchSchema.parse(req.body)
    if (Object.keys(body).length === 0) throw badRequest('nothing to update')
    const organizer = organizerId(req)
    await transaction(async (client) => {
      const existing = await requireOwnedRepayment(client, req.params.repaymentId!, organizer)
      const from = body.fromParticipantId ?? (existing.sender_participant_id as string)
      const to = body.toParticipantId ?? (existing.recipient_participant_id as string)
      await requireTripParticipants(client, existing.trip_id, { from, to })
      const amountMinor =
        body.amount !== undefined
          ? parseAmountToMinor(body.amount, String(existing.currency).trim())
          : Number(existing.amount_minor as string)
      const status = body.status ?? (existing.status as 'recorded' | 'reversed')
      const { rowCount } = await client.query(
        `update repayment set
           sender_participant_id = $2,
           recipient_participant_id = $3,
           amount_minor = $4,
           repayment_date = coalesce($5, repayment_date),
           note = case when $6 then $7 else note end,
           status = $8,
           reversed_at = case when $8 = 'reversed' then coalesce(reversed_at, now()) else null end,
           updated_at = now()
         where id = $1`,
        [
          req.params.repaymentId,
          from,
          to,
          amountMinor,
          body.date ?? null,
          body.note !== undefined,
          body.note?.trim() || null,
          status,
        ],
      )
      if (!rowCount) throw notFound('repayment not found')
    })
    res.json({ repayment: await fetchRepayment(req.params.repaymentId!) })
  }),
)

/** Reverse a recorded repayment: it stops counting and stays visible in history. */
router.post(
  '/repayments/:repaymentId/reverse',
  handler(async (req, res) => {
    const organizer = organizerId(req)
    await transaction(async (client) => {
      const existing = await requireOwnedRepayment(client, req.params.repaymentId!, organizer)
      if (existing.status === 'reversed') throw badRequest('repayment is already reversed')
      await client.query(
        `update repayment set status = 'reversed', reversed_at = now(), updated_at = now() where id = $1`,
        [req.params.repaymentId],
      )
    })
    res.json({ repayment: await fetchRepayment(req.params.repaymentId!) })
  }),
)

export default router
