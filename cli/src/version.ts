import packageJson from '../package.json';

type PackageJson = {
  version?: string;
};

const parsed = packageJson as PackageJson;

export const CLI_VERSION = parsed.version ?? '0.0.0';