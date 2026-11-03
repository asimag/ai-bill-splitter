import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, transaction } from './db.js'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

/** Apply pending migrations in filename order, each in its own transaction. */
export async function migrate(): Promise<string[]> {
  await pool.query(
    `create table if not exists schema_migrations (
       filename text primary key,
       applied_at timestamptz not null default now()
     )`,
  )
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  const applied: string[] = []
  for (const file of files) {
    const done = await transaction(async (client) => {
      const { rows } = await client.query('select 1 from schema_migrations where filename = $1', [file])
      if (rows.length > 0) return true
      const sql = await fs.readFile(path.join(dir, file), 'utf8')
      await client.query(sql)
      await client.query('insert into schema_migrations (filename) values ($1)', [file])
      return true
    })
    if (done) applied.push(file)
  }
  return applied
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))
if (invokedDirectly) {
  const applied = await migrate()
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'database already up to date')
  await pool.end()
}
