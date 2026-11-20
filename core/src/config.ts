import type { AthenaConfig } from './types.js';

export const defaultWeights = {
  genericNames: 15,
  commentRatio: 12,
  obviousComments: 10,
  emptyCatch: 10,
  nullChecks: 8,
  formattingUniformity: 8,
  universalJsdoc: 7,
  namingEntropy: 10,
  boilerplatePatterns: 10,
  helperOrdering: 10,
  emojiComments: 10,
  perplexity: 12,
  burstiness: 12,
};

export const defaultConfig: AthenaConfig = {
  threshold: 40,
  blockOn: ['CRITICAL', 'HIGH'],
  exclude: ['node_modules/', 'dist/', 'build/', '.git/', 'coverage/', 'test/', 'tests/', '__tests__/'],
  secretDetection: true,
  hallucinationDetection: true,
  eslint: {
    enabled: true,
    timeoutMs: 30000,
  },
  dependencies: { enabled: false, offline: false, registryChecks: true },
  updates: { auto: true, intervalHours: 24, blockKnownExploited: true },
  maxFileSize: 1_048_576,
  weights: defaultWeights,
};

export function mergeConfig(config: Partial<AthenaConfig> = {}): AthenaConfig {
  const mergedEslint = {
    enabled: config.eslint?.enabled ?? defaultConfig.eslint!.enabled,
    timeoutMs: config.eslint?.timeoutMs ?? defaultConfig.eslint!.timeoutMs,
    ...(config.eslint?.rules ? { rules: config.eslint.rules } : {}),
    ...(config.eslint?.plugins ? { plugins: config.eslint.plugins } : {}),
  };

  return {
    ...defaultConfig,
    ...config,
    eslint: mergedEslint,
    updates: {
      auto: config.updates?.auto ?? defaultConfig.updates!.auto,
      intervalHours: config.updates?.intervalHours ?? defaultConfig.updates!.intervalHours,
      blockKnownExploited: config.updates?.blockKnownExploited ?? defaultConfig.updates!.blockKnownExploited,
    },
    dependencies: {
      enabled: config.dependencies?.enabled ?? defaultConfig.dependencies!.enabled,
      offline: config.dependencies?.offline ?? defaultConfig.dependencies!.offline,
      registryChecks: config.dependencies?.registryChecks ?? defaultConfig.dependencies!.registryChecks,
    },
    weights: {
      ...defaultWeights,
      ...config.weights,
    },
  };
}
