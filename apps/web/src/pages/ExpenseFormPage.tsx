import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, ApiError, type Receipt, type TripDetail } from '../api'
import { allocate, formatMinor, parseAmountToMinor } from '@billsplit/core'
import { money, todayISO } from '../format'
import { ReceiptCapture, type ApplyFields } from './ReceiptCapture'

const CATEGORIES = ['Food', 'Drinks', 'Groceries', 'Transport', 'Stay', 'Activities', 'Other']
const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: '', label: 'Not recorded' },
  { value: 'cash', label: '💵 Cash' },
  { value: 'card', label: '💳 Card' },
  { value: 'transfer', label: '📲 Bank transfer' },
  { value: 'other', label: 'Other' },
]

interface Row {
  participantId: string
  included: boolean
  weight: string
}

export function ExpenseFormPage({ mode = 'new' }: { mode?: 'new' | 'edit' }) {
  const { tripId, expenseId } = useParams<{ tripId: string; expenseId?: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<TripDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [description, setDescription] = useState('')
  const [date, setDate] = useState(todayISO())
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [payerId, setPayerId] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [searchParams] = useSearchParams()
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [extraTip, setExtraTip] = useState('')
  // Fields the organizer typed by hand — scan auto-fill never overwrites them.
  const touched = useRef({ description: false, date: false, category: false, amount: false })
  const autoAppliedFor = useRef<string | null>(null)
  const [autoFillNote, setAutoFillNote] = useState<string | null>(null)

  function applyFields(fields: ApplyFields, force: boolean) {
    const t = touched.current
    if (fields.description && !t.description) setDescription(fields.description)
    if (fields.date && (force || !t.date)) setDate(fields.date)
    if (fields.total && (force || !t.amount)) setAmount(fields.total)
    if (fields.category && (force || !category)) setCategory(fields.category)
  }

  // Auto-fill total + category (and merchant/date) as soon as a scan lands,
  // so hitting "Scan" leads straight to a mostly-filled form. Manual edits win.
  useEffect(() => {
    if (mode !== 'new') return
    const ex = receipt?.status === 'extracted' ? receipt.extraction : null
    if (!receipt || !ex || autoAppliedFor.current === receipt.id) return
    autoAppliedFor.current = receipt.id
    applyFields(
      {
        description: ex.merchant ?? undefined,
        date: ex.date ?? undefined,
        total: ex.total ?? undefined,
        category: ex.category ?? undefined,
      },
      false,
    )
    const filled = [ex.total ? 'amount' : null, ex.category ? 'category' : null].filter(Boolean)
    setAutoFillNote(filled.length ? `Auto-filled ${filled.join(' and ')} from the scan — edit anything you like.` : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt, mode])

  // Pick up a receipt carried over from a previous visit (?receiptId=...):
  // the scan may already be done, or still processing, when we arrive.
  useEffect(() => {
    const id = searchParams.get('receiptId')
    if (mode !== 'new' || !id) return
    api
      .get<{ receipt: Receipt }>(`/receipts/${id}`)
      .then(({ receipt: r }) => setReceipt(r))
      .catch(() => setError('that receipt could not be loaded'))
  }, [mode, searchParams])

  useEffect(() => {
    if (!tripId) return
    api
      .get<TripDetail>(`/trips/${tripId}`)
      .then((d) => {
        setDetail(d)
        const active = d.participants.filter((p) => !p.archived)
        const existing = mode === 'edit' ? d.expenses.find((e) => e.id === expenseId) : undefined
        if (existing) {
          setDescription(existing.description)
          setDate(existing.date)
          setCategory(existing.category ?? '')
          setAmount(formatAmountInput(existing.amountMinor, d.trip.currency))
          setPaymentMethod(existing.paymentMethod ?? '')
          setPayerId(existing.payerParticipantId)
          const snapshot = new Map(existing.allocations.map((a) => [a.participantId, a.weight]))
          setRows(
            active.map((p) => ({
              participantId: p.id,
              included: snapshot.has(p.id),
              weight: String(snapshot.get(p.id) ?? p.defaultWeight),
            })),
          )
        } else {
          setPayerId(active[0]?.id ?? '')
          setRows(active.map((p) => ({ participantId: p.id, included: true, weight: String(p.defaultWeight) })))
        }
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'failed to load trip'))
  }, [tripId, expenseId, mode])

  const byId = useMemo(() => new Map((detail?.participants ?? []).map((p) => [p.id, p])), [detail])
  const currency = detail?.trip.currency ?? 'USD'

  const included = rows.filter((r) => r.included)

  /** Extra tip counts only when a receipt is attached and the tip is not zero. */
  const tipMinor = useMemo(() => {
    const s = extraTip.trim()
    if (mode !== 'new' || !receipt || !s || /^0+(?:\.0+)?$/.test(s)) return 0
    try {
      return parseAmountToMinor(s, currency)
    } catch {
      return null // invalid tip input: previews stay hidden until it parses
    }
  }, [extraTip, mode, receipt, currency])

  const preview = useMemo(() => {
    if (!amount || tipMinor === null) return null
    try {
      const total = parseAmountToMinor(amount, currency) + tipMinor
      const parts = included.map((r) => ({
        participantId: r.participantId,
        weight: Number.parseInt(r.weight, 10) || 0,
      }))
      if (parts.some((p) => p.weight <= 0)) return null
      return allocate(total, parts)
    } catch {
      return null
    }
  }, [amount, currency, included, tipMinor])

  const chargedMinor = useMemo(() => {
    if (!amount || tipMinor === null) return null
    try {
      return parseAmountToMinor(amount, currency) + tipMinor
    } catch {
      return null
    }
  }, [amount, currency, tipMinor])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!tripId) return
    setBusy(true)
    setError(null)
    const body: Record<string, unknown> = {
      description: description.trim(),
      date,
      category: category.trim() || null,
      amount: amount.trim(),
      payerParticipantId: payerId,
      paymentMethod: paymentMethod || null,
      participants: included.map((r) => ({
        participantId: r.participantId,
        weight: Number.parseInt(r.weight, 10),
      })),
    }
    // Submitting the form IS the confirmation step: attach the scanned receipt
    // and any extra tip that is not already included in the amount.
    if (mode === 'new' && receipt) {
      body.receiptId = receipt.id
      const tip = extraTip.trim()
      if (tip && !/^0+(?:\.0+)?$/.test(tip)) body.extraTip = tip
    }
    try {
      if (mode === 'edit' && expenseId) await api.put(`/expenses/${expenseId}`, body)
      else await api.post(`/trips/${tripId}/expenses`, body)
      navigate(`/trips/${tripId}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to save expense')
      setBusy(false)
    }
  }

  if (loadError) return <p className="error">{loadError}</p>
  if (!detail) return <p className="muted">Loading…</p>

  const noPeople = rows.length === 0

  return (
    <div>
      <h2>{mode === 'edit' ? 'Edit expense' : 'New expense'}</h2>
      <p className="muted">{detail.trip.name} · amounts in {currency}</p>

      {mode === 'new' && detail.trip.status === 'open' && (
        <ReceiptCapture
          tripId={detail.trip.id}
          currency={currency}
          receipt={receipt}
          onReceiptChange={setReceipt}
          onApply={(fields) => applyFields(fields, true)}
        />
      )}

      {noPeople && <p className="error">Add at least one person to the trip first. <Link className="link" to={`/trips/${detail.trip.id}/people`}>Add people →</Link></p>}
      {autoFillNote && <p className="muted small">✓ {autoFillNote}</p>}
      <form onSubmit={submit} className="card form">
        <label>
          Description
          <input
            value={description}
            onChange={(e) => {
              touched.current.description = true
              setDescription(e.target.value)
            }}
            required
            maxLength={200}
            placeholder="Dinner at Tandoor"
          />
        </label>
        <div className="form-row">
          <label>
            Amount ({currency})
            <input
              value={amount}
              onChange={(e) => {
                touched.current.amount = true
                setAmount(e.target.value)
              }}
              required
              inputMode="decimal"
              placeholder="60.00"
            />
          </label>
          <label>
            Date
            <input
              type="date"
              value={date}
              onChange={(e) => {
                touched.current.date = true
                setDate(e.target.value)
              }}
              required
            />
          </label>
        </div>

        {mode === 'new' && receipt?.extraction && (
          <label>
            Extra tip ({currency}) — only if NOT already included above
            <input
              value={extraTip}
              onChange={(e) => setExtraTip(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              maxLength={30}
            />
            {tipMinor ? (
              <span className="muted small">
                {chargedMinor !== null ? `Charged total: ${money(chargedMinor, currency)}` : 'Check the tip amount'}
              </span>
            ) : null}
          </label>
        )}
        <label>
          Category{mode === 'new' && receipt?.extraction?.category ? ' (suggested from scan — change if needed)' : ''}
          <input
            value={category}
            onChange={(e) => {
              touched.current.category = true
              setCategory(e.target.value)
            }}
            maxLength={40}
            list="category-suggestions"
            placeholder="Food"
          />
          <datalist id="category-suggestions">
            {CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label>
          Paid by
          <select value={payerId} onChange={(e) => setPayerId(e.target.value)} required>
            <option value="" disabled>
              Select payer
            </option>
            {rows.map((r) => (
              <option key={r.participantId} value={r.participantId}>
                {byId.get(r.participantId)?.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Paid with (optional)
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend>Split between</legend>
          {rows.map((r) => (
            <div key={r.participantId} className="row-between split-row">
              <label className="row gap">
                <input
                  type="checkbox"
                  checked={r.included}
                  onChange={(e) =>
                    setRows((prev) => prev.map((x) => (x.participantId === r.participantId ? { ...x, included: e.target.checked } : x)))
                  }
                />
                {byId.get(r.participantId)?.name}
              </label>
              <label className="weight-label">
                Weight
                <input
                  className="weight-input"
                  type="number"
                  min={1}
                  step={1}
                  disabled={!r.included}
                  value={r.weight}
                  onChange={(e) =>
                    setRows((prev) => prev.map((x) => (x.participantId === r.participantId ? { ...x, weight: e.target.value } : x)))
                  }
                />
              </label>
            </div>
          ))}
          {included.length === 0 && <p className="error">Include at least one participant.</p>}
        </fieldset>

        {preview && (
          <div className="preview">
            <h4>Each pays</h4>
            <ul>
              {preview.map((a) => (
                <li key={a.participantId}>
                  {byId.get(a.participantId)?.name}: {money(a.amountMinor, currency)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="error">{error}</p>}
        <div className="row gap">
          <button type="submit" className="primary grow" disabled={busy || noPeople || included.length === 0}>
            {busy ? '…' : mode === 'edit' ? 'Save changes' : 'Add expense'}
          </button>
          <button type="button" className="link" onClick={() => navigate(`/trips/${tripId}`)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

function formatAmountInput(minor: number, currency: string): string {
  // strip trailing zeros for a friendlier edit field ("60" not "60.00")
  const s = formatMinor(minor, currency)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}
