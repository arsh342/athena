import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { BrandIcon } from './BrandIcon';

const appLinks = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/scan', label: 'Scan' },
  { to: '/reports/latest', label: 'Report' },
  { to: '/settings', label: 'Account' },
];

const publicLinks = [
  { to: '/#principles', label: 'How it works' },
  { to: '/#features', label: 'Features' },
  { to: '/#install', label: 'Install' },
  { to: '/quickstart', label: 'Quickstart' },
];

/** Set to true to hide the bar while moving UP the page and show it moving down (the reverse of the usual). */
const HIDE_ON_SCROLL_UP = false;

/** Transparent bar over a soft gradient. It slips away as you move down the page and returns as you move back up. */
export function Navbar() {
  const navigate = useNavigate();
  const { isAuthenticated, signOut } = useAuth();
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);
  const bar = useRef<HTMLElement>(null);

  useEffect(() => {
    last.current = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - last.current;
        if (y < 24) setHidden(false);
        else if (Math.abs(delta) > 6) {
          const movingDown = delta > 0;
          setHidden(HIDE_ON_SCROLL_UP ? !movingDown : movingDown);
          last.current = y;
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, []);

  // A keyboard user tabbing into the bar must be able to see it.
  const reveal = () => setHidden(false);

  async function handleLogout(): Promise<void> {
    await signOut();
    navigate('/', { replace: true });
  }

  const links = isAuthenticated ? appLinks : publicLinks;

  return (
    <header className={`nav${hidden ? ' nav-hidden' : ''}`} ref={bar} onFocusCapture={reveal}>
      <div className="nav-fade" aria-hidden="true" />
      <div className="nav-inner">
        <NavLink className="nav-brand" to="/" aria-label="athena home">athena</NavLink>
        <nav className="nav-links" aria-label="Primary">
          {links.map((item) => (
            item.to.includes('#')
              ? <Link key={item.to} to={item.to}>{item.label}</Link>
              : <NavLink key={item.to} to={item.to}>{item.label}</NavLink>
          ))}
        </nav>
        <div className="nav-action">
          {isAuthenticated ? (
            <button className="btn btn-sm" type="button" onClick={handleLogout}>Log out</button>
          ) : (
            <NavLink className="btn btn-sm btn-solid" to="/login">Log in</NavLink>
          )}
        </div>
      </div>
    </header>
  );
}
