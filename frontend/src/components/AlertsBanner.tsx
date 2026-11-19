import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAlerts } from '../services/api';
import { alertHeadline, rescanPath, type RepoAlerts } from '../utils/alerts';

export function AlertsBanner() {
  const [repos, setRepos] = useState<RepoAlerts[]>([]);

  useEffect(() => {
    let active = true;
    fetchAlerts()
      .then((data) => {
        if (active) setRepos(data);
      })
      .catch(() => {
        if (active) setRepos([]);
      });
    return () => {
      active = false;
    };
  }, []);

  if (repos.length === 0) return null;
  return (
    <section className="panel alerts-banner" role="alert" aria-label="New vulnerabilities">
      {repos.map((repo) => (
        <div key={repo.scanId} className="alerts-banner-row">
          <strong>{alertHeadline(repo)}</strong>
          <ul>
            {repo.alerts.slice(0, 3).map((a) => (
              <li key={`${a.advisoryId}-${a.package}`}>
                {a.severity} · {a.package}@{a.version} · {a.advisoryId}{a.fixedIn ? ` (fixed in ${a.fixedIn})` : ''}
              </li>
            ))}
          </ul>
          <Link className="button button-primary" to={rescanPath(repo)}>Re-scan</Link>
        </div>
      ))}
    </section>
  );
}
