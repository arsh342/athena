import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/scan', label: 'Scan' },
  { to: '/reports/latest', label: 'Report' },
  { to: '/settings', label: 'AI key' },
];

export function Navbar() {
  const navigate = useNavigate();
  const { isAuthenticated, signOut } = useAuth();

  async function handleLogout(): Promise<void> {
    await signOut();
    navigate('/', { replace: true });
  }

  return (
    <header className="nav">
      <NavLink className="nav-brand" to="/" aria-label="athena home">athena</NavLink>
      {isAuthenticated ? (
        <nav className="nav-links" aria-label="Primary">
          {navItems.map((item) => <NavLink key={item.to} to={item.to}>{item.label}</NavLink>)}
        </nav>
      ) : null}
      {isAuthenticated ? (
        <button className="btn btn-sm" type="button" onClick={handleLogout}>Log out</button>
      ) : (
        <NavLink className="btn btn-sm btn-solid" to="/login">Log in</NavLink>
      )}
    </header>
  );
}
