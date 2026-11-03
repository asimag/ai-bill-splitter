import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, type Organizer } from './api'

interface AuthState {
  organizer: Organizer | null
  loading: boolean
  setOrganizer: (o: Organizer | null) => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [organizer, setOrganizer] = useState<Organizer | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get<{ organizer: Organizer }>('/auth/me')
      .then((r) => setOrganizer(r.organizer))
      .catch(() => setOrganizer(null))
      .finally(() => setLoading(false))
  }, [])

  const logout = useCallback(async () => {
    await api.post('/auth/logout', {}).catch(() => {})
    setOrganizer(null)
  }, [])

  return (
    <AuthContext.Provider value={{ organizer, loading, setOrganizer, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside provider')
  return ctx
}
