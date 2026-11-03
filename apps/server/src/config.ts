import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Load the repo-root .env regardless of the workspace cwd the script starts in.
try {
  const rootEnv = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env')
  process.loadEnvFile(rootEnv)
} catch {
  /* no root .env — plain environment wins */
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://asim@localhost:5433/billsplit_dev',
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-insecure-secret-change-me',
  prod: process.env.PROD === 'true',

  // Stage 3 — receipt AI. Env values are server defaults; an organizer may
  // override mode/Gemini model/Gemini key in settings (never the local endpoint).
  receiptAiMode: process.env.RECEIPT_AI_MODE ?? 'auto',
  localAiBaseUrl: process.env.LOCAL_AI_BASE_URL?.trim() ?? '',
  localAiModel: process.env.LOCAL_AI_MODEL?.trim() ?? '',
  localAiApiKey: process.env.LOCAL_AI_API_KEY?.trim() ?? '',
  // Verified 2026-11-03 against a live key's model list + image generateContent
  // call: gemini-3.8-flash is the current stable Flash with image input.
  geminiModel: process.env.GEMINI_MODEL?.trim() ?? 'gemini-3.8-flash',
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() ?? '',
  receiptAiTimeoutMs: Number(process.env.RECEIPT_AI_TIMEOUT_MS ?? 30_000),

  // Separate server-only secret for encrypting stored API keys at rest.
  credentialsSecret: process.env.CREDENTIALS_SECRET ?? 'dev-insecure-credentials-secret-change-me',

  // Private receipt storage outside any web root; mount a volume in Docker.
  receiptStorageDir:
    process.env.RECEIPT_STORAGE_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'receipts-storage'),
  receiptMaxBytes: Number(process.env.RECEIPT_MAX_BYTES ?? 10 * 1024 * 1024),

  // Access control. Public registration lets anyone consume the server's AI
  // quota, so deployments default to closed (register, then set false).
  allowRegistration: (process.env.ALLOW_REGISTRATION ?? 'true').trim().toLowerCase() !== 'false',
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60_000),
    loginMax: Number(process.env.RATE_LIMIT_LOGIN_MAX ?? 20),
    registerMax: Number(process.env.RATE_LIMIT_REGISTER_MAX ?? 5),
    uploadMax: Number(process.env.RATE_LIMIT_UPLOAD_MAX ?? 30),
    aiTestMax: Number(process.env.RATE_LIMIT_AI_TEST_MAX ?? 10),
  },
}

if (config.prod && config.sessionSecret === 'dev-insecure-secret-change-me') {
  throw new Error('SESSION_SECRET must be set in production')
}
if (config.prod && config.credentialsSecret === 'dev-insecure-credentials-secret-change-me') {
  throw new Error('CREDENTIALS_SECRET must be set in production (encrypts saved API keys)')
}
if (!['auto', 'local', 'gemini', 'tesseract'].includes(config.receiptAiMode)) {
  throw new Error(`RECEIPT_AI_MODE must be auto|local|gemini|tesseract, got: ${config.receiptAiMode}`)
}
