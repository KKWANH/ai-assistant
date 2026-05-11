#!/usr/bin/env python3
"""Calculate a simple target/current allocation delta."""

from __future__ import annotations

import csv
import sys
from pathlib import Path


def load_targets(path: Path) -> dict[str, float]:
    targets: dict[str, float] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        targets[key.strip()] = float(value.strip())
    return targets


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: calculate_rebalance.py portfolio.csv target.yaml output.csv", file=sys.stderr)
        return 2
    portfolio_path = Path(sys.argv[1])
    target_path = Path(sys.argv[2])
    output_path = Path(sys.argv[3])
    totals: dict[str, float] = {}
    total_value = 0.0
    with portfolio_path.open(newline="", encoding="utf-8") as file:
        for row in csv.DictReader(file):
            asset_class = row["asset_class"]
            value = float(row["value"])
            totals[asset_class] = totals.get(asset_class, 0.0) + value
            total_value += value
    targets = load_targets(target_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(["asset_class", "current_value", "current_pct", "target_pct", "delta_value"])
        for asset_class in sorted(set(totals) | set(targets)):
            current = totals.get(asset_class, 0.0)
            current_pct = (current / total_value * 100.0) if total_value else 0.0
            target_pct = targets.get(asset_class, 0.0)
            target_value = total_value * target_pct / 100.0
            writer.writerow([asset_class, round(current, 2), round(current_pct, 2), round(target_pct, 2), round(target_value - current, 2)])
    print(f"Wrote {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
