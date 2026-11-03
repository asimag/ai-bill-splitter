import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, type Expense, type TripDetail } from '../api'
import { money } from '../format'

export function TripPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<TripDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!tripId) return
    api
      .get<TripDetail>(`/trips/${tripId}`)
      .then(setDetail)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'failed to load trip'))
  }, [tripId])

  useEffect(load, [load])

  async function deleteExpense(expense: Expense) {
    if (!confirm(`Delete "${expense.description}" (${money(expense.amountMinor, detail!.trip.currency)})? Balances will be recalculated.`)) return
    try {
      await api.del(`/expenses/${expense.id}`)
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'delete failed')
    }
  }

  if (error && !detail) return <p className="error">{error}</p>
  if (!detail) return <p className="muted">Loading…</p>

  const { trip, participants, expenses, totals, balances } = detail
  const byId = new Map(participants.map((p) => [p.id, p]))
  const nameOf = (id: string) => byId.get(id)?.name ?? 'Unknown'
  const active = participants.filter((p) => !p.archived)
  const sortedBalances = [...balances].sort((a, b) => b.netMinor - a.netMinor)
  const settled = sortedBalances.every((b) => b.netMinor === 0)

  return (
    <div>
      <div className="row-between">
        <h2>
          {trip.name} <span className={`tag ${trip.status}`}>{trip.status}</span>
        </h2>
        <Link className="primary button" to={`/trips/${trip.id}/expenses/new`}>
          + Expense
        </Link>
      </div>
      <p className="muted">
        {trip.currency} · {totals.expenseCount} expenses · {money(totals.totalSpentMinor, trip.currency)} spent
      </p>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h3>People</h3>
        {active.length === 0 && <p className="muted">Add the people sharing this trip.</p>}
        <ul className="people">
          {participants.map((p) => (
            <li key={p.id}>
              <ParticipantRow participant={p} currency={trip.currency} onChanged={load} />
            </li>
          ))}
        </ul>
        <AddParticipantForm tripId={trip.id} onAdded={load} />
      </section>

      <section className="card">
        <h3>Balances</h3>
        {settled ? (
          <p className="muted">Everyone is settled up.</p>
        ) : (
          <table className="balances">
            <thead>
              <tr>
                <th>Person</th>
                <th>Paid</th>
                <th>Share</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {sortedBalances.map((b) => (
                <tr key={b.participantId}>
                  <td>{nameOf(b.participantId)}</td>
                  <td>{money(b.paidMinor, trip.currency)}</td>
                  <td>{money(b.shareMinor, trip.currency)}</td>
                  <td className={b.netMinor > 0 ? 'pos' : b.netMinor < 0 ? 'neg' : ''}>
                    {b.netMinor > 0 ? '+' : ''}
                    {money(b.netMinor, trip.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">Positive = receives back · negative = owes. Settlement suggestions arrive in the next stage.</p>
      </section>

      <section>
        <h3>Expenses</h3>
        {expenses.length === 0 ? (
          <p className="muted">No expenses yet. Add the first bill.</p>
        ) : (
          <ul className="list">
            {expenses.map((x) => (
              <li key={x.id} className="card">
                <div className="row-between">
                  <strong>{x.description}</strong>
                  <span>{money(x.amountMinor, trip.currency)}</span>
                </div>
                <div className="muted small">
                  {x.date}
                  {x.category ? ` · ${x.category}` : ''} · paid by {nameOf(x.payerParticipantId)}
                </div>
                <ul className="shares">
                  {x.allocations.map((a) => (
                    <li key={a.participantId}>
                      {nameOf(a.participantId)} · w{a.weight} · {money(a.amountMinor, trip.currency)}
                    </li>
                  ))}
                </ul>
                <div className="row gap">
                  <Link className="link" to={`/trips/${trip.id}/expenses/${x.id}/edit`}>
                    Edit
                  </Link>
                  <button className="link danger" onClick={() => void deleteExpense(x)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <button
        className="link muted"
        onClick={() => {
          if (confirm(`Delete trip "${trip.name}" and all its data?`)) {
            api
              .del(`/trips/${trip.id}`)
              .then(() => navigate('/'))
              .catch((e) => setError(e instanceof ApiError ? e.message : 'delete failed'))
          }
        }}
      >
        Delete trip
      </button>
    </div>
  )
}

function AddParticipantForm({ tripId, onAdded }: { tripId: string; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [weight, setWeight] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const w = Number.parseInt(weight, 10)
      await api.post(`/trips/${tripId}/participants`, {
        name: name.trim(),
        weight: Number.isFinite(w) && w > 0 ? w : 1,
      })
      setName('')
      setWeight('1')
      onAdded()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to add participant')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="row gap wrap add-person">
      <input className="grow" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
      <label className="weight-label">
        Weight
        <input className="weight-input" type="number" min={1} step={1} value={weight} onChange={(e) => setWeight(e.target.value)} />
      </label>
      <button type="submit" disabled={busy || !name.trim()}>
        Add
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}

function ParticipantRow({
  participant,
  currency,
  onChanged,
}: {
  participant: TripDetail['participants'][number]
  currency: string
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(participant.name)
  const [weight, setWeight] = useState(String(participant.defaultWeight))
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const w = Number.parseInt(weight, 10)
      await api.patch(`/participants/${participant.id}`, {
        name: name.trim() || undefined,
        defaultWeight: Number.isFinite(w) && w > 0 ? w : undefined,
      })
      setEditing(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function archive() {
    setBusy(true)
    try {
      await api.patch(`/participants/${participant.id}`, { archived: !participant.archived })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="row gap wrap">
        <input className="grow" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <label className="weight-label">
          Weight
          <input
            className="weight-input"
            type="number"
            min={1}
            step={1}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </label>
        <button onClick={() => void save()} disabled={busy}>
          Save
        </button>
        <button className="link" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className={`row-between ${participant.archived ? 'archived' : ''}`}>
      <span>
        {participant.name}{' '}
        <span className="muted small">
          weight {participant.defaultWeight}
          {participant.archived ? ' · archived' : ''}
        </span>
      </span>
      <span className="row gap">
        <button className="link" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button className="link" onClick={() => void archive()} disabled={busy}>
          {participant.archived ? 'Restore' : 'Archive'}
        </button>
      </span>
    </div>
  )
}
