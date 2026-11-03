import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import { errorHandler } from './http.js'
import { requireAuth } from './auth.js'
import aiRoutes from './routes/ai.js'
import authRoutes from './routes/auth.js'
import expenseRoutes from './routes/expenses.js'
import participantRoutes from './routes/participants.js'
import receiptRoutes from './routes/receipts.js'
import repaymentRoutes from './routes/repayments.js'
import tripRoutes from './routes/trips.js'

/** Build the API app. Kept separate from index.ts so tests can mount it. */
export function createApp(): express.Express {
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
  app.use('/api', requireAuth, tripRoutes, participantRoutes, expenseRoutes, repaymentRoutes, receiptRoutes, aiRoutes)
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }))
  app.use(errorHandler)
  return app
}
