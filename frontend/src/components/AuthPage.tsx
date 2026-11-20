import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { artPanel } from 'asciify-engine/kit';
import { getOAuthErrorMessage, getOAuthStartPath, oauthProviders } from '../auth/oauth';
import { useAuth } from '../hooks/useAuth';
import { GitHubIcon, GoogleIcon, LockIcon, MailIcon } from './Icons';
import { LoadingGlyph } from './LoadingGlyph';
import { Logo } from './Logo';

type Mode = 'login' | 'register';
type FieldName = 'email' | 'password';

const COPY = {
  login: { title: 'Welcome back', lede: 'Sign in to see your scans and reports.', cta: 'Continue', alt: ['New here?', 'Create an account', '/register'] },
  register: { title: 'Create your account', lede: 'Scan repositories and keep every report in one place.', cta: 'Create account', alt: ['Already registered?', 'Sign in', '/login'] },
} as const;

/** Split sign-in: the owl in characters on the left, trailing under the cursor, the form on the right. */
export function AuthPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ field: FieldName; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const artRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const art = useRef<ReturnType<typeof artPanel> | null>(null);

  useEffect(() => {
    if (!artRef.current) return;
    const handle = artPanel(artRef.current, {
      image: '/images/athena.png',
      ...(markRef.current ? { clear: markRef.current } : {}),
      focus: { x: 0.5, y: 0.42 },
      label: 'An owl, drawn in characters',
    });
    art.current = handle;
    return () => {
      handle.destroy();
      art.current = null;
    };
  }, []);

  const oauthError = getOAuthErrorMessage(searchParams.get('oauth_error'));
  const shown = error ?? (oauthError ? { field: 'email' as FieldName, message: oauthError } : null);
  const copy = COPY[mode];
  const providers = [...oauthProviders].sort((a, b) => (a.provider === 'github' ? -1 : b.provider === 'github' ? 1 : 0));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!email.trim()) return setError({ field: 'email', message: 'Enter your email.' });
    if (mode === 'login' ? !password.trim() : password.trim().length < 8) {
      return setError({ field: 'password', message: mode === 'login' ? 'Enter your password.' : 'Use 8 or more characters.' });
    }
    setError(null);
    setBusy(true);
    art.current?.pulse(buttonRef.current ?? undefined, 1.8);
    art.current?.shimmer(true);
    try {
      await (mode === 'login' ? signIn(email, password) : signUp(email, password));
      navigate('/dashboard', { replace: true });
    } catch {
      setError({ field: 'password', message: mode === 'login' ? 'Wrong details, or locked for a while.' : 'Could not create it. The email may be taken.' });
    } finally {
      art.current?.shimmer(false);
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-art" ref={artRef}>
        <img src="/images/athena.png" alt="" />
        <div className="auth-mark" ref={markRef}>
          <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}><Logo size={26} />athena</strong>
          <span>Know what AI wrote before it ships.</span>
        </div>
      </div>

      <div className="auth-side">
        <div className="auth-form">
          <div className="stack" style={{ gap: 10 }}>
            <h1>{copy.title}</h1>
            <p>{copy.lede}</p>
          </div>

          <form className="auth-fields" onSubmit={handleSubmit} noValidate>
            <div className="field">
              <div className="field-row">
                <label className="field-label" htmlFor="auth-email">Email</label>
                {shown?.field === 'email' ? <span className="field-error" role="alert">{shown.message}</span> : null}
              </div>
              <div className="pill-input" data-invalid={shown?.field === 'email'}>
                <MailIcon />
                <input id="auth-email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>

            <div className="field">
              <div className="field-row">
                <label className="field-label" htmlFor="auth-password">Password</label>
                {shown?.field === 'password' ? <span className="field-error" role="alert">{shown.message}</span> : null}
              </div>
              <div className="pill-input" data-invalid={shown?.field === 'password'}>
                <LockIcon />
                <input id="auth-password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>

            <button ref={buttonRef} className="btn btn-solid btn-block" type="submit" disabled={busy} aria-busy={busy}>
              {busy ? <LoadingGlyph /> : null}
              {busy ? 'Working' : copy.cta}
            </button>
          </form>

          <div className="auth-or">or</div>

          <div className="stack" style={{ gap: 10 }}>
            {providers.map((option) => (
              <a key={option.provider} className="btn btn-block" href={getOAuthStartPath(option.provider)}>
                {option.provider === 'github' ? <GitHubIcon width={18} height={18} /> : <GoogleIcon width={18} height={18} />}
                Continue with {option.label}
              </a>
            ))}
          </div>

          <p className="auth-alt">{copy.alt[0]} <Link to={copy.alt[2]}>{copy.alt[1]}</Link></p>
        </div>
      </div>
    </div>
  );
}
