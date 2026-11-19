const LOCK_FILES = /(?:^|[\\/])(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum|Pipfile\.lock|bun\.lockb?)$|\.lock$|\.min\.(?:js|json|css)$/i;
const TEXT_EXTENSIONS = /\.(?:ya?ml|json|toml|properties|ini|cfg|conf|config|tf|tfvars|gradle|pem|key|env)$/i;
const TEXT_NAMES = /^(?:\.env(?:\..+)?|\.npmrc|\.netrc|\.pypirc|credentials|Dockerfile(?:\..+)?|docker-compose(?:\..+)?\.ya?ml)$/i;

/** Config-style text files that are searched for secrets only (not parsed as code). */
export function isConfigTextFile(filePath: string): boolean {
  const base = filePath.split(/[\\/]/).pop() ?? '';
  if (LOCK_FILES.test(filePath)) return false;
  return TEXT_NAMES.test(base) || TEXT_EXTENSIONS.test(base);
}

