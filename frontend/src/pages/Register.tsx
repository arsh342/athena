import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getOAuthErrorMessage, getOAuthStartPath, oauthProviders } from '../auth/oauth';
import { useAuth } from '../hooks/useAuth';

export function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const oauthError = getOAuthErrorMessage(searchParams.get('oauth_error'));
  const displayError = error || oauthError;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || password.trim().length < 8) {
      setError('Valid email and password with 8+ characters are required.');
      return;
    }

    try {
      await signUp(email, password);
      navigate('/dashboard', { replace: true });
    } catch {
      setError('Could not create account. Email may already be registered.');
    }
  }

  return (
    <div className="auth-page brutalist-page">
      <section className="auth-card">
        <span className="eyebrow">Register</span>
        <h1>Start tracking AI risk</h1>
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
            <span>Or create with email</span>
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <label htmlFor="registerEmail">Email</label>
          <input
            id="registerEmail"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="registerPassword">Password</label>
          <input
            id="registerPassword"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {displayError ? <p className="auth-error">{displayError}</p> : null}
          <button className="button button-primary" type="submit">Create account</button>
        </form>
        <p>Already registered? <Link to="/login">Login</Link></p>
      </section>
    </div>
  );
}
