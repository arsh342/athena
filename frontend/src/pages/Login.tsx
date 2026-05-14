import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getOAuthErrorMessage, getOAuthStartPath, oauthProviders } from '../auth/oauth';
import { useAuth } from '../hooks/useAuth';

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const oauthError = getOAuthErrorMessage(searchParams.get('oauth_error'));
  const displayError = error || oauthError;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }

    try {
      await signIn(email, password);
      navigate('/dashboard', { replace: true });
    } catch {
      setError('Invalid credentials or temporary lockout.');
    }
  }

  return (
    <div className="auth-page brutalist-page">
      <section className="auth-card">
        <span className="eyebrow">Sign in</span>
        <h1>Return to scans</h1>
        <div className="auth-oauth-stack">
          <div className="auth-oauth-grid">
            {oauthProviders.map((option) => (
              <a
                key={option.provider}
                className="auth-oauth-button"
                href={getOAuthStartPath(option.provider)}
              >
                Continue with {option.label}
              </a>
            ))}
          </div>
          <div className="auth-divider">
            <span>Or use email</span>
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {displayError ? <p className="auth-error">{displayError}</p> : null}
          <button className="button button-primary" type="submit">Login</button>
        </form>
        <p>Need access? <Link to="/register">Create account</Link></p>
      </section>
    </div>
  );
}
