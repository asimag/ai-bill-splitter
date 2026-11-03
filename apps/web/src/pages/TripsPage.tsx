import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError, type Trip } from '../api'
import { COMMON_CURRENCIES } from '@billsplit/core'
import { money, todayISO } from '../format'

export function TripsPage() {
  const [trips, setTrips] = useState<Trip[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const navigate = useNavigate()

  const load = useCallback(() => {
    api
      .get<{ trips: Trip[] }>('/trips')
      .then((r) => setTrips(r.trips))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'failed to load trips'))
  }, [])

  useEffect(load, [load])

  return (
    <div>
      <div className="row-between">
        <h2>Trips</h2>
        <button className="primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancel' : '+ New trip'}
        </button>
      </div>
      {showForm && (
        <NewTripForm
          onCreated={(t) => {
            load()
            navigate(`/trips/${t.id}`)
          }}
        />
      )}
      {error && <p className="error">{error}</p>}
      {trips === null ? (
        <p className="muted">Loading…</p>
      ) : trips.length === 0 ? (
        <p className="muted">No trips yet. Create one, or try Quick split for a one-off bill.</p>
      ) : (
        <ul className="list">
          {trips.map((t) => (
            <li key={t.id} className="card">
              <Link className="trip-link" to={`/trips/${t.id}`}>
                <div className="row-between">
                  <strong>{t.name}</strong>
                  <span className={`tag ${t.status}`}>{t.status}</span>
                </div>
                <div className="muted">
                  {t.currency} · {t.expenseCount ?? 0} expenses
                  {(t.totalSpentMinor ?? 0) > 0 && <> · {money(t.totalSpentMinor ?? 0, t.currency)} spent</>}
                  {t.startDate && <> · {t.startDate}{t.endDate ? ` – ${t.endDate}` : ''}</>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NewTripForm({ onCreated }: { onCreated: (t: Trip) => void }) {
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ trip: Trip }>('/trips', {
        name,
        currency,
        startDate: startDate || null,
        endDate: endDate || null,
      })
      onCreated(r.trip)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to create trip')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="card form">
      <label>
        Trip name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="Lahore food week" />
      </label>
      <label>
        Currency (one per trip)
        <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {COMMON_CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <div className="form-row">
        <label>
          Start (optional)
          <input type="date" max={todayISO()} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label>
          End (optional)
          <input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <button type="submit" className="primary" disabled={busy}>
        {busy ? '…' : 'Create trip'}
      </button>
    </form>
  )
}
