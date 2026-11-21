import { useState, type FormEvent } from 'react';
import { ConfirmButton } from '../components/ConfirmButton';
import { useAuth } from '../hooks/useAuth';
import { deleteAccount, deleteAllScans } from '../services/api';

/** Account settings: delete your scans, or your account. */
export function SettingsPage() {
  const { user } = useAuth();
  const [wiped, setWiped] = useState<number | null>(null);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [accountError, setAccountError] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function removeAccount(event: FormEvent): Promise<void> {
    event.preventDefault();
    setAccountError('');
    setDeleting(true);
    try {
      await deleteAccount(confirmEmail.trim(), accountPassword || undefined);
      // A full page load: it drops every bit of signed-in state, and avoids the route guard bouncing us to the login page first.
      window.location.replace('/');
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : 'Could not delete the account.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="page">
      <section className="page-head">
        <span className="kicker">Settings</span>
        <h1>Your <span className="fx-muted">data</span></h1>
        <p>
          The web scanner works fully offline: it needs no API key and sends your code nowhere. For AI-assisted verification, bigger projects and local
          models, use the command-line tool (<code>npm i -g @arsh342/athena</code>).
        </p>
      </section>

      <section className="panel stack" aria-labelledby="your-data" style={{ gap: 24 }}>
        <div>
          <h2 id="your-data" style={{ fontSize: 22 }}>Your data</h2>
          <p style={{ marginTop: 8, maxWidth: '62ch' }}>
            Delete what athena has saved about you. It leaves the live database straight away, and there is no undo.
          </p>
        </div>

        <div className="data-row">
          <div>
            <p className="adv-title">Delete all my scans</p>
            <p className="adv-body">Removes every scan with its findings, reports and dependency lists. Your account stays. A scan that is running right now is kept.</p>
            {wiped !== null ? <p className="status-line" style={{ marginTop: 10 }}>{wiped === 0 ? 'There were no scans to delete.' : `Deleted ${wiped} scan${wiped === 1 ? '' : 's'}.`}</p> : null}
          </div>
          <ConfirmButton
            label="Delete all scans"
            confirmLabel="Delete all, forever"
            small={false}
            onConfirm={async () => { setWiped(await deleteAllScans()); }}
          />
        </div>

        <form className="data-row data-row-stack" onSubmit={(e) => void removeAccount(e)}>
          <div>
            <p className="adv-title">Delete my account</p>
            <p className="adv-body">Removes your account, your sign-in and every scan, finding and report. To confirm, type your email{user?.email ? <> (<strong>{user.email}</strong>)</> : null}. If you sign in with a password, enter it too.</p>
          </div>
          <div className="cols-2">
            <div className="field">
              <div className="field-row"><label className="field-label" htmlFor="del-email">Your email</label></div>
              <input id="del-email" className="input" type="email" autoComplete="off" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} placeholder={user?.email ?? 'you@company.com'} />
            </div>
            <div className="field">
              <div className="field-row">
                <label className="field-label" htmlFor="del-pass">Password</label>
                {accountError ? <span className="field-error" role="alert">{accountError}</span> : null}
              </div>
              <input id="del-pass" className="input" type="password" autoComplete="current-password" value={accountPassword} onChange={(e) => setAccountPassword(e.target.value)} placeholder="only if you use one" />
            </div>
          </div>
          <div>
            <button className="btn btn-danger btn-danger-solid" type="submit" disabled={deleting || confirmEmail.trim().toLowerCase() !== (user?.email ?? '').toLowerCase() || !user?.email}>
              {deleting ? 'Deleting…' : 'Delete my account forever'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
