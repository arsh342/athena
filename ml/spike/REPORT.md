# Phase 4 spike: teacher check (2026-11-21)

**Result: DroidDetect-Base cannot be the distillation teacher for Athena's units. No-go on the plan as written.**

Teacher rebuilt from the README (ModernBERT-base + mean pool + Linear 768->256 + ReLU + Linear 256->4; the weights say projection dim 256 though config.json says 128). Weights load with no missing/unexpected keys.

| Test | Data | Result |
|---|---|---|
| Reconstruction check | 317 rows of DroidCollection `test` (its own domain) | AUC 1.000, 99.1% accuracy |
| Transfer to Athena units | 1,000 human + 1,000 AI function-level units from our commit/pre-2021 corpus | AUC 0.39 (inverted 0.61); F1 0.17 at the 0.5 threshold, FPR 20% |

So the loader is right and the model is right; it was trained on whole-solution generations (competition/persona prompts) and does not recognise AI-written functions found in real repositories. Distilling it would teach the student its blind spot, and "cascade F1 >= DroidDetect-Base on shared languages" would be meaningless.

Cost of the teacher on this Mac (MPS): ~33 ms/unit, so labelling is not the problem; transfer is.

## Options
1. **Train the small student directly on our hard labels** (git-recorded AI commits vs. pre-2021 human code, 143k units), optionally initialised from the teacher's first six layers. No teacher signal; the loss is plain cross-entropy. Gate is the same per-language release gate as the fast detector.
2. Skip the neural tier; keep the fast detector (JS/TS) and improve it.
3. Use DroidDetect-Base as an optional "large" tier only for whole-file/solution-style code (not recommended: it fails on our units).

Reproduce: `ml/spike/teacher_check.py`, `teacher_diag.py`, `teacher_on_droid.py` (`uv sync --group neural`).

# Update: student trained directly on our labels (option 1)

28M-parameter student (6 layers, hidden 384), plain cross-entropy on 143k hard-labelled units, no teacher. Thresholds tuned on dev (human FPR <= 5%) and applied unchanged to test (`athena_ml/eval_student.py`).

| Language | AUC | F1 | Human FPR | Gate (FPR<=5%, F1>=0.85) |
|---|---|---|---|---|
| javascript | 0.982 | 0.92 | 2.3% | pass |
| tsx | 0.952 | 0.84 | 2.7% | F1 just short |
| go | 0.924 | 0.84 | 5.4% | just short |
| typescript | 0.952 | 0.89 | 9.5% | fails FPR |
| python | 0.948 | 0.91 | 11.4% | fails FPR |
| rust | 0.714 | 0.53 | 3.8% | fails |
| c | 0.924 | 0.72 | 4.8% | fails |

Findings: 3 epochs overfit (loss 0.006, saturated probabilities) and test AUC equals the 1-epoch pilot; dev-tuned thresholds do not carry to test repos for Python/TypeScript (repo-level shift, same failure as the fast model's Python). Only JavaScript passes, and the fast detector already ships JS/TS. **Decision (2026-11-21): neural tier parked; no ONNX export, tokenizer, cascade or `athena models`.**

If revisited: more varied human repos (thin "late" sets for C/C++/C#/Java), repo-grouped regularisation, one epoch, calibrate on logits.
