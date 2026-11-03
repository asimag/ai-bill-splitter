/**
 * Stage 2 API integration tests: run the real Express app against a real
 * PostgreSQL test database (created automatically). Covers the financial
 * invariants from AGENTS.md end-to-end: allocation examples, rounding,
 * snapshots, balances, repayments/reversals, suggestions, validation,
 * currency precision, and organizer isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo, Server } from 'node:net'
import { Client } from 'pg'

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://asim@localhost:5433/billsplit_test'

// Must be set before the app modules load config.
process.env.DATABASE_URL = TEST_DATABASE_URL
process.env.SESSION_SECRET = 'integration-test-secret'
// This suite registers/logs in heavily from one IP; keep rate limits out of
// the way (the limiter itself is unit-tested in rate-limit.test.ts).
process.env.RATE_LIMIT_LOGIN_MAX = '100000'
process.env.RATE_LIMIT_REGISTER_MAX = '100000'

const { createApp } = await import('../src/app.js')
const { migrate } = await import('../src/migrate.js')
const { pool } = await import('../src/db.js')

let baseUrl = ''
let server: Server

async function ensureTestDatabase(): Promise<void> {
  const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1)
  const adminUrl = new URL(TEST_DATABASE_URL)
  adminUrl.pathname = '/postgres'
  const admin = new Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`create database ${dbName}`)
  } catch (err) {
    if ((err as { code?: string }).code !== '42P04') throw err // 42P04 = already exists
  }
  await admin.end()
}

interface Jar {
  cookie?: string
}

async function req<T = any>(jar: Jar, method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(jar.cookie ? { cookie: jar.cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const session = res.headers.getSetCookie().find((c) => c.startsWith('bs_session='))
  if (session) jar.cookie = session.split(';')[0]!
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  return { status: res.status, data: data as T }
}

async function register(email: string): Promise<Jar> {
  const jar: Jar = {}
  const res = await req(jar, 'POST', '/auth/register', { email, password: 'password123' })
  expect(res.status).toBe(201)
  return jar
}

let participantSeq = 0
async function addParticipant(jar: Jar, tripId: string, name: string, weight: number) {
  const res = await req<{ participant: { id: string } }>(jar, 'POST', `/trips/${tripId}/participants`, {
    name,
    weight,
  })
  expect(res.status).toBe(201)
  return res.data.participant.id
}

async function createTrip(jar: Jar, name: string, currency: string) {
  const res = await req<{ trip: { id: string } }>(jar, 'POST', '/trips', {
    name: `${name} #${++participantSeq}`,
    currency,
  })
  expect(res.status).toBe(201)
  return res.data.trip.id
}

async function getTrip(jar: Jar, tripId: string) {
  const res = await req(jar, 'GET', `/trips/${tripId}`)
  expect(res.status).toBe(200)
  return res.data
}

/** Sum of net balances must always be zero (money is conserved). */
function expectZeroSum(balances: { netMinor: number }[]) {
  expect(balances.reduce((s, b) => s + b.netMinor, 0)).toBe(0)
}

beforeAll(async () => {
  await ensureTestDatabase()
  await migrate()
  await pool.query('truncate table organizer cascade')
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
}, 30_000)

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  )
  await pool.end()
})

