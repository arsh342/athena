import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { mergeConfig } from '../config.js';
import { parseFile } from '../parser/ast-parser.js';
import { scoreUnit } from '../scorer/heuristic-scorer.js';

type Label = 'human' | 'ai';

interface SampleScore {
  label: Label;
  filePath: string;
  score: number;
  units: number;
}

interface EvalMetrics {
  threshold: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
}

interface CliOptions {
  humanDir: string;
  aiDir: string;
  targetPrecision: number;
  minRecall: number;
  outFile: string;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const samples = [
    ...(await collectScores(opts.humanDir, 'human')),
    ...(await collectScores(opts.aiDir, 'ai')),
  ];

  if (samples.length === 0) {
    throw new Error('No labeled source files found. Provide datasets with JS/TS source files.');
  }

  const evaluations = sweepThresholds(samples);
  const recommended = chooseThreshold(evaluations, opts.targetPrecision, opts.minRecall);

  const report = {
    generatedAt: new Date().toISOString(),
    dataset: {
      humanDir: opts.humanDir,
      aiDir: opts.aiDir,
      files: samples.length,
      humanFiles: samples.filter((sample) => sample.label === 'human').length,
      aiFiles: samples.filter((sample) => sample.label === 'ai').length,
    },
    policy: {
      targetPrecision: opts.targetPrecision,
      minRecall: opts.minRecall,
    },
    recommended,
    evaluations,
  };

  const outPath = resolve(process.cwd(), opts.outFile);
  await mkdir(resolve(outPath, '..'), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Calibration complete.`);
  console.log(`Recommended threshold: ${recommended.threshold}`);
  console.log(
    `Precision ${recommended.precision.toFixed(3)} | Recall ${recommended.recall.toFixed(3)} | F1 ${recommended.f1.toFixed(3)}`,
  );
  console.log(`Report written to ${outPath}`);
}

function parseArgs(args: string[]): CliOptions {
  const get = (flag: string, fallback: string): string => {
    const index = args.indexOf(flag);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };

  return {
    humanDir: resolve(process.cwd(), get('--human', 'datasets/human')),
    aiDir: resolve(process.cwd(), get('--ai', 'datasets/ai')),
    targetPrecision: Number(get('--target-precision', '0.9')),
    minRecall: Number(get('--min-recall', '0.5')),
    outFile: get('--out', 'calibration-out/threshold-report.json'),
  };
}

async function collectScores(rootDir: string, label: Label): Promise<SampleScore[]> {
  const paths = await findSourceFiles(rootDir);
  const config = mergeConfig();
  const scored: SampleScore[] = [];

  for (const filePath of paths) {
    const units = await parseFile(filePath).catch(() => []);
    if (units.length === 0) continue;

    const unitScores = units.map((unit) => scoreUnit(unit, config).score);
    const avgScore = Math.round(unitScores.reduce((sum, score) => sum + score, 0) / unitScores.length);
    scored.push({
      label,
      filePath,
      score: avgScore,
      units: units.length,
    });
  }

  return scored;
}

async function findSourceFiles(dirPath: string): Promise<string[]> {
  const output: string[] = [];
  const stack = [dirPath];
  const validExt = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (validExt.has(extname(entry.name))) {
        output.push(fullPath);
      }
    }
  }

  return output;
}

function sweepThresholds(samples: SampleScore[]): EvalMetrics[] {
  const evaluations: EvalMetrics[] = [];
  for (let threshold = 0; threshold <= 100; threshold++) {
    evaluations.push(evaluateAtThreshold(samples, threshold));
  }
  return evaluations;
}

function evaluateAtThreshold(samples: SampleScore[], threshold: number): EvalMetrics {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  for (const sample of samples) {
    const predictedAi = sample.score >= threshold;
    const isAi = sample.label === 'ai';

    if (predictedAi && isAi) tp++;
    else if (predictedAi && !isAi) fp++;
    else if (!predictedAi && !isAi) tn++;
    else fn++;
  }

  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);
  const accuracy = (tp + tn) / Math.max(1, samples.length);

  return {
    threshold,
    tp,
    fp,
    tn,
    fn,
    precision,
    recall,
    f1,
    accuracy,
  };
}

function chooseThreshold(evaluations: EvalMetrics[], targetPrecision: number, minRecall: number): EvalMetrics {
  const eligible = evaluations.filter(
    (metrics) => metrics.precision >= targetPrecision && metrics.recall >= minRecall,
  );

  const pool = eligible.length > 0 ? eligible : evaluations;
  return [...pool].sort((a, b) => b.f1 - a.f1 || b.precision - a.precision || b.recall - a.recall)[0];
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
