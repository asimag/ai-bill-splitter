import { Router } from 'express'
import { z } from 'zod'
import { isSupportedCurrency, suggestTransfers } from '@billsplit/core'
import { pool, transaction } from '../db.js'
import { organizerId } from '../auth.js'
import { badRequest, handler, notFound, requireOwnedTrip, toMinor } from '../http.js'

const router = Router()

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

const createTripSchema = z.object({
  name: z.string().trim().min(1).max(120),
  currency: z.string().trim().length(3).transform((c) => c.toUpperCase()),
  startDate: dateSchema.nullish(),
  endDate: dateSchema.nullish(),
})

const patchTripSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  currency: z.string().trim().length(3).transform((c) => c.toUpperCase()).optional(),
  startDate: dateSchema.nullish(),
  endDate: dateSchema.nullish(),
})

function tripJson(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    currency: (row.currency as string).trim(),
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    status: row.status,
    createdAt: row.created_at,
  }
}

router.get(
  '/trips',
  handler(async (req, res) => {
    const { rows } = await pool.query(
      `select t.*,
              count(e.id) filter (where e.status = 'confirmed')::int as expense_count,
              coalesce(sum(e.amount_minor) filter (where e.status = 'confirmed'), 0) as total_minor
         from trip t
         left join expense e on e.trip_id = t.id
        where t.organizer_id = $1
        group by t.id
        order by t.created_at desc`,
      [organizerId(req)],
    )
    res.json({
      trips: rows.map((row) => ({ ...tripJson(row), totalSpentMinor: toMinor(row.total_minor), expenseCount: row.expense_count })),
    })
  }),
)

router.post(
  '/trips',
  handler(async (req, res) => {
    const body = createTripSchema.parse(req.body)
    if (!isSupportedCurrency(body.currency)) throw badRequest(`unsupported currency: ${body.currency}`)
    const { rows } = await pool.query(
      `insert into trip (organizer_id, name, currency, start_date, end_date)
       values ($1, $2, $3, $4, $5) returning *`,
      [organizerId(req), body.name, body.currency, body.startDate ?? null, body.endDate ?? null],
    )
    res.status(201).json({ trip: tripJson(rows[0]!) })
  }),
)

