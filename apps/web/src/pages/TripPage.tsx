import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { formatMinor } from '@billsplit/core'
import { api, ApiError, type Expense, type TransferSuggestion, type TripDetail } from '../api'
import { money, todayISO } from '../format'

const PAYMENT_LABEL: Record<string, string> = { cash: '💵 cash', card: '💳 card', transfer: '📲 transfer', other: '🧾 other' }

export function TripPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<TripDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [prefill, setPrefill] = useState<TransferSuggestion | null>(null)

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

  async function reverseRepayment(repaymentId: string) {
    try {
      await api.post(`/repayments/${repaymentId}/reverse`, {})
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'reverse failed')
    }
  }

  async function restoreRepayment(repaymentId: string) {
    try {
      await api.put(`/repayments/${repaymentId}`, { status: 'recorded' })
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'restore failed')
    }
  }

  async function discardReceipt(receiptId: string) {
    if (!confirm('Discard this receipt and its stored photo?')) return
    try {
      await api.del(`/receipts/${receiptId}`)
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'discard failed')
    }
  }

  if (error && !detail) return <p className="error">{error}</p>
  if (!detail) return <p className="muted">Loading…</p>

  const { trip, participants, expenses, totals, balances } = detail
  const byId = new Map(participants.map((p) => [p.id, p]))
  const nameOf = (id: string) => byId.get(id)?.name ?? 'Unknown'
  const activeCount = participants.filter((p) => !p.archived).length
  const sortedBalances = [...balances].sort((a, b) => b.netMinor - a.netMinor)
  const settled = sortedBalances.every((b) => b.netMinor === 0)
  const unattachedReceipts = (detail.receipts ?? []).filter((r) => !r.expenseId)

  return (
    <div>
      <div className="row-between">
        <h2>
          {trip.name} <span className={`tag ${trip.status}`}>{trip.status}</span>
        </h2>
        <Link className="link" to={`/trips/${trip.id}/people`}>
          👥 {activeCount} {activeCount === 1 ? 'person' : 'people'}
        </Link>
      </div>
      <p className="muted">
        {trip.currency} · {totals.expenseCount} expenses · {money(totals.totalSpentMinor, trip.currency)} spent
      </p>
      {error && <p className="error">{error}</p>}

      {activeCount === 0 ? (
        <Link className="big-add button" to={`/trips/${trip.id}/people`}>
          👥 Add the people sharing this bill
        </Link>
      ) : (
        <Link className="big-add button" to={`/trips/${trip.id}/expenses/new`}>
          ＋ Add expense
        </Link>
      )}

      <section>
        <h3>Expenses</h3>
        {unattachedReceipts.length > 0 && (
          <div className="card">
            <h4 style={{ margin: '0 0 6px' }}>Receipts awaiting review</h4>
            <ul className="list-flat">
              {unattachedReceipts.map((r) => (
                <li key={r.id} className="row-between">
                  <span>
                    {r.merchant ?? 'Receipt'}{' '}
                    {r.suggestedTotal ? (
                      <strong>
                        {r.suggestedTotal} {r.suggestedCurrency ?? trip.currency}
                      </strong>
                    ) : (
                      ''
                    )}
                    <span className="muted small">
                      {' '}
                      · {r.status === 'extracted' ? 'scanned' : r.status}
                      {r.providerUsed ? ` via ${r.providerUsed}` : ''}
                      {r.errorKind ? ` (${r.errorKind})` : ''}
                    </span>
                  </span>
                  <span className="row gap">
                    {r.status === 'extracted' && (
                      <Link className="link" to={`/trips/${trip.id}/expenses/new?receiptId=${r.id}`}>
                        Review
                      </Link>
                    )}
                    <button className="link danger" onClick={() => void discardReceipt(r.id)}>
                      Discard
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <p className="muted small">Scanned amounts only count after you review and save them as expenses.</p>
          </div>
        )}
        {expenses.length === 0 ? (
          <p className="muted">No expenses yet. Add the first bill above.</p>
        ) : (
          <ul className="list">
            {expenses.map((x) => (
              <li key={x.id} className="card">
                <div className="row-between">
                  <strong>{x.description}</strong>
                  <span>{money(x.amountMinor, trip.currency)}</span>
                </div>
                <div className="expense-paid-by">
                  Paid by <strong>{nameOf(x.payerParticipantId)}</strong>
                  {x.paymentMethod ? ` ${PAYMENT_LABEL[x.paymentMethod] ?? x.paymentMethod}` : ''}
                </div>
                <div className="muted small">
                  {x.date}
                  {x.category ? ` · ${x.category}` : ''}
                  {x.receiptId ? (
                    <>
                      {' · '}
                      <a href={api.receiptImageUrl(x.receiptId)} target="_blank" rel="noreferrer">
                        receipt 🧾
                      </a>
                    </>
                  ) : null}
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

      <section className="card">
        <h3>Who owes what</h3>
        {settled ? (
          <p className="muted">Everyone is settled up.</p>
        ) : (
          <ul className="owe-lines">
            {sortedBalances.map((b) => (
              <li key={b.participantId} className="row-between">
                <span>{nameOf(b.participantId)}</span>
                {b.netMinor === 0 ? (
                  <span className="muted">settled ✓</span>
                ) : b.netMinor > 0 ? (
                  <span className="pos">gets back {money(b.netMinor, trip.currency)}</span>
                ) : (
                  <span className="neg">
                    <strong>owes {money(-b.netMinor, trip.currency)}</strong>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <details className="balance-details">
          <summary>Details (paid · share · repayments)</summary>
          <table className="balances">
            <thead>
              <tr>
                <th>Person</th>
                <th>Paid</th>
                <th>Share</th>
                <th>Settled</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {sortedBalances.map((b) => (
                <tr key={b.participantId}>
                  <td>{nameOf(b.participantId)}</td>
                  <td>{money(b.paidMinor, trip.currency)}</td>
                  <td>{money(b.shareMinor, trip.currency)}</td>
                  <td className="muted">
                    {b.repaidSentMinor > 0 || b.repaidReceivedMinor > 0
                      ? `${b.repaidSentMinor > 0 ? `−${money(b.repaidSentMinor, trip.currency)}` : ''}${
                          b.repaidSentMinor > 0 && b.repaidReceivedMinor > 0 ? ' ' : ''
                        }${b.repaidReceivedMinor > 0 ? `+${money(b.repaidReceivedMinor, trip.currency)}` : ''}`
                      : '—'}
                  </td>
                  <td className={b.netMinor > 0 ? 'pos' : b.netMinor < 0 ? 'neg' : ''}>
                    {b.netMinor > 0 ? '+' : ''}
                    {money(b.netMinor, trip.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            Net includes recorded repayments (− paid out, + received).
          </p>
        </details>
      </section>

      {detail.suggestions.length > 0 && (
        <section className="card">
          <h3>Suggested settlements</h3>
          <ul className="list-flat">
            {detail.suggestions.map((s, i) => (
              <li key={i} className="row-between">
                <span>
                  <strong>{nameOf(s.fromParticipantId)}</strong> pays <strong>{nameOf(s.toParticipantId)}</strong>
                </span>
                <span className="row gap">
                  <span>{money(s.amountMinor, trip.currency)}</span>
                  <button
                    className="link"
                    onClick={() => setPrefill(s)}
                    title="Fill the repayment form with this transfer"
                  >
                    Record
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            Suggestions are advice only — balances change when you record an actual repayment below.
          </p>
        </section>
      )}

      <section className="card">
        <h3>Repayments</h3>
        {detail.repayments.length === 0 ? (
          <p className="muted">No repayments recorded yet.</p>
        ) : (
          <ul className="list-flat">
            {detail.repayments.map((r) => (
              <li key={r.id} className={`row-between ${r.status === 'reversed' ? 'archived' : ''}`}>
                <span>
                  {nameOf(r.fromParticipantId)} → {nameOf(r.toParticipantId)}{' '}
                  <strong className={r.status === 'reversed' ? 'muted' : ''}>{money(r.amountMinor, trip.currency)}</strong>
                  <span className="muted small">
                    {' '}
                    · {r.date}
                    {r.note ? ` · ${r.note}` : ''}
                    {r.status === 'reversed' ? ' · reversed' : ''}
                  </span>
                </span>
                <button
                  className="link"
                  onClick={() =>
                    void (r.status === 'recorded' ? reverseRepayment(r.id) : restoreRepayment(r.id))
                  }
                >
                  {r.status === 'recorded' ? 'Reverse' : 'Restore'}
                </button>
              </li>
            ))}
          </ul>
        )}
        <AddRepaymentForm
          key={prefill ? `${prefill.fromParticipantId}${prefill.toParticipantId}${prefill.amountMinor}` : 'blank'}
          trip={detail}
          prefill={prefill}
          onAdded={() => {
            setPrefill(null)
            load()
          }}
        />
      </section>

      <Link className="link muted" to={`/trips/${trip.id}/people`}>
        Manage people &amp; weights →
      </Link>
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

function AddRepaymentForm({
  trip,
  prefill,
  onAdded,
}: {
  trip: TripDetail
  prefill: TransferSuggestion | null
  onAdded: () => void
}) {
  const [from, setFrom] = useState(prefill?.fromParticipantId ?? '')
  const [to, setTo] = useState(prefill?.toParticipantId ?? '')
  const [amount, setAmount] = useState(
    prefill ? formatMinor(prefill.amountMinor, trip.trip.currency) : '',
  )
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Archived people can still settle up, so offer everyone.
  const people = trip.participants

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post(`/trips/${trip.trip.id}/repayments`, {
        fromParticipantId: from,
        toParticipantId: to,
        amount: amount.trim(),
        date,
        note: note.trim() || null,
      })
      setAmount('')
      setNote('')
      onAdded()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to record repayment')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="repayment-form">
      <div className="row gap wrap">
        <label className="grow">
          Pays
          <select value={from} onChange={(e) => setFrom(e.target.value)} required>
            <option value="" disabled>
              Who paid?
            </option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.archived ? ' (archived)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          Receives
          <select value={to} onChange={(e) => setTo(e.target.value)} required>
            <option value="" disabled>
              Who received?
            </option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.archived ? ' (archived)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row gap wrap">
        <label className="grow">
          Amount ({trip.trip.currency})
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            maxLength={30}
          />
        </label>
        <label className="weight-label">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <div className="row gap wrap">
        <input
          className="grow"
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
        />
        <button type="submit" disabled={busy || !from || !to || !amount.trim()}>
          Record
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
