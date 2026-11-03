import { Router } from 'express'
import { z } from 'zod'
import { pool, transaction } from '../db.js'
import { organizerId } from '../auth.js'
import { badRequest, handler, notFound } from '../http.js'

const router = Router()

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  weight: z.number().int().positive().optional().default(1),
})

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  defaultWeight: z.number().int().positive().optional(),
  archived: z.boolean().optional(),
})

function participantJson(p: Record<string, unknown>) {
  return {
    id: p.id as string,
    name: p.name as string,
    defaultWeight: p.default_weight as number,
    archived: p.archived as boolean,
    position: p.position as number,
  }
}

async function findOwnedParticipant(participantId: string, organizer: string) {
  const { rows } = await pool.query(
    `select p.* from participant p
      join trip t on t.id = p.trip_id
     where p.id = $1 and t.organizer_id = $2`,
    [participantId, organizer],
  )
  return rows[0] as Record<string, unknown> | undefined
}

router.post(
  '/trips/:tripId/participants',
  handler(async (req, res) => {
    const body = createSchema.parse(req.body)
    const participant = await transaction(async (client) => {
      const trip = await client.query('select id, status from trip where id = $1 and organizer_id = $2', [
        req.params.tripId,
        organizerId(req),
      ])
      if (!trip.rows[0]) throw notFound('trip not found')
      const { rows } = await client.query(
        `insert into participant (trip_id, name, default_weight, position)
         select $1, $2, $3, coalesce(max(position), -1) + 1 from participant where trip_id = $1
         returning *`,
        [trip.rows[0].id, body.name, body.weight],
      )
      return rows[0]!
    })
    res.status(201).json({ participant: participantJson(participant) })
  }),
)

router.patch(
  '/participants/:participantId',
  handler(async (req, res) => {
    const body = patchSchema.parse(req.body)
    if (Object.keys(body).length === 0) throw badRequest('nothing to update')
    const existing = await findOwnedParticipant(req.params.participantId!, organizerId(req))
    if (!existing) throw notFound('participant not found')
    const { rows } = await pool.query(
      `update participant set
         name = coalesce($2, name),
         default_weight = coalesce($3, default_weight),
         archived = coalesce($4, archived)
       where id = $1
       returning *`,
      [existing.id, body.name ?? null, body.defaultWeight ?? null, body.archived ?? null],
    )
    res.json({ participant: participantJson(rows[0]!) })
  }),
)

export default router
