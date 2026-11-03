import { Router } from 'express'
import { z } from 'zod'
import type { PoolClient } from 'pg'
import { allocate, parseAmountToMinor } from '@billsplit/core'
import { pool, transaction } from '../db.js'
import { organizerId } from '../auth.js'
import { badRequest, handler, HttpError, notFound, requireOwnedTrip } from '../http.js'

const router = Router()

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

const expenseSchema = z.object({
  description: z.string().trim().min(1).max(200),
  date: dateSchema.optional(),
  category: z.string().trim().max(40).nullish(),
  /** Decimal string in major units, e.g. "60.00"; converted with trip precision. */
  amount: z.string().trim().min(1).max(30),
  payerParticipantId: z.string().uuid(),
  /** Included participants with per-expense weight snapshots, in stable order. */
  participants: z
    .array(z.object({ participantId: z.string().uuid(), weight: z.number().int().positive() }))
    .min(1, 'at least one included participant is required')
    .max(200),
})

async function loadTripParticipants(client: PoolClient, tripId: string) {
  const { rows } = await client.query(
    'select id, archived, name from participant where trip_id = $1',
    [tripId],
  )
  return new Map(rows.map((r) => [r.id as string, r]))
}

async function fetchExpense(expenseId: string) {
  const { rows } = await pool.query('select * from expense where id = $1', [expenseId])
  const e = rows[0]
  if (!e) throw notFound('expense not found')
  const allocations = await pool.query(
    'select * from expense_allocation where expense_id = $1 order by position',
    [expenseId],
  )
  return {
    id: e.id as string,
    tripId: e.trip_id as string,
    description: e.description as string,
    date: e.expense_date as string,
    category: (e.category as string | null) ?? null,
    amountMinor: Number(e.amount_minor as string),
    payerParticipantId: e.payer_participant_id as string,
    status: e.status as string,
    allocations: allocations.rows.map((a) => ({
      participantId: a.participant_id as string,
      weight: a.weight as number,
      amountMinor: Number(a.amount_minor as string),
      position: a.position as number,
    })),
  }
}

/** Resolve an expense and verify it belongs to this organizer's trip. */
async function requireOwnedExpense(expenseId: string, organizer: string) {
  const { rows } = await pool.query(
    `select e.trip_id from expense e join trip t on t.id = e.trip_id
     where e.id = $1 and t.organizer_id = $2`,
    [expenseId, organizer],
  )
  const row = rows[0] as { trip_id: string } | undefined
  if (!row) throw notFound('expense not found')
  return row
}

router.post(
  '/trips/:tripId/expenses',
  handler(async (req, res) => {
    const body = expenseSchema.parse(req.body)
    const organizer = organizerId(req)
    // The transaction validates everything; keep it open through the insert.
    const result = await transaction(async (client) => {
      const trip = await requireOwnedTrip(client, organizer, req.params.tripId!)
      if (trip.status !== 'open') throw new HttpError(409, 'trip is closed; reopen it before changing expenses')
      const participants = await loadTripParticipants(client, trip.id)
      const includedIds = body.participants.map((p) => p.participantId)
      if (new Set(includedIds).size !== includedIds.length) throw badRequest('duplicate participants in allocation')
      if (!participants.has(body.payerParticipantId)) throw badRequest('payer must be a participant of this trip')
      for (const id of includedIds) {
        if (!participants.has(id)) throw badRequest('all allocation participants must belong to this trip')
      }
      for (const id of [...includedIds, body.payerParticipantId]) {
        const p = participants.get(id)!
        if (p.archived) throw badRequest(`cannot use archived participant ${p.name as string}`)
      }
      const amountMinor = parseAmountToMinor(body.amount, String(trip.currency).trim())
      const allocations = allocate(
        amountMinor,
        body.participants.map((p) => ({ participantId: p.participantId, weight: p.weight })),
      )
      const { rows } = await client.query(
        `insert into expense (trip_id, description, expense_date, category, amount_minor, payer_participant_id)
         values ($1, $2, coalesce($3, current_date), $4, $5, $6)
         returning id`,
        [trip.id, body.description, body.date ?? null, body.category?.trim() || null, amountMinor, body.payerParticipantId],
      )
      const expenseId = rows[0].id as string
      for (const a of allocations) {
        await client.query(
          `insert into expense_allocation (expense_id, participant_id, weight, amount_minor, position)
           values ($1, $2, $3, $4, $5)`,
          [expenseId, a.participantId, a.weight, a.amountMinor, a.position],
        )
      }
      return expenseId
    })
    res.status(201).json({ expense: await fetchExpense(result) })
  }),
)

router.put(
  '/expenses/:expenseId',
  handler(async (req, res) => {
    const body = expenseSchema.parse(req.body)
    const organizer = organizerId(req)
    await transaction(async (client) => {
      const owned = await client.query(
        `select e.trip_id from expense e join trip t on t.id = e.trip_id
         where e.id = $1 and t.organizer_id = $2
         for update of e`,
        [req.params.expenseId, organizer],
      )
      const row = owned.rows[0] as { trip_id: string } | undefined
      if (!row) throw notFound('expense not found')
      const trip = await requireOwnedTrip(client, organizer, row.trip_id)
      if (trip.status !== 'open') throw new HttpError(409, 'trip is closed; reopen it before changing expenses')

      const participants = await loadTripParticipants(client, trip.id)
      const includedIds = body.participants.map((p) => p.participantId)
      if (new Set(includedIds).size !== includedIds.length) throw badRequest('duplicate participants in allocation')
      if (!participants.has(body.payerParticipantId)) throw badRequest('payer must be a participant of this trip')
      for (const id of [...includedIds, body.payerParticipantId]) {
        const p = participants.get(id)
        if (!p) throw badRequest('all allocation participants must belong to this trip')
      }

      const amountMinor = parseAmountToMinor(body.amount, String(trip.currency).trim())
      // Weights are re-snapshotted for this edit only; participant defaults
      // are never rewritten, and other expenses keep their own snapshots.
      const allocations = allocate(
        amountMinor,
        body.participants.map((p) => ({ participantId: p.participantId, weight: p.weight })),
      )
      await client.query(
        `update expense set description = $2, expense_date = coalesce($3, expense_date),
           category = $4, amount_minor = $5, payer_participant_id = $6, updated_at = now()
         where id = $1`,
        [req.params.expenseId, body.description, body.date ?? null, body.category?.trim() || null, amountMinor, body.payerParticipantId],
      )
      await client.query('delete from expense_allocation where expense_id = $1', [req.params.expenseId])
      for (const a of allocations) {
        await client.query(
          `insert into expense_allocation (expense_id, participant_id, weight, amount_minor, position)
           values ($1, $2, $3, $4, $5)`,
          [req.params.expenseId, a.participantId, a.weight, a.amountMinor, a.position],
        )
      }
    })
    res.json({ expense: await fetchExpense(req.params.expenseId!) })
  }),
)

router.delete(
  '/expenses/:expenseId',
  handler(async (req, res) => {
    await requireOwnedExpense(req.params.expenseId!, organizerId(req))
    // Allocations disappear with the expense (ON DELETE CASCADE); trip
    // balances are derived from live rows, so they recalculate immediately.
    await pool.query('delete from expense where id = $1', [req.params.expenseId])
    res.json({ ok: true })
  }),
)

export default router
