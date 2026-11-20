import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="footer">
      <span>athena · © 2026</span>
      <nav aria-label="Footer">
        <Link to="/privacy-policy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/sitemap">Sitemap</Link>
        <a href="https://github.com/arsh342/athena" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="https://www.npmjs.com/package/@arsh342/athena" target="_blank" rel="noopener noreferrer">npm</a>
      </nav>
    </footer>
  );
}
