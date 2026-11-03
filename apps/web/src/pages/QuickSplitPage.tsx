import { useMemo, useState } from 'react'
import { allocate, COMMON_CURRENCIES, currencyPrecision, parseAmountToMinor } from '@billsplit/core'
import { money } from '../format'

interface Person {
  name: string
  weight: string
}

const blank = (): Person[] => [
  { name: 'Ali', weight: '1' },
  { name: 'Sara', weight: '1' },
]

export function QuickSplitPage() {
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [people, setPeople] = useState<Person[]>(blank)
  const [copied, setCopied] = useState(false)

  const parsed = useMemo(() => {
    try {
      const total = parseAmountToMinor(amount, currency)
      const parts = people
        .filter((p) => p.name.trim())
        .map((p, i) => ({ participantId: String(i), weight: Number.parseInt(p.weight, 10) || 0 }))
      if (parts.length === 0 || parts.some((p) => p.weight <= 0)) return null
      const shares = allocate(total, parts)
      return { total, shares }
    } catch {
      return null
    }
  }, [amount, currency, people])

  const summary = parsed
    ? people
        .filter((p) => p.name.trim())
        .map((p, i) => `${p.name.trim()}: ${money(parsed.shares[i]!.amountMinor, currency)}`)
        .join('\n')
    : ''

  async function copy() {
    try {
      await navigator.clipboard.writeText(summary)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* user can select the text manually */
    }
  }

  function setPerson(i: number, patch: Partial<Person>) {
    setPeople((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  }

  return (
    <div>
      <h2>Quick split</h2>
      <p className="muted">One-off bill, nothing saved. Same exact engine as trips.</p>
      <div className="card form">
        <div className="form-row">
          <label>
            Amount
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="60.00" />
          </label>
          <label>
            Currency
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {COMMON_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>

        {people.map((p, i) => (
          <div key={i} className="row gap wrap">
            <input className="grow" placeholder={`Person ${i + 1}`} value={p.name} onChange={(e) => setPerson(i, { name: e.target.value })} />
            <label className="weight-label">
              Weight
              <input className="weight-input" type="number" min={1} step={1} value={p.weight} onChange={(e) => setPerson(i, { weight: e.target.value })} />
            </label>
            {people.length > 2 && (
              <button className="link danger" onClick={() => setPeople((prev) => prev.filter((_, j) => j !== i))}>
                Remove
              </button>
            )}
          </div>
        ))}
        <button onClick={() => setPeople((prev) => [...prev, { name: '', weight: '1' }])}>+ Add person</button>

        {amount && !parsed && (
          <p className="error">
            Enter a positive amount (max {currencyPrecision(currency)} decimals for {currency}) and a positive whole-number weight per person.
          </p>
        )}

        {parsed && (
          <div className="preview">
            <h4>Each pays</h4>
            <ul>
              {parsed.shares.map((s, i) => (
                <li key={s.participantId}>
                  {people[i]!.name.trim()}: {money(s.amountMinor, currency)}
                </li>
              ))}
            </ul>
            <pre className="summary">{summary}</pre>
            <button onClick={() => void copy()}>{copied ? 'Copied!' : 'Copy summary'}</button>
          </div>
        )}
      </div>
    </div>
  )
}
