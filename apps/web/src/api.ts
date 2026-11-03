export interface Organizer {
  id: string
  email: string
}

export interface Trip {
  id: string
  name: string
  currency: string
  startDate: string | null
  endDate: string | null
  status: 'open' | 'closed'
  createdAt: string
  totalSpentMinor?: number
  expenseCount?: number
}

export interface Participant {
  id: string
  name: string
  defaultWeight: number
  archived: boolean
  position: number
}

export interface Allocation {
  participantId: string
  weight: number
  amountMinor: number
  position: number
}

export interface Expense {
  id: string
  description: string
  date: string
  category: string | null
  amountMinor: number
  payerParticipantId: string
  paymentMethod: string | null
  receiptId: string | null
  allocations: Allocation[]
}

/** Runtime-validated structured extraction; missing fields are null, never guessed. */
export interface Extraction {
  merchant: string | null
  category: string | null
  date: string | null
  currency: string | null
  subtotal: string | null
  tax: string | null
  serviceCharge: string | null
  tip: string | null
  cashTendered: string | null
  total: string | null
  warnings: string[]
}

export type ReceiptStatus = 'pending' | 'processing' | 'extracted' | 'failed' | 'confirmed'

export interface Receipt {
  id: string
  tripId: string
  status: ReceiptStatus
  contentType: string
  sizeBytes: number
  originalName: string | null
  providerUsed: string | null
  fallbackReason: string | null
  errorKind: string | null
  processingError: string | null
  extraction: Extraction | null
  createdAt: string
}

export interface ReceiptSummary {
  id: string
  status: ReceiptStatus
  providerUsed: string | null
  errorKind: string | null
  suggestedTotal: string | null
  suggestedCurrency: string | null
  merchant: string | null
  expenseId: string | null
}

export interface AiSettings {
  mode: 'auto' | 'local' | 'gemini' | 'tesseract'
  modeOverride: string | null
  envDefaultMode: string
  local: { configured: boolean; baseUrl: string | null; model: string | null }
  gemini: { configured: boolean; model: string; keySource: 'saved' | 'environment' | 'none' }
  timeoutMs: number
}

export interface ConnectionTestResult {
  ok: boolean
  error?: string
  kind?: string
}

export interface Balance {
  participantId: string
  paidMinor: number
  shareMinor: number
  repaidSentMinor: number
  repaidReceivedMinor: number
  netMinor: number
}

export interface Repayment {
  id: string
  fromParticipantId: string
  toParticipantId: string
  amountMinor: number
  date: string
  note: string | null
  status: 'recorded' | 'reversed'
  reversedAt: string | null
  createdAt: string
}

export interface TransferSuggestion {
  fromParticipantId: string
  toParticipantId: string
  amountMinor: number
}

export interface TripDetail {
  trip: Trip
  participants: Participant[]
  expenses: Expense[]
  repayments: Repayment[]
  receipts: ReceiptSummary[]
  totals: { totalSpentMinor: number; expenseCount: number }
  balances: Balance[]
  suggestions: TransferSuggestion[]
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({ error: 'network error' }))
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'request failed')
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),

  /** Multipart upload (browser sets the content-type boundary itself). */
  upload: async <T>(path: string, form: FormData): Promise<T> => {
    const res = await fetch(`/api${path}`, { method: 'POST', credentials: 'include', body: form })
    const data = await res.json().catch(() => ({ error: 'network error' }))
    if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? 'upload failed')
    return data as T
  },

  /** Authenticated-by-cookie image URL for <img> previews. */
  receiptImageUrl: (receiptId: string) => `/api/receipts/${receiptId}/image`,
}
