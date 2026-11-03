import bcrypt from 'bcryptjs'
import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { pool } from './db.js'
import { unauthorized } from './http.js'

export const SESSION_COOKIE = 'bs_session'
const TOKEN_TTL = '30d'

export interface Organizer {
  id: string
  email: string
}

declare module 'express-serve-static-core' {
  interface Request {
    organizer?: Organizer
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function sessionToken(organizer: Organizer): string {
  return jwt.sign({ sub: organizer.id, email: organizer.email }, config.sessionSecret, {
    expiresIn: TOKEN_TTL,
  })
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.prod,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/api',
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/api' })
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE]
  if (!token) return next(unauthorized())
  try {
    const payload = jwt.verify(token, config.sessionSecret)
    if (typeof payload === 'object' && typeof payload.sub === 'string') {
      req.organizer = { id: payload.sub, email: String(payload.email ?? '') }
      next()
    } else {
      next(unauthorized())
    }
  } catch {
    next(unauthorized())
  }
}

/** Express handler helper: organizer id or 401. */
export function organizerId(req: Request): string {
  if (!req.organizer) throw unauthorized()
  return req.organizer.id
}

/** Existence check used by register to keep emails unique with a friendly error. */
export async function emailTaken(email: string): Promise<boolean> {
  const { rows } = await pool.query('select 1 from organizer where email = $1', [email])
  return rows.length > 0
}
