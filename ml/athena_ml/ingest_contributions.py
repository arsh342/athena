"""
Turn an export of the collection server's table into weighted records for the release pipeline.

  python -m athena_ml.ingest_contributions export.jsonl out.jsonl

`export.jsonl`: one JSON object per line, {"record": <contribution>, "received_at": "<iso>"} (for example from
`SELECT record, received_at FROM learning_contributions`). The output has the surviving records with a `weight`, and a summary of what was dropped is printed.
Records that do not match the contribution schema are discarded first: the server already refuses them, this is a second wall.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from .defences import apply_defences

ALLOWED = {"label", "labelSource", "language", "sizeBucket", "style", "probabilities", "modelVersions", "tuned", "installId", "cliVersion"}


def schema_ok(rec: object) -> bool:
    if not isinstance(rec, dict) or set(rec) != ALLOWED:
        return False
    return (rec["label"] in ("ai", "human") and isinstance(rec["style"], list) and 0 < len(rec["style"]) <= 64
            and all(isinstance(v, (int, float)) for v in rec["style"])
            and isinstance(rec["probabilities"], dict) and isinstance(rec["probabilities"].get("ai"), (int, float))
            and isinstance(rec["installId"], str) and isinstance(rec["language"], str))


def main(argv: list[str]) -> None:
    src, dst = Path(argv[0]), Path(argv[1])
    rows: list[dict] = []
    invalid = 0
    for line in src.read_text().splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            invalid += 1
            continue
        if schema_ok(row.get("record")):
            rows.append(row)
        else:
            invalid += 1
    result = apply_defences(rows)
    dst.write_text("".join(json.dumps(r) + "\n" for r in result.records))
    print(f"read {len(rows) + invalid}: {invalid} invalid, kept {len(result.records)}")
    for reason, n in result.dropped.items():
        print(f"  dropped {n}: {reason}")


if __name__ == "__main__":
    main(sys.argv[1:])
