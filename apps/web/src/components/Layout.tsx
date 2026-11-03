import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth'

export function Layout() {
  const { organizer, logout } = useAuth()
  return (
    <div className="screen">
      <header className="topbar">
        <span className="app-title">Bill Splitter</span>
        <button className="link" onClick={() => void logout()}>
          Sign out{organizer ? ` (${organizer.email.split('@')[0]})` : ''}
        </button>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <nav className="bottom-nav">
        <NavLink to="/" end>
          Trips
        </NavLink>
        <NavLink to="/quick">Quick split</NavLink>
        <NavLink to="/settings/ai">Settings</NavLink>
      </nav>
    </div>
  )
}
