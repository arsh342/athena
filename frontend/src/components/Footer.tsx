import { Link } from 'react-router-dom';
import { BrandIcon } from './BrandIcon';

interface FooterLink { label: string; to?: string; href?: string }
interface FooterColumn { title: string; links: FooterLink[] }

const COLUMNS: FooterColumn[] = [
  { title: 'Product', links: [{ label: 'Scan a repository', to: '/scan' }, { label: 'Quickstart', to: '/quickstart' }, { label: 'Dashboard', to: '/dashboard' }] },
  { title: 'Open source', links: [{ label: 'GitHub', href: 'https://github.com/arsh342/athena' }, { label: 'npm', href: 'https://www.npmjs.com/package/@arsh342/athena' }] },
  { title: 'Legal', links: [{ label: 'Privacy', to: '/privacy-policy' }, { label: 'Terms', to: '/terms' }, { label: 'Sitemap', to: '/sitemap' }] },
];

function FooterAnchor({ link }: { link: FooterLink }) {
  return link.to
    ? <Link to={link.to}>{link.label}</Link>
    : <a href={link.href} target="_blank" rel="noopener noreferrer">{link.label}</a>;
}

/** The icon, a description and link columns (folding on phones), and a © line. */
export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer-top">
        <div className="site-footer-about">
          <BrandIcon size={64} className="site-footer-icon" />
          <p>Security review for AI-assisted code. It reads your code the way a careful reviewer does, and runs on your machine.</p>
          <p className="site-footer-status"><span className="dot" aria-hidden="true" />Offline by default</p>
        </div>

        <nav className="site-footer-cols" aria-label="Footer">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="site-footer-title">{col.title}</p>
              <ul>{col.links.map((l) => <li key={l.label}><FooterAnchor link={l} /></li>)}</ul>
            </div>
          ))}
        </nav>

        <nav className="site-footer-fold" aria-label="Footer">
          {COLUMNS.map((col) => (
            <details key={col.title}>
              <summary>
                <span>{col.title}</span>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              </summary>
              <ul>{col.links.map((l) => <li key={l.label}><FooterAnchor link={l} /></li>)}</ul>
            </details>
          ))}
        </nav>
      </div>

      <div className="site-footer-bottom">
        <p>© 2026 athena</p>
        <a href="https://github.com/arsh342/athena/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT licence</a>
      </div>

    </footer>
  );
}
