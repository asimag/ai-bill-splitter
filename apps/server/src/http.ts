import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { ZodError } from 'zod'
import type { PoolClient } from 'pg'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg)
export const unauthorized = (msg = 'authentication required') => new HttpError(401, msg)
export const notFound = (msg = 'not found') => new HttpError(404, msg)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Route params are user input; a malformed id is "not found", not a 500. */
export function isUuid(value: string | undefined): value is string {
  return !!value && UUID_RE.test(value)
}

type AsyncHandler = (req: Request, res: Response) => Promise<unknown>

/** Wrap an async route so rejections reach the error middleware.
 *  All current :params are UUIDs, so malformed ids short-circuit to 404. */
export function handler(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    for (const value of Object.values(req.params)) {
      if (!isUuid(value)) {
        next(notFound('not found'))
        return
      }
    }
    fn(req, res).catch(next)
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'invalid request', details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) })
    return
  }
  if (err instanceof RangeError) {
    res.status(400).json({ error: err.message })
    return
  }
  if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
    res.status(409).json({ error: 'duplicate record' })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'internal error' })
}

/** Parse a bigint minor-unit column, refusing unsafe values. */
export function toMinor(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(n)) throw new Error(`unsafe minor-unit amount in database: ${value}`)
  return n
}

/** Read the trip and confirm the caller owns it; 404 otherwise. */
export async function requireOwnedTrip(client: PoolClient, organizerId: string, tripId: string) {
  const { rows } = await client.query(
    'select id, currency, status from trip where id = $1 and organizer_id = $2',
    [tripId, organizerId],
  )
  const trip = rows[0]
  if (!trip) throw notFound('trip not found')
  return trip as { id: string; currency: string; status: 'open' | 'closed' }
}
