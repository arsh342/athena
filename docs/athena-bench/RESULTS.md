# athena-detect-fast 0.2.1 — Athena-Bench results

Trained 2026-11-20T16:36:51.356520+00:00. Human = permissively licensed repos checked out before 2021-06; AI = units whose lines git blame credits to AI-assisted commits (>= 95% recorded) from 2025 onward; refined = units with 30-80% of their lines blamed on AI commits. Splits are by repository; refined units are excluded from the binary metrics. The `adversarial` class is not present: no real-world source for it was found without generating data locally.

**Read these numbers with three caveats.** (1) *Era:* the first human pool is code from before 2021-06 and the AI code is from 2025 onward, so a classifier can score well by recognising newer syntax (optional chaining, type annotations, f-strings) and small-project style rather than authorship. A second human pool (code as of 2022-06-21, Copilot's general release) narrows the gap and feeds an **era-robustness check**: a language is enabled only if its human false-positive rate on 2022-era human test units is also <= 5%. Neither pool can show that code written today by a human is classified as human; no verified-human recent code exists to test with. (2) *Few repositories:* each language's test split has only a handful of distinct repositories, so figures are noisy; the release gate therefore also requires at least 5 distinct repositories per class. (3) *Contamination:* 2022-era human code may include a little Copilot-preview-assisted code.

Release targets per language (test split): human false-positive rate <= 5% and F1 >= 0.85. A language that misses them, or has too little data, is **disabled**: Athena then uses the labelled style heuristic for it.

| Language | Enabled | Threshold | Test human units | Test AI units | Precision | Recall | F1 | Human FPR | 2022-era human FPR | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| c | no | 0.50 | 62 | 13 | 0.80 | 0.62 | 0.70 | 3.2% | n/a (n=0) | too few distinct repositories in the test split (2 human / 1 ai, need 5 each) |
| cpp | no | 0.50 | 341 | 47 | 0.71 | 0.77 | 0.73 | 4.4% | n/a (n=0) | too few distinct repositories in the test split (3 human / 2 ai, need 5 each) |
| csharp | no | 0.78 | 398 | 3 | 0.14 | 0.33 | 0.20 | 1.5% | n/a (n=0) | too little test data (398 human / 3 ai) |
| go | no | 0.50 | 241 | 864 | 0.99 | 0.77 | 0.86 | 3.3% | 0.0% (n=42) | too few distinct repositories in the test split (2 human / 3 ai, need 5 each) |
| java | no | 0.50 | 376 | 0 | 0.00 | 0.00 | 0.00 | 0.3% | n/a (n=0) | too little test data (376 human / 0 ai) |
| javascript | yes | 0.72 | 778 | 1109 | 0.98 | 0.90 | 0.94 | 3.0% | 4.2% (n=400) | meets release targets |
| php | no | 0.50 | 588 | 0 | 0.00 | 0.00 | 0.00 | 0.0% | 0.0% (n=200) | too little test data (588 human / 0 ai) |
| python | no | 0.69 | 660 | 1240 | 0.93 | 0.96 | 0.95 | 13.3% | 0.7% (n=140) | human false-positive rate 13.3% > 5% |
| rust | no | 0.71 | 397 | 819 | 0.97 | 0.40 | 0.57 | 2.8% | 1.5% (n=199) | too few distinct repositories in the test split (2 human / 5 ai, need 5 each) |
| shell | no | 0.63 | 193 | 33 | 0.67 | 0.79 | 0.72 | 6.7% | 6.6% (n=76) | too few distinct repositories in the test split (3 human / 4 ai, need 5 each) |
| tsx | no | 0.81 | 73 | 96 | 0.95 | 0.78 | 0.86 | 5.5% | 5.8% (n=69) | too few distinct repositories in the test split (2 human / 3 ai, need 5 each) |
| typescript | yes | 0.84 | 493 | 1327 | 0.98 | 0.76 | 0.86 | 4.3% | 4.9% (n=329) | meets release targets |

## Newest split (the most recent 20% of AI repos by commit date, held out of training)

| Language | Units | AI recall |
|---|---|---|
| c | 19 | 0.21 |
| csharp | 399 | 0.68 |
| go | 1661 | 0.58 |
| java | 258 | 0.04 |
| javascript | 1002 | 0.94 |
| python | 2872 | 0.91 |
| rust | 3609 | 0.72 |
| shell | 127 | 0.57 |
| tsx | 1143 | 0.72 |
| typescript | 5296 | 0.75 |

## Dataset sizes

```json
{
 "dev": {
  "c": {
   "ai": 13,
   "human": 349,
   "refined": 1
  },
  "cpp": {
   "human": 464
  },
  "csharp": {
   "ai": 53,
   "human": 223
  },
  "go": {
   "ai": 733,
   "human": 1346,
   "refined": 41
  },
  "java": {
   "human": 337
  },
  "javascript": {
   "ai": 836,
   "human": 600,
   "refined": 12
  },
  "php": {
   "human": 387
  },
  "python": {
   "ai": 3565,
   "human": 431,
   "refined": 261
  },
  "rust": {
   "ai": 1001,
   "human": 576,
   "refined": 35
  },
  "shell": {
   "ai": 149,
   "human": 53,
   "refined": 33
  },
  "tsx": {
   "ai": 388,
   "human": 234,
   "refined": 23
  },
  "typescript": {
   "ai": 892,
   "human": 175,
   "refined": 24
  }
 },
 "newest": {
  "c": {
   "ai": 19
  },
  "csharp": {
   "ai": 389,
   "refined": 10
  },
  "go": {
   "ai": 1586,
   "refined": 75
  },
  "java": {
   "ai": 195,
   "refined": 63
  },
  "javascript": {
   "ai": 904,
   "refined": 98
  },
  "python": {
   "ai": 2620,
   "refined": 252
  },
  "rust": {
   "ai": 3390,
   "refined": 219
  },
  "shell": {
   "ai": 120,
   "refined": 7
  },
  "tsx": {
   "ai": 1083,
   "refined": 60
  },
  "typescript": {
   "ai": 4982,
   "refined": 314
  }
 },
 "test": {
  "c": {
   "ai": 13,
   "human": 62,
   "refined": 4
  },
  "cpp": {
   "ai": 47,
   "human": 341,
   "refined": 8
  },
  "csharp": {
   "ai": 3,
   "human": 398,
   "refined": 2
  },
  "go": {
   "ai": 864,
   "human": 241,
   "refined": 27
  },
  "java": {
   "human": 376
  },
  "javascript": {
   "ai": 1109,
   "human": 778,
   "refined": 77
  },
  "php": {
   "human": 588
  },
  "python": {
   "ai": 1240,
   "human": 660,
   "refined": 70
  },
  "rust": {
   "ai": 819,
   "human": 397,
   "refined": 21
  },
  "shell": {
   "ai": 33,
   "human": 193,
   "refined": 1
  },
  "tsx": {
   "ai": 96,
   "human": 73,
   "refined": 8
  },
  "typescript": {
   "ai": 1327,
   "human": 493,
   "refined": 20
  }
 },
 "train": {
  "c": {
   "ai": 558,
   "human": 3498,
   "refined": 88
  },
  "cpp": {
   "ai": 1422,
   "human": 2449,
   "refined": 40
  },
  "csharp": {
   "ai": 3759,
   "human": 3077,
   "refined": 294
  },
  "go": {
   "ai": 3631,
   "human": 5528,
   "refined": 180
  },
  "java": {
   "ai": 231,
   "human": 2734,
   "refined": 76
  },
  "javascript": {
   "ai": 5895,
   "human": 6464,
   "refined": 237
  },
  "php": {
   "ai": 1127,
   "human": 5382,
   "refined": 34
  },
  "python": {
   "ai": 13132,
   "human": 5492,
   "refined": 643
  },
  "rust": {
   "ai": 4057,
   "human": 5380,
   "refined": 226
  },
  "shell": {
   "ai": 1332,
   "human": 1217,
   "refined": 16
  },
  "tsx": {
   "ai": 4509,
   "human": 898,
   "refined": 315
  },
  "typescript": {
   "ai": 13290,
   "human": 2777,
   "refined": 1009
  }
 }
}
```

Reproduce: `npm run build -w @athena/core && cd ml && uv run python -m athena_ml.collect_all all 20` (the published run used about 70 AI repos over several resumed runs; GitHub search results change, so rerunning will not reproduce these exact numbers) then `uv run python -m athena_ml.run_train 0.2.1`
