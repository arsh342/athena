# athena-detect-fast 0.1.0 — Athena-Bench results

Trained 2026-11-19T09:48:47.071644+00:00. Human = permissively licensed repos checked out before 2021-06; AI = units whose lines git blame credits to AI-assisted commits (>= 95% recorded) from 2025 onward; refined = units with 30-80% of their lines blamed on AI commits. Splits are by repository; refined units are excluded from the binary metrics. The `adversarial` class is not present: no real-world source for it was found without generating data locally.

**Read these numbers with two caveats.** (1) *Era confound:* human units come from before 2021 and AI units from 2025 onward, so a classifier can score well by recognising newer syntax (optional chaining, type annotations, f-strings) and small-project style rather than authorship; a high F1 here does not show that modern human code would be classified as human. (2) *Few repositories:* each language's test split has only a handful of distinct repositories, so figures are noisy; the release gate therefore also requires at least 5 distinct repositories per class. No language should be enabled until the human side is era-matched.

Release targets per language (test split): human false-positive rate <= 5% and F1 >= 0.85. A language that misses them, or has too little data, is **disabled**: Athena then uses the labelled style heuristic for it.

| Language | Enabled | Threshold | Test human units | Test AI units | Precision | Recall | F1 | Human FPR | Note |
|---|---|---|---|---|---|---|---|---|---|
| c | no | 0.50 | 62 | 0 | 0.00 | 0.00 | 0.00 | 0.0% | too little test data (62 human / 0 ai) |
| cpp | no | 0.50 | 341 | 0 | 0.00 | 0.00 | 0.00 | 1.5% | too little test data (341 human / 0 ai) |
| csharp | no | 0.50 | 398 | 3 | 0.00 | 0.00 | 0.00 | 0.3% | too little test data (398 human / 3 ai) |
| go | no | 0.50 | 199 | 495 | 0.99 | 0.46 | 0.63 | 1.5% | too few distinct repositories in the test split (1 human / 2 ai, need 5 each) |
| java | no | 0.50 | 376 | 0 | 0.00 | 0.00 | 0.00 | 0.0% | too little test data (376 human / 0 ai) |
| javascript | no | 0.50 | 378 | 874 | 0.97 | 0.92 | 0.94 | 6.6% | too few distinct repositories in the test split (5 human / 4 ai, need 5 each) |
| php | no | 0.50 | 388 | 0 | 0.00 | 0.00 | 0.00 | 0.0% | too little test data (388 human / 0 ai) |
| python | no | 0.50 | 520 | 167 | 0.50 | 0.93 | 0.65 | 30.0% | too few distinct repositories in the test split (5 human / 2 ai, need 5 each) |
| rust | no | 0.55 | 198 | 216 | 0.83 | 0.40 | 0.54 | 9.1% | too few distinct repositories in the test split (1 human / 2 ai, need 5 each) |
| shell | no | 0.50 | 117 | 31 | 0.85 | 0.71 | 0.77 | 3.4% | too few distinct repositories in the test split (2 human / 3 ai, need 5 each) |
| tsx | no | 0.50 | 4 | 59 | 0.95 | 0.90 | 0.92 | 75.0% | too little test data (4 human / 59 ai) |
| typescript | no | 0.64 | 164 | 222 | 0.92 | 0.87 | 0.89 | 10.4% | too few distinct repositories in the test split (1 human / 1 ai, need 5 each) |

## Newest split (the most recent 20% of AI repos by commit date, held out of training)

| Language | Units | AI recall |
|---|---|---|
| go | 462 | 0.52 |
| java | 20 | 0.00 |
| javascript | 400 | 0.90 |
| php | 1 | 0.00 |
| python | 1319 | 0.93 |
| rust | 2 | 1.00 |
| shell | 2 | 0.50 |
| tsx | 584 | 0.89 |
| typescript | 1543 | 0.78 |

## Dataset sizes

```json
{
 "dev": {
  "c": {
   "ai": 1,
   "human": 349,
   "refined": 1
  },
  "cpp": {
   "human": 464
  },
  "csharp": {
   "human": 223
  },
  "go": {
   "ai": 30,
   "human": 759
  },
  "java": {
   "human": 337
  },
  "javascript": {
   "ai": 17,
   "human": 252
  },
  "python": {
   "ai": 896,
   "human": 231,
   "refined": 201
  },
  "rust": {
   "ai": 7,
   "human": 576
  },
  "shell": {
   "ai": 117,
   "human": 43,
   "refined": 31
  },
  "tsx": {
   "ai": 56,
   "refined": 7
  },
  "typescript": {
   "ai": 405,
   "human": 22,
   "refined": 7
  }
 },
 "newest": {
  "go": {
   "ai": 428,
   "refined": 34
  },
  "java": {
   "ai": 13,
   "refined": 7
  },
  "javascript": {
   "ai": 400
  },
  "php": {
   "ai": 1
  },
  "python": {
   "ai": 1274,
   "refined": 45
  },
  "rust": {
   "ai": 2
  },
  "shell": {
   "ai": 2
  },
  "tsx": {
   "ai": 548,
   "refined": 36
  },
  "typescript": {
   "ai": 1386,
   "refined": 157
  }
 },
 "test": {
  "c": {
   "human": 62
  },
  "cpp": {
   "human": 341
  },
  "csharp": {
   "ai": 3,
   "human": 398,
   "refined": 2
  },
  "go": {
   "ai": 495,
   "human": 199
  },
  "java": {
   "human": 376
  },
  "javascript": {
   "ai": 874,
   "human": 378,
   "refined": 75
  },
  "php": {
   "human": 388
  },
  "python": {
   "ai": 167,
   "human": 520,
   "refined": 2
  },
  "rust": {
   "ai": 216,
   "human": 198,
   "refined": 1
  },
  "shell": {
   "ai": 31,
   "human": 117,
   "refined": 1
  },
  "tsx": {
   "ai": 59,
   "human": 4,
   "refined": 8
  },
  "typescript": {
   "ai": 222,
   "human": 164,
   "refined": 16
  }
 },
 "train": {
  "c": {
   "human": 3275
  },
  "cpp": {
   "ai": 398,
   "human": 2162
  },
  "csharp": {
   "ai": 398,
   "human": 2944
  },
  "go": {
   "ai": 756,
   "human": 2858,
   "refined": 43
  },
  "java": {
   "ai": 9,
   "human": 2680
  },
  "javascript": {
   "ai": 1215,
   "human": 3440,
   "refined": 73
  },
  "php": {
   "ai": 731,
   "human": 3183,
   "refined": 32
  },
  "python": {
   "ai": 3413,
   "human": 2611,
   "refined": 135
  },
  "rust": {
   "ai": 1202,
   "human": 2025,
   "refined": 51
  },
  "shell": {
   "ai": 509,
   "human": 709,
   "refined": 6
  },
  "tsx": {
   "ai": 910,
   "human": 293,
   "refined": 49
  },
  "typescript": {
   "ai": 2709,
   "human": 412,
   "refined": 102
  }
 }
}
```

Reproduce: `npm run build -w @athena/core && cd ml && uv run python -m athena_ml.collect_all all 20` (the published run used about 70 AI repos over several resumed runs; GitHub search results change, so rerunning will not reproduce these exact numbers) then `uv run python -m athena_ml.run_train 0.1.0`
