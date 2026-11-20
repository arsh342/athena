import { Link } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { FormEvent, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { startScan, startUploadScan } from '../services/api';
import { aiReady, loadAiSettings } from '../utils/ai-settings';
import { MAX_UPLOAD_BYTES, shouldSkipUploadPath } from '../utils/upload';

type ScanSource = 'repo' | 'upload';
type UploadMode = 'folder' | 'zip';

const WebTerminal = lazy(async () => {
  const module = await import('../components/WebTerminal');
  return { default: module.WebTerminal };
});

/**
 * Upload scans already run via API; no terminal command should trigger git clone.
 */
export function buildUploadQueuedCommand(label: string): string | null {
  return `upload ${label}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function getFolderRootName(files: File[]): string {
  const first = files[0];
  if (!first) return 'local-folder-upload';
  const relativePath = first.webkitRelativePath?.replace(/\\/g, '/') || first.name;
  return relativePath.split('/').filter(Boolean)[0] || 'local-folder-upload';
}

function getUploadDisplayName(files: File[], mode: UploadMode): string {
  if (mode === 'folder') return getFolderRootName(files);
  const first = files[0];
  return first ? first.name.replace(/\.zip$/i, '') || first.name : 'local-zip-upload';
}

export function ScanPage() {
  const [source, setSource] = useState<ScanSource>('repo');
  const [searchParams] = useSearchParams();
  const [repoUrl, setRepoUrl] = useState(searchParams.get('repo') ?? '');
  const [queuedCommand, setQueuedCommand] = useState<{ id: number; command: string } | null>(null);
  const [terminalSessionId, setTerminalSessionId] = useState('');
  const [uploadMode, setUploadMode] = useState<UploadMode>('folder');
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const uploadBytes = useMemo(
    () => uploadFiles.reduce((sum, file) => sum + file.size, 0),
    [uploadFiles],
  );
  const uploadLabel = useMemo(
    () => getUploadDisplayName(uploadFiles, uploadMode),
    [uploadFiles, uploadMode],
  );

  useEffect(() => {
    const input = uploadInputRef.current;
    if (!input) return;

    if (uploadMode === 'folder') {
      input.setAttribute('webkitdirectory', '');
      return;
    }

    input.removeAttribute('webkitdirectory');
  }, [uploadMode]);

  function handleSourceChange(next: ScanSource) {
    setSource(next);
    setUploadError('');
  }

  function handleUploadModeChange(next: UploadMode) {
    setUploadMode(next);
    setUploadFiles([]);
    setUploadError('');
  }

  function handleFolderSelection(fileList: FileList | null) {
    const selected = Array.from(fileList ?? []).filter((file) => !shouldSkipUploadPath(file.webkitRelativePath || file.name));
    setUploadFiles(selected);
    setUploadError(selected.length === 0 ? 'No scannable files remained after filtering ignored directories.' : '');
  }

  function handleZipSelection(fileList: FileList | null) {
    const selected = Array.from(fileList ?? []);
    setUploadFiles(selected);
    setUploadError('');
  }

  function handleRepoSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repoUrl.trim()) return;
    if (aiReady(loadAiSettings())) {
      // The terminal socket cannot carry the key, so an AI scan goes over HTTP and streams its lines into the terminal session.
      setUploadError('');
      setIsUploading(true);
      void (async () => {
        try {
          await startScan(repoUrl.trim(), terminalSessionId);
          const name = repoUrl.trim().replace(/\/+$/, '').split('/').pop()?.replace(/\.git$/i, '') || 'repository';
          const queued = buildUploadQueuedCommand(name);
          if (queued) setQueuedCommand({ id: Date.now(), command: queued });
        } catch (error) {
          setUploadError(error instanceof Error ? error.message : 'Scan failed.');
        } finally {
          setIsUploading(false);
        }
      })();
      return;
    }
    setQueuedCommand({ id: Date.now(), command: `scan ${repoUrl.trim()}` });
  }

  function validateUploadSelection(): string {
    if (uploadFiles.length === 0) return 'Select a folder or zip file first.';
    if (uploadBytes > MAX_UPLOAD_BYTES) return 'Upload exceeds 200MB limit.';
    if (uploadMode === 'zip') {
      if (uploadFiles.length !== 1) return 'ZIP mode requires exactly one file.';
      if (!uploadFiles[0]?.name.toLowerCase().endsWith('.zip')) return 'ZIP mode requires a .zip file.';
    }
    return '';
  }

  function handleUploadSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateUploadSelection();
    if (validationError) {
      setUploadError(validationError);
      return;
    }

    setUploadError('');
    setIsUploading(true);
    const payload = new FormData();
    payload.set('mode', uploadMode);
    payload.set('rootName', uploadLabel);

    for (const file of uploadFiles) {
      const fileName = uploadMode === 'folder'
        ? (file.webkitRelativePath?.replace(/\\/g, '/') || file.name)
        : file.name;
      payload.append('files[]', file, fileName);
    }

    void (async () => {
      try {
        await startUploadScan(payload, terminalSessionId);
        const queued = buildUploadQueuedCommand(uploadLabel);
        if (queued) setQueuedCommand({ id: Date.now(), command: queued });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload scan failed.';
        setUploadError(message);
      } finally {
        setIsUploading(false);
      }
    })();
  }

  const aiOn = aiReady(loadAiSettings());
  const busy = isScanning || isUploading;

  return (
    <div className="page">
      <section className="page-head">
        <span className="kicker">New scan</span>
        <h1>Submit a <span className="fx-muted">repository</span></h1>
        <p>Scan a public GitHub repository, or upload a local folder or zip archive into a temporary sandbox.</p>
      </section>

      <section className="scan-grid">
        <div className="panel stack">
          <div className="seg" role="group" aria-label="Scan source">
            <button type="button" aria-pressed={source === 'repo'} onClick={() => handleSourceChange('repo')}>Repo URL</button>
            <button type="button" aria-pressed={source === 'upload'} onClick={() => handleSourceChange('upload')}>Upload</button>
          </div>

          {source === 'repo' ? (
            <form className="stack" onSubmit={handleRepoSubmit}>
              {aiOn
                ? <p className="status-line">AI verification is on for this tab. <Link to="/settings">Change</Link></p>
                : <p className="field-hint">Offline scan. <Link to="/settings">Add your own AI key</Link> to have findings verified.</p>}
              <div className="field">
                <div className="field-row">
                  <label className="field-label" htmlFor="repoUrl">Repository URL</label>
                  {uploadError ? <span className="field-error" role="alert">{uploadError}</span> : null}
                </div>
                <input id="repoUrl" className="input" type="url" value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} placeholder="https://github.com/org/repo" />
              </div>
              <button className="btn btn-solid" type="submit" disabled={!repoUrl.trim() || busy}>
                {busy ? 'Scanning…' : 'Start scan'}
              </button>
              <div className="tags">
                <span className="tag">https only</span>
                <span className="tag">120s timeout</span>
                <span className="tag">interactive sandbox</span>
              </div>
            </form>
          ) : (
            <form className="stack" onSubmit={handleUploadSubmit}>
              <div className="seg" role="group" aria-label="Upload mode">
                <button type="button" aria-pressed={uploadMode === 'folder'} onClick={() => handleUploadModeChange('folder')}>Folder</button>
                <button type="button" aria-pressed={uploadMode === 'zip'} onClick={() => handleUploadModeChange('zip')}>ZIP</button>
              </div>

              <div className="field">
                <div className="field-row">
                  <label className="field-label" htmlFor="uploadInput">{uploadMode === 'folder' ? 'Choose folder' : 'Choose zip file'}</label>
                  {uploadError ? <span className="field-error" role="alert">{uploadError}</span> : null}
                </div>
                <input
                  id="uploadInput"
                  ref={uploadInputRef}
                  type="file"
                  className="input"
                  style={{ paddingTop: 10 }}
                  key={uploadMode}
                  accept={uploadMode === 'zip' ? '.zip,application/zip' : undefined}
                  multiple={uploadMode === 'folder'}
                  onChange={(event) => {
                    if (uploadMode === 'folder') {
                      handleFolderSelection(event.currentTarget.files);
                      return;
                    }
                    handleZipSelection(event.currentTarget.files);
                  }}
                />
              </div>

              {uploadFiles.length > 0 ? (
                <div className="kv">
                  <span>Root</span><span>{uploadLabel}</span>
                  <span>Files</span><span>{uploadFiles.length}</span>
                  <span>Size</span><span>{formatBytes(uploadBytes)}</span>
                </div>
              ) : null}

              <button className="btn btn-solid" type="submit" disabled={uploadFiles.length === 0 || busy}>
                {isUploading && !isScanning ? 'Uploading…' : isScanning ? 'Scanning…' : 'Start upload scan'}
              </button>
              <div className="tags">
                <span className="tag">200MB max</span>
                <span className="tag">ignored dirs skipped</span>
                <span className="tag">temporary workspace</span>
              </div>
            </form>
          )}
        </div>

        <Suspense fallback={null}>
          <WebTerminal queuedCommand={queuedCommand} onSessionId={setTerminalSessionId} onScanningStateChange={setIsScanning} />
        </Suspense>
      </section>
    </div>
  );
}
