import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import { config } from './config.js'
import { pool } from './db.js'
import { errorHandler } from './http.js'
import { requireAuth } from './auth.js'
import { migrate } from './migrate.js'
import authRoutes from './routes/auth.js'
import expenseRoutes from './routes/expenses.js'
import participantRoutes from './routes/participants.js'
import tripRoutes from './routes/trips.js'

const app = express()
app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.use('/api/auth', authRoutes)
app.use('/api', requireAuth, tripRoutes, participantRoutes, expenseRoutes)
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }))
app.use(errorHandler)

// Apply pending migrations at startup so deploys never run against a stale schema.
const applied = await migrate()
if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`)

app.listen(config.port, () => {
  console.log(`bill-splitter API listening on http://localhost:${config.port}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void pool.end().finally(() => process.exit(0))
  })
}
