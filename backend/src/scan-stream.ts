export type TerminalLineKind = 'input' | 'output' | 'error' | 'hint';

export interface PersistedTerminalLine {
  seq: number;
  kind: TerminalLineKind;
  text: string;
  createdAt: string;
}

export interface ScanStatusEvent {
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  label: string;
  progress: number;
}

export type ScanStreamEvent =
  | { type: 'line'; line: PersistedTerminalLine }
  | { type: 'status'; status: ScanStatusEvent }
  | { type: 'done' }
  | { type: 'error'; message: string };

type Listener = (event: ScanStreamEvent) => void;

const listenersByScanId = new Map<string, Set<Listener>>();

export function subscribeToScan(scanId: string, listener: Listener): () => void {
  const listeners = listenersByScanId.get(scanId) ?? new Set<Listener>();
  listeners.add(listener);
  listenersByScanId.set(scanId, listeners);

  return () => {
    const current = listenersByScanId.get(scanId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listenersByScanId.delete(scanId);
    }
  };
}

export function emitScanEvent(scanId: string, event: ScanStreamEvent): void {
  const listeners = listenersByScanId.get(scanId);
  if (!listeners) return;
  for (const listener of listeners) {
    listener(event);
  }
}

export function closeScanStream(scanId: string): void {
  listenersByScanId.delete(scanId);
}
