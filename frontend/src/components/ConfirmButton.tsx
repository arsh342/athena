import { useEffect, useState } from 'react';

interface Props {
  label: string;
  /** What the second click says, so nobody deletes by accident. */
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  small?: boolean;
  className?: string;
}

/** A destructive button that takes two clicks: the first arms it, the second does it. It disarms by itself after a few seconds. */
export function ConfirmButton({ label, confirmLabel, onConfirm, small = true, className = '' }: Props) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!armed || busy) return;
    const id = window.setTimeout(() => setArmed(false), 6000);
    return () => window.clearTimeout(id);
  }, [armed, busy]);

  async function run(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.');
      setArmed(false);
    } finally {
      setBusy(false);
    }
  }

  const size = small ? ' btn-sm' : '';
  return (
    <span className={`confirm ${className}`}>
      {armed ? (
        <>
          <button type="button" className={`btn btn-danger btn-danger-solid${size}`} disabled={busy} onClick={() => void run()}>
            {busy ? 'Deleting…' : confirmLabel}
          </button>
          <button type="button" className={`btn${size}`} disabled={busy} onClick={() => setArmed(false)}>Cancel</button>
        </>
      ) : (
        <button type="button" className={`btn btn-danger${size}`} onClick={() => setArmed(true)}>{label}</button>
      )}
      {error ? <span className="field-error" role="alert">{error}</span> : null}
    </span>
  );
}
