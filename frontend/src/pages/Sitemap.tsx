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
    <div className="page">
      <section className="page-head">
        <span className="kicker">Legal</span>
        <h1>Sitemap</h1>
        <p>Complete route index for athena web.</p>
      </section>

      <section className="prose">
        <div>
          <h2>Public Routes</h2>
          <ul>
            {publicLinks.map((item) => (
              <li key={item.to}>
                <Link to={item.to}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2>Authenticated Routes</h2>
          <ul>
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
