import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api, ApiError, type Organizer } from '../api'
import { useAuth } from '../auth'

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { setOrganizer } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ organizer: Organizer }>(`/auth/${mode}`, { email, password })
      setOrganizer(r.organizer)
      const from = (location.state as { from?: string } | null)?.from
      navigate(from && from !== '/login' && from !== '/register' ? from : '/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen auth-screen">
      <h1 className="app-title big">{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
      <p className="muted">Split restaurant bills and trip expenses by weights.</p>
      <form onSubmit={submit} className="card form">
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy} className="primary">
          {busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <p className="muted">
        {mode === 'login' ? (
          <>
            No account? <Link to="/register">Create one</Link>
          </>
        ) : (
          <>
            Have an account? <Link to="/login">Sign in</Link>
          </>
        )}
      </p>
    </div>
  )
}
