import pg from 'pg'
import { config } from './config.js'

// Return DATE columns as plain 'YYYY-MM-DD' strings (not JS Dates) so
// expense dates never shift with server timezones.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v)

export const pool = new pg.Pool({ connectionString: config.databaseUrl })

/** Run fn inside a transaction; commit on success, rollback on error. */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
