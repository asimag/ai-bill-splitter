import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError, type TripDetail } from '../api'

/**
 * People setup for a trip. Membership and default weights live here so the
 * trip screen can stay focused on expenses and balances. Saved default weights
 * only affect expenses created after the change; existing expenses keep their
 * own weight snapshots.
 */
export function TripPeoplePage() {
  const { tripId } = useParams<{ tripId: string }>()
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

  if (error && !detail) return <p className="error">{error}</p>
  if (!detail) return <p className="muted">Loading…</p>

  const { trip, participants } = detail

  return (
    <div>
      <div className="row-between">
        <h2>People</h2>
        <Link className="link" to={`/trips/${trip.id}`}>
          ← {trip.name}
        </Link>
      </div>
      <p className="muted">
        Add everyone sharing this trip once. Weights split a bill unevenly on purpose: weight 2 pays double weight 1.
      </p>
      {error && <p className="error">{error}</p>}

      <section className="card">
        {participants.length === 0 && <p className="muted">No one added yet. Add the first person below.</p>}
        <ul className="people">
          {participants.map((p) => (
            <li key={p.id}>
              <ParticipantRow participant={p} onChanged={load} />
            </li>
          ))}
        </ul>
        <AddParticipantForm tripId={trip.id} onAdded={load} />
        <p className="muted small">
          Changing a weight here affects new expenses only — saved bills keep the weights they were split with.
          Archiving keeps someone in past totals without offering them for new bills.
        </p>
      </section>

      <Link className="big-add button" to={`/trips/${trip.id}/expenses/new`}>
        ＋ Add expense
      </Link>
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
  onChanged,
}: {
  participant: TripDetail['participants'][number]
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
