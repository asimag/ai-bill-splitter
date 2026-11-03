import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { config } from './config.js'

/**
 * Small in-process fixed-window rate limiter. Deliberately dependency-free and
 * per-process: correct for the single-container deployment, and if the API
 * ever runs multiple replicas this is the seam to swap for a shared store.
 */
export interface RateLimiterOptions {
  windowMs: number
  max: number
  /** Bucket key; defaults to the client IP. */
  key?: (req: Request) => string
}

export interface RateLimiter {
  handler: RequestHandler
  reset(): void
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  let lastSweep = 0
  const keyOf = opts.key ?? ((req: Request) => req.ip ?? 'unknown')

  const handler: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    if (now - lastSweep > opts.windowMs) {
      for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
      lastSweep = now
    }
    const key = keyOf(req)
    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs }
      buckets.set(key, bucket)
    }
    bucket.count++
    if (bucket.count > opts.max) {
      res.setHeader('retry-after', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))))
      res.status(429).json({ error: 'too many requests — please wait before retrying' })
      return
    }
    next()
  }
  return { handler, reset: () => buckets.clear() }
}

/** Auth endpoints are keyed by client IP (attacker changes email, not IP). */
export const loginLimiter = createRateLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.loginMax })
export const registerLimiter = createRateLimiter({ windowMs: 60 * 60_000, max: config.rateLimit.registerMax })

/** AI-consuming endpoints are keyed by organizer so one IP behind NAT is fair. */
const organizerKey = (req: Request) => req.organizer?.id ?? req.ip ?? 'unknown'
export const receiptUploadLimiter = createRateLimiter({ windowMs: 60 * 60_000, max: config.rateLimit.uploadMax, key: organizerKey })
export const receiptRetryLimiter = createRateLimiter({ windowMs: 60 * 60_000, max: config.rateLimit.uploadMax, key: organizerKey })
export const aiTestLimiter = createRateLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.aiTestMax, key: organizerKey })
