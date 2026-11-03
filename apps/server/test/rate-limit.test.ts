/**
 * Rate limiter unit tests: window semantics, per-key isolation and the 429
 * shape. The HTTP wiring (auth/upload/AI routes) is exercised live by the
 * Stage 3 integration suite with the limits raised out of the way.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NextFunction, Request, Response } from 'express'
import { createRateLimiter } from '../src/rate-limit.js'

interface FakeRes {
  statusCode: number
  headers: Record<string, string>
  body: unknown
}

function run(limiter: ReturnType<typeof createRateLimiter>, req: Partial<Request>) {
  const res: FakeRes = { statusCode: 0, headers: {}, body: null }
  const resMock = {
    setHeader: (k: string, v: string) => {
      res.headers[k] = v
    },
    status: (c: number) => {
      res.statusCode = c
      return resMock
    },
    json: (b: unknown) => {
      res.body = b
      return resMock
    },
  }
  let nextCalled = false
  limiter.handler(req as Request, resMock as unknown as Response, (() => (nextCalled = true)) as NextFunction)
  return { res, nextCalled }
}

describe('createRateLimiter', () => {
  afterEach(() => vi.useRealTimers())

  it('allows up to max per key per window, then answers 429 with retry-after', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 })
    expect(run(limiter, { ip: '1.1.1.1' }).nextCalled).toBe(true)
    expect(run(limiter, { ip: '1.1.1.1' }).nextCalled).toBe(true)

    const blocked = run(limiter, { ip: '1.1.1.1' })
    expect(blocked.nextCalled).toBe(false)
    expect(blocked.res.statusCode).toBe(429)
    expect(blocked.res.headers['retry-after']).toBeDefined()
    expect(Number(blocked.res.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    expect((blocked.res.body as { error: string }).error).toMatch(/too many requests/)
  })

  it('keeps buckets per key so one client cannot exhaust another', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 })
    expect(run(limiter, { ip: '1.1.1.1' }).nextCalled).toBe(true)
    expect(run(limiter, { ip: '2.2.2.2' }).nextCalled).toBe(true)
    expect(run(limiter, { ip: '1.1.1.1' }).res.statusCode).toBe(429)
  })

  it('honors a custom key function (organizer scoping)', () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 1,
      key: (req) => (req as Request).organizer?.id ?? 'unknown',
    })
    const alice = { ip: '9.9.9.9', organizer: { id: 'a', email: '' } }
    const bob = { ip: '9.9.9.9', organizer: { id: 'b', email: '' } }
    expect(run(limiter, alice as Partial<Request>).nextCalled).toBe(true)
    expect(run(limiter, bob as Partial<Request>).nextCalled).toBe(true)
    expect(run(limiter, alice as Partial<Request>).res.statusCode).toBe(429)
  })

  it('reopens the window after it expires', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-03T12:00:00Z'))
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 })
    expect(run(limiter, { ip: '1.1.1.1' }).nextCalled).toBe(true)
    expect(run(limiter, { ip: '1.1.1.1' }).res.statusCode).toBe(429)

    vi.setSystemTime(new Date('2026-11-03T12:01:01Z'))
    expect(run(limiter, { ip: '1.1.1.1' }).nextCalled).toBe(true)
  })
})
