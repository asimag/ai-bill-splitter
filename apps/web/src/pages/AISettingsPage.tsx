import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type AiSettings, type ConnectionTestResult } from '../api'

const MODES = [
  { value: '', label: 'Server default' },
  { value: 'auto', label: 'Auto — local first, then Gemini' },
  { value: 'local', label: 'Local only — never send receipts to the cloud' },
  { value: 'gemini', label: 'Gemini only' },
  { value: 'tesseract', label: 'Tesseract (optional, low-confidence)' },
] as const

/**
 * Provider settings and secure key entry. Keys are POSTed over HTTPS, stored
 * encrypted, and never come back from the API — this page only ever shows a
 * masked "configured" status.
 */
export function AISettingsPage() {
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [mode, setMode] = useState('')
  const [geminiModel, setGeminiModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [tests, setTests] = useState<Record<string, ConnectionTestResult | 'running'>>({})

  const load = useCallback(() => {
    api
      .get<{ settings: AiSettings }>('/ai/settings')
      .then(({ settings: s }) => {
        setSettings(s)
        setMode(s.modeOverride ?? '')
        setGeminiModel(s.gemini.model)
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'failed to load settings'))
  }, [])

  useEffect(load, [load])

  async function save(patch: Record<string, unknown>, done?: string) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const { settings: s } = await api.put<{ settings: AiSettings }>('/ai/settings', patch)
      setSettings(s)
      setMode(s.modeOverride ?? '')
      if (done) setNotice(done)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'failed to save settings')
    } finally {
      setBusy(false)
      setApiKey('') // never leave a pasted key in the field
    }
  }

  async function test(provider: 'local' | 'gemini') {
    setTests((t) => ({ ...t, [provider]: 'running' }))
    try {
      const result = await api.post<ConnectionTestResult>('/ai/settings/test', { provider })
      setTests((t) => ({ ...t, [provider]: result }))
    } catch (e) {
      setTests((t) => ({
        ...t,
        [provider]: { ok: false, error: e instanceof ApiError ? e.message : 'test failed', kind: 'internal' },
      }))
    }
  }

  if (loadError) return <p className="error">{loadError}</p>
  if (!settings) return <p className="muted">Loading…</p>

  const keyStatusLabel =
    settings.gemini.keySource === 'saved'
      ? 'saved key configured (this organizer)'
      : settings.gemini.keySource === 'environment'
        ? 'server environment key configured'
        : 'no key configured'

  return (
    <div>
      <h2>Receipt AI settings</h2>

      <section className="card form">
        <h3>Provider mode</h3>
        <label>
          Extraction mode
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
                {m.value === settings.envDefaultMode ? ' (server default)' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="row gap">
          <button
            type="button"
            className="primary grow"
            disabled={busy || mode === (settings.modeOverride ?? '')}
            onClick={() => void save({ mode: mode || null }, 'Mode saved.')}
          >
            Save mode
          </button>
        </div>
        <p className="muted small">
          Effective mode: <strong>{settings.mode}</strong>. Auto tries the configured local model first and falls back
          to Gemini Flash; local-only never sends receipts to the cloud.
        </p>
      </section>

      <section className="card form">
        <h3>Local vision AI (server operator)</h3>
        <p className="muted small">
          {settings.local.configured ? (
            <>
              Configured: <strong>{settings.local.model}</strong> at {settings.local.baseUrl}
            </>
          ) : (
            <>Not configured on this server.</>
          )}{' '}
          Endpoint and credentials are infrastructure settings; they are changed in the server environment
          (<code>LOCAL_AI_BASE_URL</code>, <code>LOCAL_AI_MODEL</code>), not here. Remember: inside Docker,
          “localhost” is the container — use an address the container can reach.
        </p>
        <div className="row gap">
          <button type="button" disabled={busy || tests.local === 'running'} onClick={() => void test('local')}>
            {tests.local === 'running' ? 'Testing…' : 'Test local connection'}
          </button>
          {tests.local && tests.local !== 'running' && (
            <span className={tests.local.ok ? 'pos' : 'error'}>{tests.local.ok ? '✓ reachable' : `✗ ${tests.local.error}`}</span>
          )}
        </div>
      </section>

      <section className="card form">
        <h3>Gemini Flash fallback</h3>
        <p className="muted small">
          Status: <strong>{keyStatusLabel}</strong>. Saved keys are encrypted at rest and only used for your receipts;
          removing yours restores the server default.
        </p>
        <label>
          Gemini model ID
          <input value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} maxLength={80} placeholder={settings.gemini.model} />
        </label>
        <label>
          {settings.gemini.keySource === 'saved' ? 'Replace API key' : 'Gemini API key'}
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="paste key — stored encrypted, never shown again"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="row gap wrap">
          <button
            type="button"
            className="primary"
            disabled={busy || !apiKey}
            onClick={() => void save({ geminiApiKey: apiKey }, 'API key saved encrypted.')}
          >
            Save key
          </button>
          {settings.gemini.keySource === 'saved' && (
            <button type="button" disabled={busy} onClick={() => void save({ geminiApiKey: null }, 'Saved key removed.')}>
              Remove my key
            </button>
          )}
          <button
            type="button"
            disabled={busy || !geminiModel.trim() || geminiModel.trim() === settings.gemini.model}
            onClick={() => void save({ geminiModel: geminiModel.trim() }, 'Gemini model saved.')}
          >
            Save model
          </button>
          <button type="button" disabled={busy || tests.gemini === 'running'} onClick={() => void test('gemini')}>
            {tests.gemini === 'running' ? 'Testing…' : 'Test connection'}
          </button>
        </div>
        {tests.gemini && tests.gemini !== 'running' && (
          <p className={tests.gemini.ok ? 'pos' : 'error'}>
            {tests.gemini.ok ? '✓ key valid' : `✗ ${tests.gemini.error}`}
          </p>
        )}
        {tests.gemini && tests.gemini !== 'running' && tests.gemini.kind === 'credentials' && (
          <p className="muted small">
            A missing or revoked key is a configuration problem — paste a new key above, then retry failed receipts from
            the trip page.
          </p>
        )}
        {tests.gemini && tests.gemini !== 'running' && tests.gemini.kind === 'rate_limit' && (
          <p className="muted small">
            The key works but the quota is exhausted; try again later instead of re-pasting keys.
          </p>
        )}
      </section>

      {notice && <p className="pos">{notice}</p>}
      {error && <p className="error">{error}</p>}
      <p className="muted small">Request timeout: {Math.round(settings.timeoutMs / 1000)}s per bounded attempt (server setting).</p>
    </div>
  )
}
