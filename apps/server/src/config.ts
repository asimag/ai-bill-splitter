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
}

if (config.prod && config.sessionSecret === 'dev-insecure-secret-change-me') {
  throw new Error('SESSION_SECRET must be set in production')
}
