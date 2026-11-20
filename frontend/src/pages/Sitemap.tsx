import { Link } from 'react-router-dom';

const publicLinks = [
  { to: '/', label: 'Home' },
  { to: '/#principles', label: 'How it works' },
  { to: '/#features', label: 'Features' },
  { to: '/#install', label: 'Install' },
  { to: '/quickstart', label: 'Quickstart' },
  { to: '/login', label: 'Log in' },
  { to: '/register', label: 'Create an account' },
];

const accountLinks = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/scan', label: 'Scan a repository' },
  { to: '/reports/latest', label: 'Latest report' },
  { to: '/settings', label: 'AI key and settings' },
];

const legalLinks = [
  { to: '/privacy-policy', label: 'Privacy Policy' },
  { to: '/terms', label: 'Terms of Service' },
  { to: '/sitemap', label: 'Sitemap' },
];

const elsewhere = [
  { href: 'https://github.com/arsh342/athena', label: 'Source code on GitHub' },
  { href: 'https://www.npmjs.com/package/@arsh342/athena', label: 'The command-line tool on npm' },
  { href: 'https://github.com/arsh342/athena/blob/main/docs/athena-bench/RESULTS.md', label: 'Detector benchmark results' },
  { href: 'https://github.com/arsh342/athena/issues', label: 'Report a problem or ask a question' },
];

export function SitemapPage() {
  return (
    <div className="page">
      <section className="page-head">
        <span className="kicker">Legal</span>
        <h1>Site<span className="fx-muted">map</span></h1>
        <p>Every page on athena, and where to find the rest.</p>
      </section>

      <section className="prose">
        <div>
          <h2>Public pages</h2>
          <ul>{publicLinks.map((item) => <li key={item.to}><Link to={item.to}>{item.label}</Link></li>)}</ul>
        </div>

        <div>
          <h2>Signed-in pages</h2>
          <ul>{accountLinks.map((item) => <li key={item.to}><Link to={item.to}>{item.label}</Link></li>)}</ul>
        </div>

        <div>
          <h2>Legal</h2>
          <ul>{legalLinks.map((item) => <li key={item.to}><Link to={item.to}>{item.label}</Link></li>)}</ul>
        </div>

        <div>
          <h2>Elsewhere</h2>
          <ul>{elsewhere.map((item) => <li key={item.href}><a href={item.href} target="_blank" rel="noopener noreferrer">{item.label}</a></li>)}</ul>
        </div>
      </section>
    </div>
  );
}
