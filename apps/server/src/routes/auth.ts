import { Router } from 'express'
import { z } from 'zod'
import { pool, transaction } from '../db.js'
import {
  clearSessionCookie,
  emailTaken,
  hashPassword,
  organizerId,
  requireAuth,
  sessionToken,
  setSessionCookie,
  verifyPassword,
} from '../auth.js'
import { badRequest, handler, HttpError, unauthorized } from '../http.js'

const router = Router()

const credentialsSchema = z.object({
  email: z.string().trim().min(3).max(254).email(),
  password: z.string().min(8).max(200),
})

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

router.post(
  '/register',
  handler(async (req, res) => {
    const { email, password } = credentialsSchema.parse(req.body)
    const normalized = normalizeEmail(email)
    if (await emailTaken(normalized)) throw badRequest('an account with this email already exists')
    const hash = await hashPassword(password)
    const organizer = await transaction(async (client) => {
      const { rows } = await client.query(
        `insert into organizer (email, password_hash) values ($1, $2)
         returning id, email`,
        [normalized, hash],
      )
      return rows[0]!
    })
    setSessionCookie(res, sessionToken(organizer))
    res.status(201).json({ organizer })
  }),
)

router.post(
  '/login',
  handler(async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body)
    if (!parsed.success) throw unauthorized('invalid email or password')
    const { rows } = await pool.query('select id, email, password_hash from organizer where email = $1', [
      normalizeEmail(parsed.data.email),
    ])
    const record = rows[0] as { id: string; email: string; password_hash: string } | undefined
    if (!record || !(await verifyPassword(parsed.data.password, record.password_hash))) {
      throw unauthorized('invalid email or password')
    }
    const organizer = { id: record.id, email: record.email }
    setSessionCookie(res, sessionToken(organizer))
    res.json({ organizer })
  }),
)

router.post('/logout', (_req, res) => {
  clearSessionCookie(res)
  res.json({ ok: true })
})

router.get(
  '/me',
  requireAuth,
  handler(async (req, res) => {
    const id = organizerId(req)
    const { rows } = await pool.query('select id, email from organizer where id = $1', [id])
    if (!rows[0]) throw unauthorized()
    res.json({ organizer: rows[0] })
  }),
)

export default router
