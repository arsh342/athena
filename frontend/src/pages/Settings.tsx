import { useEffect, useState, type FormEvent } from 'react';
import { fetchAiConsent, fetchAiOptions, type AiOptions } from '../services/api';
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

  function forget(): void {
    clearAiSettings();
    setSettings({ ...DEFAULT_SETTINGS });
    setConsent('');
    setMessage('Key and settings removed from this tab.');
  }

  return (
    <div className="page brutalist-page">
      <section className="page-header">
        <div className="br-section-annotation"><span>001 / AI settings</span><span /></div>
        <div>
          <h1>Bring your own key</h1>
          <p>
            Athena works fully offline. If you want an AI model to verify the findings it was unsure about, use your own
            provider key. It is held in this browser tab only, sent with the scan you start, and never stored or logged by Athena.
            Local models (Ollama, LM Studio) need the command-line tool.
          </p>
        </div>
      </section>

      <section className="panel" style={{ padding: 28 }}>
        <form className="ai-form" onSubmit={save}>
          <label className="ai-check">
            <input type="checkbox" checked={settings.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
            <span>Use AI verification on my scans</span>
          </label>

          <div className="field">
            <label htmlFor="ai-provider">Provider</label>
            <select id="ai-provider" value={settings.provider} onChange={(e) => update({ provider: e.target.value as AiProvider, model: '' })}>
              {(Object.keys(PROVIDER_LABEL) as AiProvider[]).map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
            </select>
          </div>

          {settings.provider === 'openai-compatible' ? (
            <div className="field">
              <label htmlFor="ai-preset">Service</label>
              <select id="ai-preset" value={settings.preset} onChange={(e) => update({ preset: e.target.value })}>
                <option value="">Choose a service</option>
                {(options?.presets ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="ai-key">API key</label>
            <input id="ai-key" type="password" autoComplete="off" spellCheck={false} value={settings.key} onChange={(e) => update({ key: e.target.value })} placeholder="paste your key" />
            <span className="ai-note">Kept for this tab only. Closing the tab removes it.</span>
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="ai-model">Model{needsModel ? '' : ' (optional)'}</label>
              <input id="ai-model" value={settings.model} onChange={(e) => update({ model: e.target.value })} placeholder={needsModel ? 'required' : 'claude-sonnet-5-5'} />
            </div>
            <div className="field">
              <label htmlFor="ai-budget">Spend cap for one scan (USD)</label>
              <input id="ai-budget" type="number" min="0.01" max={maxBudget} step="0.01" value={settings.budgetUsd} onChange={(e) => update({ budgetUsd: Number(e.target.value) })} />
              <span className="ai-note">Required. Athena stops when the next call could exceed it. Most you can set: ${maxBudget.toFixed(2)}.</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="ai-mode">Mode</label>
            <select id="ai-mode" value={settings.mode} onChange={(e) => update({ mode: e.target.value as AiSettings['mode'] })}>
              <option value="verify">Verify: check the findings Athena was unsure about</option>
              <option value="hunt">Hunt: also explore the riskiest components</option>
            </select>
          </div>

          <div>
            <button type="button" className="button button-secondary" onClick={() => void showConsent()} disabled={!aiReady({ ...settings, enabled: true })}>
              Show what will be sent
            </button>
          </div>
          {consent ? (
            <>
              <pre className="ai-consent">{consent}</pre>
              <label className="ai-check">
                <input type="checkbox" checked={settings.consented} onChange={(e) => update({ consented: e.target.checked })} />
                <span>I understand and accept this.</span>
              </label>
            </>
          ) : null}

          {error ? <p className="auth-error">{error}</p> : null}
          {message ? <p className="ai-status">{message}</p> : null}

          <div style={{ display: 'flex', gap: 12 }}>
            <button className="button button-primary" type="submit">Save for this tab</button>
            <button className="button button-ghost" type="button" onClick={forget}>Remove key</button>
          </div>
        </form>
      </section>
    </div>
  );
}
