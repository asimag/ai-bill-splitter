import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import { Layout } from './components/Layout'
import { AuthPage } from './pages/AuthPage'
import { TripsPage } from './pages/TripsPage'
import { TripPage } from './pages/TripPage'
import { TripPeoplePage } from './pages/TripPeoplePage'
import { AISettingsPage } from './pages/AISettingsPage'
import { ExpenseFormPage } from './pages/ExpenseFormPage'
import { QuickSplitPage } from './pages/QuickSplitPage'

export function App() {
  const { organizer, loading } = useAuth()
  const location = useLocation()

  if (loading) return <div className="screen">Loading…</div>
  if (!organizer) {
    if (location.pathname === '/login') return <AuthPage mode="login" />
    if (location.pathname === '/register') return <AuthPage mode="register" />
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<TripsPage />} />
        <Route path="/trips/:tripId" element={<TripPage />} />
        <Route path="/trips/:tripId/people" element={<TripPeoplePage />} />
        <Route path="/trips/:tripId/expenses/new" element={<ExpenseFormPage />} />
        <Route path="/trips/:tripId/expenses/:expenseId/edit" element={<ExpenseFormPage mode="edit" />} />
        <Route path="/quick" element={<QuickSplitPage />} />
        <Route path="/settings/ai" element={<AISettingsPage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/register" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
