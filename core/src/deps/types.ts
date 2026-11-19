export type Ecosystem = 'npm' | 'PyPI' | 'Maven' | 'NuGet' | 'Go' | 'crates.io' | 'Packagist' | 'vcpkg' | 'Conan';

export interface Dependency {
  ecosystem: Ecosystem;
  name: string;
  /** Resolved version, or the declared range when there is no lockfile. */
  version: string;
  direct: boolean;
  /** Path of the manifest or lockfile it came from. */
  manifest: string;
  /** 1-based line in that file (1 when unknown). */
  line: number;
  /** Declared with a range and no lockfile resolved it. */
  unpinned?: boolean;
  /** file:, git, workspace, link or scoped-registry package: never looked up on a public registry. */
  private?: boolean;
  /** Comes from a custom registry/index: never reported as non-existent, but still checked for advisories. */
  registryPrivate?: boolean;
}

export const MANIFEST_FILE = /(?:^|[\\/])(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|requirements[\w.-]*\.txt|poetry\.lock|Pipfile\.lock|uv\.lock|pyproject\.toml|pom\.xml|gradle\.lockfile|packages\.lock\.json|[\w.-]+\.(?:cs|fs|vb)proj|go\.mod|go\.sum|Cargo\.lock|Cargo\.toml|composer\.lock|composer\.json|vcpkg\.json|conan\.lock)$/;
