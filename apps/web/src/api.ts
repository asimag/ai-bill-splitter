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
  allocations: Allocation[]
}

export interface Balance {
  participantId: string
  paidMinor: number
  shareMinor: number
  netMinor: number
}

export interface TripDetail {
  trip: Trip
  participants: Participant[]
  expenses: Expense[]
  totals: { totalSpentMinor: number; expenseCount: number }
  balances: Balance[]
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
}