/** Full trip detail: participants, confirmed expenses with allocations, balances. */
router.get(
  '/trips/:tripId',
  handler(async (req, res) => {
    const organizer = organizerId(req)
    const { tripId } = req.params
    const tripResult = await pool.query('select * from trip where id = $1 and organizer_id = $2', [tripId, organizer])
    const trip = tripResult.rows[0]
    if (!trip) throw notFound('trip not found')

    const [participantResult, expenseResult, allocationResult, repaymentResult, receiptResult] = await Promise.all([
      pool.query('select * from participant where trip_id = $1 order by position, created_at', [trip.id]),
      pool.query(`select * from expense where trip_id = $1 and status = 'confirmed' order by expense_date desc, created_at desc`, [trip.id]),
      pool.query(
        `select a.* from expense_allocation a
          join expense e on e.id = a.expense_id
         where e.trip_id = $1
         order by a.expense_id, a.position`,
        [trip.id],
      ),
      pool.query('select * from repayment where trip_id = $1 order by repayment_date desc, created_at desc', [trip.id]),
      pool.query(
        `select r.id, r.status, r.provider_used, r.error_kind, r.extraction, e.id as expense_id
           from receipt r
           left join expense e on e.receipt_id = r.id
          where r.trip_id = $1
          order by r.created_at desc`,
        [trip.id],
      ),
    ])
    const participants = participantResult.rows.map((p) => ({
      id: p.id as string,
      name: p.name as string,
      defaultWeight: p.default_weight as number,
      archived: p.archived as boolean,
      position: p.position as number,
    }))
    const allocationsByExpense = new Map<string, { participantId: string; weight: number; amountMinor: number; position: number }[]>()
    for (const a of allocationResult.rows) {
      const list = allocationsByExpense.get(a.expense_id as string) ?? []
      list.push({
        participantId: a.participant_id as string,
        weight: a.weight as number,
        amountMinor: toMinor(a.amount_minor as string),
        position: a.position as number,
      })
      allocationsByExpense.set(a.expense_id as string, list)
    }
    const expenses = expenseResult.rows.map((e) => ({
        id: e.id as string,
        description: e.description as string,
        date: e.expense_date as string,
        category: (e.category as string | null) ?? null,
        amountMinor: toMinor(e.amount_minor),
        payerParticipantId: e.payer_participant_id as string,
        receiptId: (e.receipt_id as string | null) ?? null,
        allocations: allocationsByExpense.get(e.id as string) ?? [],
      }))

    // Light receipt summaries; full extraction/error detail comes from GET /receipts/:id.
    const receipts = receiptResult.rows.map((r) => {
      const extraction = r.extraction as { total?: string | null; currency?: string | null; merchant?: string | null } | null
      return {
        id: r.id as string,
        status: r.status as string,
        providerUsed: (r.provider_used as string | null) ?? null,
        errorKind: (r.error_kind as string | null) ?? null,
        suggestedTotal: extraction?.total ?? null,
        suggestedCurrency: extraction?.currency ?? null,
        merchant: extraction?.merchant ?? null,
        expenseId: (r.expense_id as string | null) ?? null,
      }
    })

    const repayments = repaymentResult.rows.map((r) => ({
      id: r.id as string,
      fromParticipantId: r.sender_participant_id as string,
      toParticipantId: r.recipient_participant_id as string,
      amountMinor: toMinor(r.amount_minor),
      date: r.repayment_date as string,
      note: (r.note as string | null) ?? null,
      status: r.status as 'recorded' | 'reversed',
      reversedAt: (r.reversed_at as Date | null)?.toISOString() ?? null,
      createdAt: r.created_at,
    }))

    // Net balance = expenses paid - allocated shares
    //               + repayments sent - repayments received.
    // Only status = 'recorded' repayments count; reversed rows are history.
    const paid = new Map<string, number>()
    const share = new Map<string, number>()
    const sent = new Map<string, number>()
    const received = new Map<string, number>()
    let totalSpent = 0
    for (const e of expenses) {
      totalSpent += e.amountMinor
      paid.set(e.payerParticipantId, (paid.get(e.payerParticipantId) ?? 0) + e.amountMinor)
      for (const a of e.allocations) {
        share.set(a.participantId, (share.get(a.participantId) ?? 0) + a.amountMinor)
      }
    }
    for (const r of repayments) {
      if (r.status !== 'recorded') continue
      sent.set(r.fromParticipantId, (sent.get(r.fromParticipantId) ?? 0) + r.amountMinor)
      received.set(r.toParticipantId, (received.get(r.toParticipantId) ?? 0) + r.amountMinor)
    }
    const balances = participants.map((p) => {
      const paidMinor = paid.get(p.id) ?? 0
      const shareMinor = share.get(p.id) ?? 0
      const repaidSentMinor = sent.get(p.id) ?? 0
      const repaidReceivedMinor = received.get(p.id) ?? 0
      return {
        participantId: p.id,
        paidMinor,
        shareMinor,
        repaidSentMinor,
        repaidReceivedMinor,
        netMinor: paidMinor - shareMinor + repaidSentMinor - repaidReceivedMinor,
      }
    })
    // Advice only: suggestions never change balances until recorded as repayments.
    const suggestions = suggestTransfers(balances.map((b) => ({ participantId: b.participantId, netMinor: b.netMinor })))

    res.json({
      trip: tripJson(trip),
      participants,
      expenses,
      repayments,
      receipts,
      totals: { totalSpentMinor: totalSpent, expenseCount: expenses.length },
      balances,
      suggestions,
    })
  }),
)

router.patch(
  '/trips/:tripId',
  handler(async (req, res) => {
    const body = patchTripSchema.parse(req.body)
    const result = await transaction(async (client) => {
      const trip = await requireOwnedTrip(client, organizerId(req), req.params.tripId!)
      if (body.currency && body.currency !== trip.currency) {
        const { rows } = await client.query('select exists(select 1 from expense where trip_id = $1) as has', [trip.id])
        if (rows[0].has) throw badRequest('cannot change currency after expenses exist')
        if (!isSupportedCurrency(body.currency)) throw badRequest(`unsupported currency: ${body.currency}`)
      }
      const { rows } = await client.query(
        `update trip set
           name = coalesce($2, name),
           currency = coalesce($3, currency),
           start_date = case when $4 then $5 else start_date end,
           end_date = case when $6 then $7 else end_date end
         where id = $1
         returning *`,
        [
          trip.id,
          body.name ?? null,
          body.currency ?? null,
          body.startDate !== undefined,
          body.startDate ?? null,
          body.endDate !== undefined,
          body.endDate ?? null,
        ],
      )
      return rows[0]!
    })
    res.json({ trip: tripJson(result) })
  }),
)

router.delete(
  '/trips/:tripId',
  handler(async (req, res) => {
    const { rowCount } = await pool.query('delete from trip where id = $1 and organizer_id = $2', [
      req.params.tripId,
      organizerId(req),
    ])
    if (!rowCount) throw notFound('trip not found')
    res.json({ ok: true })
  }),
)

export default router
