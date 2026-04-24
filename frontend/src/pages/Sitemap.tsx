import { Link } from 'react-router-dom';

const publicLinks = [
  { to: '/', label: 'Landing' },
  { to: '/login', label: 'Login' },
  { to: '/register', label: 'Register' },
  { to: '/privacy-policy', label: 'Privacy Policy' },
  { to: '/terms', label: 'Terms of Service' },
  { to: '/sitemap', label: 'Sitemap' },
];

const protectedLinks = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/scan', label: 'Scan' },
  { to: '/reports/latest', label: 'Latest Report' },
];

export function SitemapPage() {
  return (
    <div className="page brutalist-page">
      <section className="page-header">
        <div className="br-section-annotation">
          <span>// LEGAL: SITEMAP</span>
          <span>001</span>
        </div>
        <span className="eyebrow">Legal</span>
        <div>
          <h1>Sitemap</h1>
          <p>Complete route index for athena web.</p>
        </div>
      </section>

      <section className="panel" style={{ display: 'grid', gap: '20px' }}>
        <div>
          <h2 style={{ marginBottom: '10px' }}>Public Routes</h2>
          <ul style={{ display: 'grid', gap: '8px', paddingLeft: '20px' }}>
            {publicLinks.map((item) => (
              <li key={item.to}>
                <Link to={item.to}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 style={{ marginBottom: '10px' }}>Authenticated Routes</h2>
          <ul style={{ display: 'grid', gap: '8px', paddingLeft: '20px' }}>
            {protectedLinks.map((item) => (
              <li key={item.to}>
                <Link to={item.to}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
