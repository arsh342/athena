import { FormEvent, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { startUploadScan } from '../services/api';
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
  const [repoUrl, setRepoUrl] = useState('');
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

  return (
    <div className="page brutalist-page">
      <section className="page-header">
        <div className="br-section-annotation">
          <span>// SECTION: REPOSITORY_INPUT</span>
          <span>001</span>
        </div>
        <span className="eyebrow">New scan</span>
        <div>
          <h1>Submit a repository</h1>
          <p>Scan public GitHub repositories or upload a local folder or zip archive into a temporary sandbox.</p>
        </div>
      </section>

      <section className="scan-layout">
        <div className="br-section-annotation">
          <span>// SECTION: LIVE_EXECUTION</span>
          <span>002</span>
        </div>

        <div className="scan-form panel">
          <div className="scan-source-tabs" role="tablist" aria-label="Scan source">
            <button
              type="button"
              className={`scan-source-tab${source === 'repo' ? ' is-active' : ''}`}
              onClick={() => handleSourceChange('repo')}
            >
              Repo URL
            </button>
            <button
              type="button"
              className={`scan-source-tab${source === 'upload' ? ' is-active' : ''}`}
              onClick={() => handleSourceChange('upload')}
            >
              Local Upload
            </button>
          </div>

          {source === 'repo' ? (
            <form className="scan-form-inner" onSubmit={handleRepoSubmit}>
              <label htmlFor="repoUrl">Repository URL</label>
              <input
                id="repoUrl"
                type="url"
                value={repoUrl}
                onChange={(event) => setRepoUrl(event.target.value)}
                placeholder="https://github.com/org/repo"
              />
              <button className="button button-primary" type="submit" disabled={!repoUrl.trim() || isScanning}>
                {isScanning ? 'Scanning...' : 'Start scan'}
              </button>
              <div className="scan-rules">
                <span>https repositories only</span>
                <span>120s timeout</span>
                <span>scan-specific findings</span>
                <span>interactive sandbox</span>
              </div>
            </form>
          ) : (
            <form className="scan-form-inner" onSubmit={handleUploadSubmit}>
              <div className="scan-upload-mode" role="tablist" aria-label="Upload mode">
                <button
                  type="button"
                  className={`scan-upload-pill${uploadMode === 'folder' ? ' is-active' : ''}`}
                  onClick={() => handleUploadModeChange('folder')}
                >
                  Folder
                </button>
                <button
                  type="button"
                  className={`scan-upload-pill${uploadMode === 'zip' ? ' is-active' : ''}`}
                  onClick={() => handleUploadModeChange('zip')}
                >
                  ZIP
                </button>
              </div>

              <label htmlFor="uploadInput">{uploadMode === 'folder' ? 'Choose folder' : 'Choose zip file'}</label>
              <input
                id="uploadInput"
                ref={uploadInputRef}
                type="file"
                className="scan-file-input"
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

              {uploadFiles.length > 0 && (
                <section className="scan-upload-status panel">
                  <div className="scan-upload-status-head">
                    <strong>Upload status</strong>
                    <span>{uploadMode}</span>
                  </div>
                  <div className="scan-upload-status-grid">
                    <span>Root</span>
                    <span>{uploadLabel}</span>
                    <span>Files</span>
                    <span>{uploadFiles.length}</span>
                    <span>Size</span>
                    <span>{formatBytes(uploadBytes)}</span>
                  </div>
                </section>
              )}

              {uploadError ? <p className="auth-error">{uploadError}</p> : null}

              <button className="button button-primary" type="submit" disabled={uploadFiles.length === 0 || isUploading || isScanning}>
                {isUploading && !isScanning ? 'Uploading...' : isScanning ? 'Scanning...' : 'Start upload scan'}
              </button>

              <div className="scan-rules">
                <span>folder and zip supported</span>
                <span>200MB max payload</span>
                <span>ignored dirs skipped</span>
                <span>temporary workspace</span>
              </div>
            </form>
          )}
        </div>

        <div className="scan-output-stack">
          <Suspense fallback={null}>
            <WebTerminal
              queuedCommand={queuedCommand}
              onSessionId={setTerminalSessionId}
              onScanningStateChange={setIsScanning}
            />
          </Suspense>
        </div>
      </section>
    </div>
  );
}
