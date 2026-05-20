const IGNORED_UPLOAD_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.venv']);
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export function shouldSkipUploadPath(path: string): boolean {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .some((part) => IGNORED_UPLOAD_DIRS.has(part));
}