describe('the AGENTS.md worked example (JOD = 3-decimal currency)', () => {
  it('6,000 at 1:2:1 gives 1,500/3,000/1,500; totals to 9,000 with correct nets and suggestions', async () => {
    const alice = await register('stage2-alice@test.local')
    const tripId = await createTrip(alice, 'Dinner', 'JOD')
    const ali = await addParticipant(alice, tripId, 'Ali', 1)
    const sara = await addParticipant(alice, tripId, 'Sara', 2)
    const ahmed = await addParticipant(alice, tripId, 'Ahmed', 1)

    const e1 = await req(alice, 'POST', `/trips/${tripId}/expenses`, {
      description: 'Dinner one',
      amount: '6.000', // 6,000 fils
      payerParticipantId: ali,
      participants: [
        { participantId: ali, weight: 1 },
        { participantId: sara, weight: 2 },
        { participantId: ahmed, weight: 1 },
      ],
    })
    expect(e1.status).toBe(201)
    expect(e1.data.expense.allocations.map((a: { amountMinor: number }) => a.amountMinor)).toEqual([
      1500, 3000, 1500,
    ])

    const e2 = await req(alice, 'POST', `/trips/${tripId}/expenses`, {
      description: 'Dinner two',
      amount: '3.000',
      payerParticipantId: sara,
      participants: [
        { participantId: ali, weight: 1 },
        { participantId: sara, weight: 2 },
        { participantId: ahmed, weight: 1 },
      ],
    })
    expect(e2.status).toBe(201)

    const detail = await getTrip(alice, tripId)
    const net = Object.fromEntries(
      detail.balances.map((b: { participantId: string; netMinor: number }) => [b.participantId, b.netMinor]),
    )
    // Shares: 2,250 / 4,500 / 2,250. Ali paid 6,000, Sara 3,000, Ahmed 0.
    expect(net[ali]).toBe(3750) // receives 3,750
    expect(net[sara]).toBe(-1500) // owes 1,500
    expect(net[ahmed]).toBe(-2250) // owes 2,250
    expectZeroSum(detail.balances)

    // Every allocation sums exactly to its expense total.
    for (const e of detail.expenses) {
      expect(e.allocations.reduce((s: number, a: { amountMinor: number }) => s + a.amountMinor, 0)).toBe(
        e.amountMinor,
      )
    }

    // Suggestions match the example, largest debtor first; they change nothing.
    expect(detail.suggestions).toEqual([
      { fromParticipantId: ahmed, toParticipantId: ali, amountMinor: 2250 },
      { fromParticipantId: sara, toParticipantId: ali, amountMinor: 1500 },
    ])
    const after = await getTrip(alice, tripId)
    expect(after.balances).toEqual(detail.balances) // suggestions are advice only
  })
})

describe('rounding and snapshots', () => {
  it('100 minor units split equally three ways gives 34/33/33 in stable order', async () => {
    const jar = await register('stage2-round@test.local')
    const tripId = await createTrip(jar, 'Rounding', 'JOD')
    const a = await addParticipant(jar, tripId, 'A', 1)
    const b = await addParticipant(jar, tripId, 'B', 1)
    const c = await addParticipant(jar, tripId, 'C', 1)
    const res = await req(jar, 'POST', `/trips/${tripId}/expenses`, {
      description: 'Tiny bill',
      amount: '0.100', // 100 fils
      payerParticipantId: a,
      participants: [
        { participantId: a, weight: 1 },
        { participantId: b, weight: 1 },
        { participantId: c, weight: 1 },
      ],
    })
    expect(res.data.expense.allocations.map((x: { amountMinor: number }) => x.amountMinor)).toEqual([
      34, 33, 33,
    ])
  })

  it('excluded participants get zero and default-weight changes never rewrite saved allocations', async () => {
    const jar = await register('stage2-snap@test.local')
    const tripId = await createTrip(jar, 'Snapshots', 'JOD')
    const a = await addParticipant(jar, tripId, 'A', 1)
    const b = await addParticipant(jar, tripId, 'B', 2)
    const c = await addParticipant(jar, tripId, 'C', 1) // excluded from the bill
    const res = await req(jar, 'POST', `/trips/${tripId}/expenses`, {
      description: 'Shared by two',
      amount: '6.000',
      payerParticipantId: a,
      participants: [
        { participantId: a, weight: 1 },
        { participantId: b, weight: 2 },
      ],
    })
    expect(res.status).toBe(201)
    const expenseId = res.data.expense.id

    // B's default doubles; the stored expense keeps its snapshot.
    const patch = await req(jar, 'PATCH', `/participants/${b}`, { defaultWeight: 4 })
    expect(patch.status).toBe(200)
    const detail = await getTrip(jar, tripId)
    const expense = detail.expenses.find((e: { id: string }) => e.id === expenseId)
    expect(expense.allocations.map((x: { participantId: string; weight: number; amountMinor: number }) => [x.weight, x.amountMinor])).toEqual([
      [1, 2000],
      [2, 4000],
    ])
    const balC = detail.balances.find((x: { participantId: string }) => x.participantId === c)
    expect(balC.shareMinor).toBe(0)
    expect(balC.netMinor).toBe(0)
    expectZeroSum(detail.balances)

    // A new expense does pick up the new default (as an explicit weight).
    const res2 = await req(jar, 'POST', `/trips/${tripId}/expenses`, {
      description: 'Later bill',
      amount: '5.000',
      payerParticipantId: a,
      participants: [
        { participantId: a, weight: 1 },
        { participantId: b, weight: 4 },
      ],
    })
    expect(res2.data.expense.allocations.map((x: { amountMinor: number }) => x.amountMinor)).toEqual([1000, 4000])
  })
})

