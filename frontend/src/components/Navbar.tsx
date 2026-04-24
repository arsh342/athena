import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const navItems = [
  { to: '/', label: 'Home' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/scan', label: 'Scan' },
  { to: '/reports/latest', label: 'Report' },
];

/**
 * Sticky navigation bar using brutalist light variant on all routes.
 */
export function Navbar() {
  const navigate = useNavigate();
  const { isAuthenticated, signOut } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 20);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const classes = [
    'navbar',
    scrolled ? 'navbar--scrolled' : '',
    'navbar--light',
  ]
    .filter(Boolean)
    .join(' ');

  async function handleLogout(): Promise<void> {
    await signOut();
    navigate('/', { replace: true });
  }

  return (
    <header className={classes}>
      <NavLink className="brand" to="/" aria-label="athena home">
        <span>athena</span>
      </NavLink>
      <nav className="nav-links" aria-label="Primary navigation">
        {isAuthenticated
          ? navItems.map((item) => (
            <NavLink key={item.to} to={item.to}>
              {item.label}
            </NavLink>
          ))
          : null}
      </nav>
      {isAuthenticated ? (
        <button className="nav-cta" type="button" onClick={handleLogout}>
          LOGOUT
        </button>
      ) : (
        <NavLink className="nav-cta" to="/login" id="nav-cta-login">
          LOGIN
        </NavLink>
      )}
    </header>
  );
}
