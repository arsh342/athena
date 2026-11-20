# athena-detect-fast 0.2.0 — Athena-Bench results

Trained 2026-11-20T08:31:56.795077+00:00. Human = permissively licensed repos checked out before 2021-06; AI = units whose lines git blame credits to AI-assisted commits (>= 95% recorded) from 2025 onward; refined = units with 30-80% of their lines blamed on AI commits. Splits are by repository; refined units are excluded from the binary metrics. The `adversarial` class is not present: no real-world source for it was found without generating data locally.

**Read these numbers with three caveats.** (1) *Era:* the first human pool is code from before 2021-06 and the AI code is from 2025 onward, so a classifier can score well by recognising newer syntax (optional chaining, type annotations, f-strings) and small-project style rather than authorship. A second human pool (code as of 2022-06-21, Copilot's general release) narrows the gap and feeds an **era-robustness check**: a language is enabled only if its human false-positive rate on 2022-era human test units is also <= 5%. Neither pool can show that code written today by a human is classified as human; no verified-human recent code exists to test with. (2) *Few repositories:* each language's test split has only a handful of distinct repositories, so figures are noisy; the release gate therefore also requires at least 5 distinct repositories per class. (3) *Contamination:* 2022-era human code may include a little Copilot-preview-assisted code.

Release targets per language (test split): human false-positive rate <= 5% and F1 >= 0.85. A language that misses them, or has too little data, is **disabled**: Athena then uses the labelled style heuristic for it.

| Language | Enabled | Threshold | Test human units | Test AI units | Precision | Recall | F1 | Human FPR | 2022-era human FPR | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| c | no | 0.50 | 62 | 0 | 0.00 | 0.00 | 0.00 | 3.2% | n/a (n=0) | too little test data (62 human / 0 ai) |
| cpp | no | 0.50 | 341 | 1 | 0.06 | 1.00 | 0.11 | 4.7% | n/a (n=0) | too little test data (341 human / 1 ai) |
| csharp | no | 0.70 | 398 | 3 | 0.00 | 0.00 | 0.00 | 1.5% | n/a (n=0) | too little test data (398 human / 3 ai) |
| go | no | 0.50 | 241 | 495 | 1.00 | 0.58 | 0.74 | 0.4% | 0.0% (n=42) | too few distinct repositories in the test split (2 human / 2 ai, need 5 each) |
| java | no | 0.50 | 376 | 0 | 0.00 | 0.00 | 0.00 | 0.0% | n/a (n=0) | too little test data (376 human / 0 ai) |
| javascript | yes | 0.56 | 778 | 931 | 0.97 | 0.90 | 0.93 | 3.2% | 4.8% (n=400) | meets release targets |
| php | no | 0.50 | 588 | 0 | 0.00 | 0.00 | 0.00 | 0.0% | 0.0% (n=200) | too little test data (588 human / 0 ai) |
| python | no | 0.61 | 660 | 588 | 0.86 | 0.95 | 0.90 | 14.2% | 1.4% (n=140) | too few distinct repositories in the test split (7 human / 4 ai, need 5 each) |
| rust | no | 0.59 | 397 | 472 | 0.97 | 0.60 | 0.74 | 2.5% | 1.5% (n=199) | too few distinct repositories in the test split (2 human / 3 ai, need 5 each) |
| shell | no | 0.50 | 193 | 31 | 0.71 | 0.77 | 0.74 | 5.2% | 3.9% (n=76) | too few distinct repositories in the test split (3 human / 3 ai, need 5 each) |
| tsx | no | 0.72 | 73 | 60 | 0.88 | 0.77 | 0.82 | 8.2% | 8.7% (n=69) | too few distinct repositories in the test split (2 human / 2 ai, need 5 each) |
| typescript | no | 0.65 | 493 | 683 | 0.94 | 0.83 | 0.88 | 7.3% | 7.9% (n=329) | too few distinct repositories in the test split (5 human / 3 ai, need 5 each) |

## Newest split (the most recent 20% of AI repos by commit date, held out of training)

| Language | Units | AI recall |
|---|---|---|
| c | 228 | 0.08 |
| cpp | 57 | 0.28 |
| csharp | 1208 | 0.70 |
| go | 1062 | 0.61 |
| java | 251 | 0.08 |
| javascript | 1589 | 0.90 |
| python | 2339 | 0.89 |
| rust | 1210 | 0.64 |
| shell | 84 | 0.44 |
| tsx | 490 | 0.78 |
| typescript | 1817 | 0.78 |

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
   "ai": 55,
   "human": 600,
   "refined": 4
  },
  "php": {
   "human": 387
  },
  "python": {
   "ai": 3244,
   "human": 431,
   "refined": 255
  },
  "rust": {
   "ai": 400,
   "human": 576,
   "refined": 1
  },
  "shell": {
   "ai": 149,
   "human": 53,
   "refined": 33
  },
  "tsx": {
   "ai": 282,
   "human": 234,
   "refined": 10
  },
  "typescript": {
   "ai": 813,
   "human": 175,
   "refined": 22
  }
 },
 "newest": {
  "c": {
   "ai": 161,
   "refined": 67
  },
  "cpp": {
   "ai": 56,
   "refined": 1
  },
  "csharp": {
   "ai": 1193,
   "refined": 15
  },
  "go": {
   "ai": 1023,
   "refined": 39
  },
  "java": {
   "ai": 193,
   "refined": 58
  },
  "javascript": {
   "ai": 1581,
   "refined": 8
  },
  "python": {
   "ai": 2158,
   "refined": 181
  },
  "rust": {
   "ai": 1042,
   "refined": 168
  },
  "shell": {
   "ai": 76,
   "refined": 8
  },
  "tsx": {
   "ai": 460,
   "refined": 30
  },
  "typescript": {
   "ai": 1612,
   "refined": 205
  }
 },
 "test": {
  "c": {
   "human": 62
  },
  "cpp": {
   "ai": 1,
   "human": 341
  },
  "csharp": {
   "ai": 3,
   "human": 398,
   "refined": 2
  },
  "go": {
   "ai": 495,
   "human": 241
  },
  "java": {
   "human": 376
  },
  "javascript": {
   "ai": 931,
   "human": 778,
   "refined": 77
  },
  "php": {
   "human": 588
  },
  "python": {
   "ai": 588,
   "human": 660,
   "refined": 2
  },
  "rust": {
   "ai": 472,
   "human": 397,
   "refined": 21
  },
  "shell": {
   "ai": 31,
   "human": 193,
   "refined": 1
  },
  "tsx": {
   "ai": 60,
   "human": 73,
   "refined": 8
  },
  "typescript": {
   "ai": 683,
   "human": 493,
   "refined": 16
  }
 },
 "train": {
  "c": {
   "ai": 312,
   "human": 3498,
   "refined": 21
  },
  "cpp": {
   "ai": 1199,
   "human": 2449,
   "refined": 39
  },
  "csharp": {
   "ai": 2078,
   "human": 3077,
   "refined": 271
  },
  "go": {
   "ai": 1957,
   "human": 5528,
   "refined": 84
  },
  "java": {
   "ai": 25,
   "human": 2734,
   "refined": 7
  },
  "javascript": {
   "ai": 3712,
   "human": 6464,
   "refined": 175
  },
  "php": {
   "ai": 1127,
   "human": 5382,
   "refined": 34
  },
  "python": {
   "ai": 9309,
   "human": 5492,
   "refined": 437
  },
  "rust": {
   "ai": 2267,
   "human": 5380,
   "refined": 82
  },
  "shell": {
   "ai": 1043,
   "human": 1217,
   "refined": 14
  },
  "tsx": {
   "ai": 2278,
   "human": 898,
   "refined": 109
  },
  "typescript": {
   "ai": 7077,
   "human": 2777,
   "refined": 385
  }
 }
}
```

Reproduce: `npm run build -w @athena/core && cd ml && uv run python -m athena_ml.collect_all all 20` (the published run used about 70 AI repos over several resumed runs; GitHub search results change, so rerunning will not reproduce these exact numbers) then `uv run python -m athena_ml.run_train 0.2.0`