describe('expense edits and deletions recalculate balances', () => {
  it('re-allocates on edit and removes the expense on delete', async () => {
    const jar = await register('stage2-edit@test.local')
    const tripId = await createTrip(jar, 'Edits', 'JOD')
    const a = await addParticipant(jar, tripId, 'A', 1)
    const b = await addParticipant(jar, tripId, 'B', 1)
    const created = await req(jar, 'POST', `/trips/${tripId}/expenses`, {
      description: 'Taxi',
      amount: '9.000',
      payerParticipantId: a,
      participants: [
        { participantId: a, weight: 1 },
        { participantId: b, weight: 1 },
      ],
    })
    const expenseId = created.data.expense.id

    const edited = await req(jar, 'PUT', `/expenses/${expenseId}`, {
      description: 'Longer taxi',
      amount: '10.000',
      payerParticipantId: b, // payer changes; balances must follow
      participants: [
        { participantId: a, weight: 1 },
        { participantId: b, weight: 1 },
      ],
    })
    expect(edited.status).toBe(200)
    let detail = await getTrip(jar, tripId)
    const net = (id: string) => detail.balances.find((x: any) => x.participantId === id).netMinor
    expect(net(a)).toBe(-5000)
    expect(net(b)).toBe(5000)
    expectZeroSum(detail.balances)

    const del = await req(jar, 'DELETE', `/expenses/${expenseId}`)
    expect(del.status).toBe(200)
    detail = await getTrip(jar, tripId)
    expect(detail.expenses).toHaveLength(0)
    expect(detail.balances.every((x: { netMinor: number }) => x.netMinor === 0)).toBe(true)
    expect(detail.suggestions).toEqual([])
  })
})

