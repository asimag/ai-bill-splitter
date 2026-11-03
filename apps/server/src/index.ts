import { config } from './config.js'
import { pool } from './db.js'
import { createApp } from './app.js'
import { migrate } from './migrate.js'
import { ensureStorageDir } from './storage.js'
import { recoverStuckReceipts } from './ai/service.js'

const app = createApp()

// Apply pending migrations at startup so deploys never run against a stale schema.
const applied = await migrate()
if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`)

await ensureStorageDir()
const stuck = await recoverStuckReceipts()
if (stuck) console.log(`receipt extraction jobs re-queued after restart: ${stuck}`)

app.listen(config.port, () => {
  console.log(`bill-splitter API listening on http://localhost:${config.port}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void pool.end().finally(() => process.exit(0))
  })
}
