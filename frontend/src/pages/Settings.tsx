import { useEffect, useState, type FormEvent } from 'react';
import { Check } from '../components/Advantages';
import { ConfirmButton } from '../components/ConfirmButton';
import { useAuth } from '../hooks/useAuth';
import { deleteAccount, deleteAllScans, fetchAiConsent, fetchAiOptions, type AiOptions } from '../services/api';
import { DEFAULT_SETTINGS, aiReady, clearAiSettings, loadAiSettings, maskedKey, saveAiSettings, type AiProvider, type AiSettings } from '../utils/ai-settings';

const PROVIDER_LABEL: Record<AiProvider, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  google: 'Google (Gemini)',
  'openai-compatible': 'OpenAI-compatible (OpenRouter, Groq, DeepSeek, ...)',
};

/** Bring-your-own-key settings for AI scans. The key stays in this tab (sessionStorage) and is sent only with a scan you start with AI on. */
export function SettingsPage() {
  const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings());
  const [options, setOptions] = useState<AiOptions | null>(null);
  const [consent, setConsent] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const { user } = useAuth();
  const [wiped, setWiped] = useState<number | null>(null);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [accountError, setAccountError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchAiOptions().then(setOptions).catch(() => setOptions(null));
  }, []);

  const update = (patch: Partial<AiSettings>) => setSettings((s) => ({ ...s, ...patch, ...(('provider' in patch || 'model' in patch || 'preset' in patch || 'budgetUsd' in patch) ? { consented: false } : {}) }));
  const maxBudget = options?.maxBudgetUsd ?? 1;
  const needsModel = settings.provider !== 'anthropic';

  async function showConsent(): Promise<void> {
    setError('');
    try {
      setConsent(await fetchAiConsent(settings));
    } catch (e) {
      setConsent('');
      setError(e instanceof Error ? e.message : 'Could not load the consent text.');
    }
  }

  function save(event: FormEvent): void {
    event.preventDefault();
    setError('');
    if (settings.enabled && !aiReady(settings)) {
      setError('Add a key, a model (for providers other than Anthropic) and a spend cap first.');
      return;
    }
    if (settings.enabled && !settings.consented) {
      setError('Read and accept what will be sent, then save.');
      return;
    }
    if (settings.budgetUsd > maxBudget) {
      setError(`The cap for one scan is at most $${maxBudget.toFixed(2)}.`);
      return;
    }
    saveAiSettings(settings);
    setMessage(settings.enabled ? `AI scans are on for this tab (${settings.provider}, cap $${settings.budgetUsd.toFixed(2)}, key ${maskedKey(settings.key)}).` : 'AI scans are off. Nothing is sent to any provider.');
  }

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

  function forget(): void {
    clearAiSettings();
    setSettings({ ...DEFAULT_SETTINGS });
    setConsent('');
    setMessage('Key and settings removed from this tab.');
  }

  return (
    <div className="page">
      <section className="page-head">
        <span className="kicker">AI settings</span>
        <h1>Bring your <span className="fx-muted">own key</span></h1>
        <p>
            Athena works fully offline. If you want an AI model to verify the findings it was unsure about, use your own
            provider key. It is held in this browser tab only, sent with the scan you start, and never stored or logged by Athena.
            Local models (Ollama, LM Studio) need the command-line tool.
        </p>
      </section>

      <div className="settings-grid">
      <section className="panel">
        <form className="stack" style={{ gap: 22 }} onSubmit={save}>
          <label className="check">
            <input type="checkbox" checked={settings.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
            <span>Use AI verification on my scans</span>
          </label>

          <div className="field">
            <label className="field-label" htmlFor="ai-provider">Provider</label>
            <select className="select" id="ai-provider" value={settings.provider} onChange={(e) => update({ provider: e.target.value as AiProvider, model: '' })}>
              {(Object.keys(PROVIDER_LABEL) as AiProvider[]).map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
            </select>
          </div>

          {settings.provider === 'openai-compatible' ? (
            <div className="field">
              <label className="field-label" htmlFor="ai-preset">Service</label>
              <select className="select" id="ai-preset" value={settings.preset} onChange={(e) => update({ preset: e.target.value })}>
                <option value="">Choose a service</option>
                {(options?.presets ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          ) : null}

          <div className="field">
            <label className="field-label" htmlFor="ai-key">API key</label>
            <input className="input" id="ai-key" type="password" autoComplete="off" spellCheck={false} value={settings.key} onChange={(e) => update({ key: e.target.value })} placeholder="paste your key" />
            <span className="field-hint">Kept for this tab only. Closing the tab removes it.</span>
          </div>

          <div className="cols-2">
            <div className="field">
              <label className="field-label" htmlFor="ai-model">Model{needsModel ? '' : ' (optional)'}</label>
              <input className="input" id="ai-model" value={settings.model} onChange={(e) => update({ model: e.target.value })} placeholder={needsModel ? 'required' : 'claude-sonnet-5-5'} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="ai-budget">Spend cap for one scan (USD)</label>
              <input className="input" id="ai-budget" type="number" min="0.01" max={maxBudget} step="0.01" value={settings.budgetUsd} onChange={(e) => update({ budgetUsd: Number(e.target.value) })} />
              <span className="field-hint">Required. Athena stops when the next call could exceed it. Most you can set: ${maxBudget.toFixed(2)}.</span>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="ai-mode">Mode</label>
            <select className="select" id="ai-mode" value={settings.mode} onChange={(e) => update({ mode: e.target.value as AiSettings['mode'] })}>
              <option value="verify">Verify: check the findings Athena was unsure about</option>
              <option value="hunt">Hunt: also explore the riskiest components</option>
            </select>
          </div>

          <div>
            <button type="button" className="btn" onClick={() => void showConsent()} disabled={!aiReady({ ...settings, enabled: true })}>
              Show what will be sent
            </button>
          </div>
          {consent ? (
            <>
              <pre className="pre-block">{consent}</pre>
              <label className="check">
                <input type="checkbox" checked={settings.consented} onChange={(e) => update({ consented: e.target.checked })} />
                <span>I understand and accept this.</span>
              </label>
            </>
          ) : null}

          {error ? <p className="field-error" role="alert" style={{ textAlign: 'left' }}>{error}</p> : null}
          {message ? <p className="status-line">{message}</p> : null}

          <div className="row">
            <button className="btn btn-solid" type="submit">Save for this tab</button>
            <button className="btn" type="button" onClick={forget}>Remove key</button>
          </div>
        </form>
      </section>

      <aside className="panel stack" aria-label="How your key is handled">
        <h2 style={{ fontSize: 20 }}>How your key is handled</h2>
        <ul className="adv-grid" style={{ gridTemplateColumns: '1fr', gap: 22 }}>
          {[
            ['Kept in this tab only', 'Closing the tab removes it. It is never written to local storage.'],
            ['Used for one scan at a time', 'It travels only with a scan you start with AI on, and is held in memory for that scan.'],
            ['Never stored or logged', 'Not in the database, in reports, or in our logs.'],
            ['Capped before anything runs', 'Athena stops when the next call could exceed the spend cap you set.'],
            ['You see what is sent', 'Settings shows the exact excerpts first and asks you to agree. Secrets are never sent.'],
          ].map(([title, body]) => (
            <li className="adv-item" key={title}>
              <Check />
              <div><p className="adv-title">{title}</p><p className="adv-body">{body}</p></div>
            </li>
          ))}
        </ul>
      </aside>
      </div>

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