describe('repayments', () => {
  async function scenario() {
    const jar = await register(`stage2-repay${++participantSeq}@test.local`)
    const tripId = await createTrip(jar, 'Trip', 'JOD')
    const ali = await addParticipant(jar, tripId, 'Ali', 1)
    const sara = await addParticipant(jar, tripId, 'Sara', 2)
    const ahmed = await addParticipant(jar, tripId, 'Ahmed', 1)
    for (const [amount, payer] of [['6.000', ali], ['3.000', sara]] as const) {
      const res = await req(jar, 'POST', `/trips/${tripId}/expenses`, {
        description: `Bill ${amount}`,
        amount,
        payerParticipantId: payer,
        participants: [
          { participantId: ali, weight: 1 },
          { participantId: sara, weight: 2 },
          { participantId: ahmed, weight: 1 },
        ],
      })
      expect(res.status).toBe(201)
    }
    return { jar, tripId, ali, sara, ahmed }
  }

  it('records a repayment, updates balances and suggestions, reverses, and restores without double-counting', async () => {
    const { jar, tripId, ali, sara, ahmed } = await scenario()

    const rec = await req(jar, 'POST', `/trips/${tripId}/repayments`, {
      fromParticipantId: ahmed,
      toParticipantId: ali,
      amount: '1.000',
      note: 'cash on the train',
    })
    expect(rec.status).toBe(201)
    const repaymentId = rec.data.repayment.id

    let detail = await getTrip(jar, tripId)
    const net = (id: string) => detail.balances.find((x: any) => x.participantId === id).netMinor
    // Ahmed sent 1,000 of his 2,250 debt; Ali received it.
    expect(net(ahmed)).toBe(-1250)
    expect(net(ali)).toBe(2750)
    expect(net(sara)).toBe(-1500)
    expectZeroSum(detail.balances)
    const ahmedBal = detail.balances.find((x: any) => x.participantId === ahmed)
    expect(ahmedBal.repaidSentMinor).toBe(1000)
    const aliBal = detail.balances.find((x: any) => x.participantId === ali)
    expect(aliBal.repaidReceivedMinor).toBe(1000)
    // Suggestions shrink accordingly (largest debtor Sara now).
    expect(detail.suggestions).toEqual([
      { fromParticipantId: sara, toParticipantId: ali, amountMinor: 1500 },
      { fromParticipantId: ahmed, toParticipantId: ali, amountMinor: 1250 },
    ])

    // Reverse: the row stays visible but stops counting.
    const rev = await req(jar, 'POST', `/repayments/${repaymentId}/reverse`, {})
    expect(rev.status).toBe(200)
    expect(rev.data.repayment.status).toBe('reversed')
    expect(rev.data.repayment.reversedAt).not.toBeNull()
    detail = await getTrip(jar, tripId)
    expect(net(ahmed)).toBe(-2250) // back to pre-repayment
    expect(net(ali)).toBe(3750)
    expectZeroSum(detail.balances)
    expect(detail.repayments).toHaveLength(1) // history keeps it
    expect(detail.repayments[0].status).toBe('reversed')
    expect(detail.repayments[0].amountMinor).toBe(1000)

    // Restoring re-counts it exactly once (no double-count).
    const restored = await req(jar, 'PUT', `/repayments/${repaymentId}`, { status: 'recorded' })
    expect(restored.status).toBe(200)
    expect(restored.data.repayment.status).toBe('recorded')
    expect(restored.data.repayment.reversedAt).toBeNull()
    detail = await getTrip(jar, tripId)
    expect(net(ahmed)).toBe(-1250)
    expect(net(ali)).toBe(2750)
    expectZeroSum(detail.balances)

    // Correct the amount of a recorded repayment instead of reversing.
    const corrected = await req(jar, 'PUT', `/repayments/${repaymentId}`, { amount: '2.000', note: 'actually more' })
    expect(corrected.status).toBe(200)
    expect(corrected.data.repayment.amountMinor).toBe(2000)
    detail = await getTrip(jar, tripId)
    expect(net(ahmed)).toBe(-250)
    expect(net(ali)).toBe(1750)
    expectZeroSum(detail.balances)

    // Reversing an already-reversed repayment is rejected.
    await req(jar, 'POST', `/repayments/${repaymentId}/reverse`, {})
    const again = await req(jar, 'POST', `/repayments/${repaymentId}/reverse`, {})
    expect(again.status).toBe(400)
  })

  it('rejects invalid repayments', async () => {
    const { jar, tripId, ali, sara } = await scenario()
    const outsider = await register('stage2-outsider@test.local')
    const otherTrip = await createTrip(outsider, 'Elsewhere', 'JOD')
    const stranger = await addParticipant(outsider, otherTrip, 'Stranger', 1)

    const cases: [unknown, number][] = [
      [{ fromParticipantId: ali, toParticipantId: ali, amount: '1.000' }, 400], // self-payment
      [{ fromParticipantId: sara, toParticipantId: stranger, amount: '1.000' }, 400], // outsider
      [{ fromParticipantId: ali, toParticipantId: sara, amount: '0' }, 400], // zero
      [{ fromParticipantId: ali, toParticipantId: sara, amount: '-1.000' }, 400], // negative
      [{ fromParticipantId: ali, toParticipantId: sara, amount: '1.2345' }, 400], // > 3 decimals for JOD
    ]
    for (const [body, status] of cases) {
      const res = await req(jar, 'POST', `/trips/${tripId}/repayments`, body)
      expect(res.status, JSON.stringify(body)).toBe(status)
    }
    // Another organizer cannot touch this trip or its repayments.
    expect((await req(outsider, 'GET', `/trips/${tripId}`)).status).toBe(404)
    expect(
      (await req(outsider, 'POST', `/trips/${tripId}/repayments`, {
        fromParticipantId: ali,
        toParticipantId: sara,
        amount: '1.000',
      })).status,
    ).toBe(404)
  })
})

