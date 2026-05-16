#!/usr/bin/env python3
"""Build an educational investment advisor report from local artifacts."""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as file:
        return list(csv.DictReader(file))


def read_json(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    if len(sys.argv) != 6:
        print("usage: build_advisor_report.py weights.json gap.json suggestions.csv interests.md output.md", file=sys.stderr)
        return 2
    weights_path = Path(sys.argv[1])
    gap_path = Path(sys.argv[2])
    suggestions_path = Path(sys.argv[3])
    interests_path = Path(sys.argv[4])
    output_path = Path(sys.argv[5])
    weights = read_json(weights_path)
    gaps = read_json(gap_path)
    suggestions = read_csv(suggestions_path)
    interests = interests_path.read_text(encoding="utf-8") if interests_path.exists() else ""

    lines = [
        "# Investment Rebalance Report",
        "",
        "> Educational research scaffold only. This is not financial advice.",
        "",
        "## Portfolio Snapshot",
        "",
        f"- Total value: {weights.get('total_value', 0)}",
        f"- Asset classes: {len(weights.get('weights', [])) if isinstance(weights.get('weights'), list) else 0}",
        "",
        "## Rebalance Suggestions",
        "",
        "| Asset class | Current % | Target % | Delta value | Suggestion |",
        "| --- | ---: | ---: | ---: | --- |",
    ]
    for row in suggestions:
        lines.append(f"| {row.get('asset_class', '')} | {row.get('current_pct', '')} | {row.get('target_pct', '')} | {row.get('delta_value', '')} | {row.get('suggestion', '')} |")
    lines.extend(["", "## Gap JSON Summary", "", "```json", json.dumps(gaps, indent=2, ensure_ascii=False), "```"])
    lines.extend(["", "## Research Direction", "", interests.strip() or "No investment interests file was provided."])
    lines.extend(["", "## Next Checks", "", "- Verify target allocation assumptions.", "- Review concentration by account, asset class, and single symbol.", "- Use external market research only after approving network access."])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
