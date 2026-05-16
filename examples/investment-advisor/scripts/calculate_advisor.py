#!/usr/bin/env python3
"""Calculate deterministic portfolio allocation and target-price scenarios."""

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


def load_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as file:
        return list(csv.DictReader(file))


def main() -> int:
    if len(sys.argv) != 5:
        print("usage: calculate_advisor.py portfolio.csv target.yaml rebalance.csv scenarios.csv", file=sys.stderr)
        return 2
    portfolio_path = Path(sys.argv[1])
    target_path = Path(sys.argv[2])
    rebalance_path = Path(sys.argv[3])
    scenarios_path = Path(sys.argv[4])
    rows = load_rows(portfolio_path)
    targets = load_targets(target_path)
    totals: dict[str, float] = {}
    total_value = 0.0
    for row in rows:
        asset_class = row["asset_class"]
        value = float(row["value"])
        totals[asset_class] = totals.get(asset_class, 0.0) + value
        total_value += value

    rebalance_path.parent.mkdir(parents=True, exist_ok=True)
    with rebalance_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(["asset_class", "current_value", "current_pct", "target_pct", "delta_value"])
        for asset_class in sorted(set(totals) | set(targets)):
            current = totals.get(asset_class, 0.0)
            current_pct = (current / total_value * 100.0) if total_value else 0.0
            target_pct = targets.get(asset_class, 0.0)
            target_value = total_value * target_pct / 100.0
            writer.writerow([asset_class, round(current, 2), round(current_pct, 2), round(target_pct, 2), round(target_value - current, 2)])

    with scenarios_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(["symbol", "name", "current_value", "target_price", "scenario_note"])
        for row in rows:
            value = float(row.get("value") or 0)
            target_price = row.get("target_price", "")
            note = "target price supplied by user; verify independently" if target_price else "no target price supplied"
            writer.writerow([row.get("symbol", ""), row.get("name", ""), round(value, 2), target_price, note])

    print(f"Wrote {rebalance_path} and {scenarios_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
