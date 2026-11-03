import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type Receipt } from '../api'

/**
 * Receipt capture + review panel. Manual entry always stays available;
 * extraction only pre-fills editable fields — nothing enters totals until the
 * expense form itself is submitted.
 */

export interface ApplyFields {
  description?: string
  date?: string
  total?: string
  category?: string
}

interface Props {
  tripId: string
  currency: string
  receipt: Receipt | null
  onReceiptChange: (r: Receipt | null) => void
  onApply: (fields: ApplyFields) => void
}

const IMAGE_READ_ERROR = 'Could not read that image. Try a JPEG/PNG/WebP photo (max 10 MB).'

export function ReceiptCapture({ tripId, currency, receipt, onReceiptChange, onApply }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [rotation, setRotation] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const stopPolling = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current)
    pollTimer.current = null
  }
  useEffect(() => stopPolling, [])

  const poll = useCallback(
    (id: string, attempt = 0) => {
      stopPolling()
      if (attempt > 60) return // ~90s ceiling; states stay manual-friendly
      pollTimer.current = setTimeout(async () => {
        try {
          const { receipt: r } = await api.get<{ receipt: Receipt }>(`/receipts/${id}`)
          onReceiptChange(r)
          if (r.status === 'pending' || r.status === 'processing') poll(id, attempt + 1)
        } catch {
          // keep showing the last known state; manual entry remains available
        }
      }, 1500)
    },
    [onReceiptChange],
  )

  // Resume polling when a still-processing receipt is passed in (e.g. after reload).
  useEffect(() => {
    if (receipt && (receipt.status === 'pending' || receipt.status === 'processing')) poll(receipt.id)
    return stopPolling
    // Only when the receipt identity changes, not on every poll update tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt?.id, poll])

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
      setError(IMAGE_READ_ERROR)
      return
    }
    setError(null)
    setApplied(false)
    setRotation(0)
    setFile(f)
    onReceiptChange(null)
    stopPolling()
  }

  /** Rotate a chosen photo before upload (canvas re-encode). */
  async function rotate90() {
    if (!file || !previewUrl) return
    setBusy(true)
    try {
      const img = new Image()
      img.src = previewUrl
      await new Promise((res, rej) => {
        img.onload = res
        img.onerror = rej
      })
      const canvas = document.createElement('canvas')
      canvas.width = img.height
      canvas.height = img.width
      const ctx = canvas.getContext('2d')!
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate(Math.PI / 2)
      ctx.drawImage(img, -img.width / 2, -img.height / 2)
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.92))
      if (!blob) throw new Error('re-encode failed')
      const next = rotation + 90
      setRotation(next % 360)
      setFile(new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }))
    } catch {
      setError('Could not rotate this image; upload it as-is or retake it.')
    } finally {
      setBusy(false)
    }
  }

  async function upload() {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('image', file, file.name || 'receipt.jpg')
      const { receipt: r } = await api.upload<{ receipt: Receipt }>(`/trips/${tripId}/receipts`, form)
      onReceiptChange(r)
      if (r.status === 'pending' || r.status === 'processing') poll(r.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'upload failed — check your connection and retry')
    } finally {
      setBusy(false)
    }
  }

  function retake() {
    stopPolling()
    setFile(null)
    setRotation(0)
    setApplied(false)
    onReceiptChange(null)
    setError(null)
  }

  const extraction = receipt?.extraction ?? null
  const currencyMismatch = !!extraction?.currency && extraction.currency !== currency
  const showReview = receipt && receipt.status !== 'pending' && receipt.status !== 'processing'

  return (
    <div className="card receipt-card">
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={pick} />

      {!file && !receipt && (
        <>
          <div className="row gap wrap">
            <button type="button" className="grow" onClick={() => cameraRef.current?.click()}>
              📷 Scan receipt
            </button>
            <button type="button" onClick={() => galleryRef.current?.click()}>
              Choose photo
            </button>
          </div>
          <p className="muted small">Manual entry below always works — scanning just pre-fills fields you can still edit.</p>
        </>
      )}

      {file && previewUrl && (
        <div className="receipt-preview">
          <img src={previewUrl} alt="Selected receipt" style={{ transform: `rotate(${rotation}deg)` }} />
          <div className="row gap wrap">
            <button type="button" className="primary grow" disabled={busy} onClick={() => void upload()}>
              {busy ? 'Working…' : receipt ? 'Upload again' : 'Upload & scan'}
            </button>
            <button type="button" disabled={busy} onClick={() => void rotate90()}>
              ⟳ Rotate
            </button>
            <button type="button" className="link" onClick={retake}>
              Retake
            </button>
          </div>
        </div>
      )}

      {receipt && (receipt.status === 'pending' || receipt.status === 'processing') && (
        <p className="muted">⏳ Reading the receipt… you can keep filling the form meanwhile.</p>
      )}

      {receipt?.status === 'failed' && (
        <div className="error-block">
          <p className="error">
            Couldn’t read this receipt{receipt.errorKind ? ` (${receipt.errorKind})` : ''}:{' '}
            {receipt.processingError ?? 'no provider could process it'}.
          </p>
          {receipt.fallbackReason && <p className="muted small">Providers: {receipt.fallbackReason}</p>}
          {receipt.errorKind === 'credentials' && (
            <p>
              <Link to="/settings/ai">Configure a provider/API key →</Link>
            </p>
          )}
          <div className="row gap">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const { receipt: r } = await api.post<{ receipt: Receipt }>(`/receipts/${receipt.id}/retry`, {})
                  onReceiptChange(r)
                  poll(r.id)
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : 'retry failed')
                } finally {
                  setBusy(false)
                }
              }}
            >
              Retry scan
            </button>
            <span className="muted small">The photo is kept; fill the form manually meanwhile.</span>
          </div>
        </div>
      )}

      {showReview && extraction && (
        <div className="extraction-review">
          <div className="row-between">
            <h4 style={{ margin: 0 }}>Suggested from receipt</h4>
            <span className="tag">
              via {receipt!.providerUsed}
              {receipt!.fallbackReason ? ' · fell back' : ''}
            </span>
          </div>
          {receipt!.fallbackReason && <p className="muted small">{receipt!.fallbackReason}</p>}
          <dl className="extraction-grid">
            <div>
              <dt>Merchant</dt>
              <dd>{extraction.merchant ?? '—'}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{extraction.category ?? '—'}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{extraction.date ?? '—'}</dd>
            </div>
            <div>
              <dt>Subtotal</dt>
              <dd>{extraction.subtotal ?? '—'}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>{extraction.tax ?? '—'}</dd>
            </div>
            <div>
              <dt>Service</dt>
              <dd>{extraction.serviceCharge ?? '—'}</dd>
            </div>
            <div>
              <dt>Tip</dt>
              <dd>{extraction.tip ?? '—'}</dd>
            </div>
            <div>
              <dt>Cash tendered</dt>
              <dd>{extraction.cashTendered ?? '—'}</dd>
            </div>
            <div>
              <dt>Total payable</dt>
              <dd>
                <strong>
                  {extraction.total ?? 'unreadable'} {extraction.currency ?? ''}
                </strong>
              </dd>
            </div>
          </dl>
          {currencyMismatch && (
            <p className="error">
              Receipt currency {extraction.currency} ≠ trip currency {currency}. Check the amount carefully before applying.
            </p>
          )}
          {extraction.warnings.map((w, i) => (
            <p key={i} className="muted small">
              ⚠ {w}
            </p>
          ))}
          <div className="row gap wrap">
            <img className="receipt-thumb" src={api.receiptImageUrl(receipt!.id)} alt="Receipt thumbnail" />
            <button
              type="button"
              className="primary grow"
              disabled={!extraction.total || applied}
              onClick={() => {
                onApply({
                  description: extraction.merchant ?? undefined,
                  date: extraction.date ?? undefined,
                  total: extraction.total ?? undefined,
                  category: extraction.category ?? undefined,
                })
                setApplied(true)
              }}
            >
              {applied ? 'Applied ✓ — review below' : 'Apply to expense'}
            </button>
          </div>
          {!extraction.total && <p className="muted small">No readable total — please enter the amount manually.</p>}
          <p className="muted small">Applied values stay editable. AI suggestions are never added to totals on their own.</p>
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  )
}