describe('validation, precision, and isolation', () => {
  it('enforces auth, membership, archived, amounts, and per-currency precision', async () => {
    const anon: Jar = {}
    expect((await req(anon, 'GET', '/trips')).status).toBe(401)

    const jar = await register('stage2-valid@test.local')
    const tripId = await createTrip(jar, 'Validation', 'JOD')
    const a = await addParticipant(jar, tripId, 'A', 1)
    const b = await addParticipant(jar, tripId, 'B', 1)

    const foreign = await register('stage2-foreign@test.local')
    const foreignTrip = await createTrip(foreign, 'Private', 'JOD')

    const cases: [() => Promise<{ status: number }>, number, string][] = [
      [
        () =>
          req(jar, 'POST', `/trips/${tripId}/expenses`, {
            description: 'x',
            amount: '1.000',
            payerParticipantId: a,
            participants: [],
          }),
        400,
        'no included participants',
      ],
      [
        () =>
          req(jar, 'POST', `/trips/${foreignTrip}/expenses`, {
            description: 'x',
            amount: '1.000',
            payerParticipantId: a,
            participants: [{ participantId: a, weight: 1 }],
          }),
        404,
        'expense into another organizer trip',
      ],
      [
        () =>
          req(jar, 'POST', `/trips/${tripId}/expenses`, {
            description: 'x',
            amount: '1.000',
            payerParticipantId: a,
            participants: [
              { participantId: a, weight: 1 },
              { participantId: b, weight: 1 },
              { participantId: a, weight: 1 },
            ],
          }),
        400,
        'duplicate participants',
      ],
      [() => req(foreign, 'GET', `/trips/${tripId}`), 404, 'read another organizer trip'],
      [() => req(jar, 'DELETE', `/trips/${foreignTrip}`), 404, 'delete another organizer trip'],
    ]
    for (const [run, status, what] of cases) {
      expect((await run()).status, what).toBe(status)
    }

    // Archived participants are refused on new expenses.
    await req(jar, 'PATCH', `/participants/${b}`, { archived: true })
    const archived = await req(jar, 'POST', `/trips/${tripId}/expenses`, {
      description: 'x',
      amount: '1.000',
      payerParticipantId: a,
      participants: [
        { participantId: a, weight: 1 },
        { participantId: b, weight: 1 },
      ],
    })
    expect(archived.status).toBe(400)

    // Amount format against JOD precision (3 decimals).
    const badAmounts = ['0', '-5', 'abc', '1.2345', '1.', '.5']
    for (const amount of badAmounts) {
      const res = await req(jar, 'POST', `/trips/${tripId}/expenses`, {
        description: 'x',
        amount,
        payerParticipantId: a,
        participants: [{ participantId: a, weight: 1 }],
      })
      expect(res.status, `amount ${amount}`).toBe(400)
    }
  })

  it('applies zero-decimal precision for JPY', async () => {
    const jar = await register('stage2-jpy@test.local')
    const tripId = await createTrip(jar, 'Tokyo', 'JPY')
    const a = await addParticipant(jar, tripId, 'A', 1)
    const ok = await req(jar, 'POST', `/trips/${tripId}/expenses`, {
      description: 'Ramen',
      amount: '1500',
      payerParticipantId: a,
      participants: [{ participantId: a, weight: 1 }],
    })
    expect(ok.status).toBe(201)
    expect(ok.data.expense.amountMinor).toBe(1500)
    const bad = await req(jar, 'POST', `/trips/${tripId}/expenses`, {
      description: 'Ramen',
      amount: '1500.5',
      payerParticipantId: a,
      participants: [{ participantId: a, weight: 1 }],
    })
    expect(bad.status).toBe(400)
  })

  it('currency cannot be changed once expenses exist', async () => {
    const jar = await register('stage2-currency@test.local')
    const tripId = await createTrip(jar, 'NoSwitch', 'JOD')
    const a = await addParticipant(jar, tripId, 'A', 1)
    await req(jar, 'POST', `/trips/${tripId}/expenses`, {
      description: 'x',
      amount: '1.000',
      payerParticipantId: a,
      participants: [{ participantId: a, weight: 1 }],
    })
    const res = await req(jar, 'PATCH', `/trips/${tripId}`, { currency: 'USD' })
    expect(res.status).toBe(400)
  })
})
