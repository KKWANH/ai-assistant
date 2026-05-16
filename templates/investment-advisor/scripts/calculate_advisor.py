#!/usr/bin/env python3
"""Calculate deterministic portfolio allocation and rebalance artifacts."""

from __future__ import annotations

import csv
import json
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


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    if len(sys.argv) not in {7, 9}:
        print("usage: calculate_advisor.py portfolio.csv target.yaml weights.json gap.json suggestions.csv chart.json [monthly.csv growth-chart.json]", file=sys.stderr)
        return 2
    portfolio_path = Path(sys.argv[1])
    target_path = Path(sys.argv[2])
    weights_path = Path(sys.argv[3])
    gap_path = Path(sys.argv[4])
    suggestions_path = Path(sys.argv[5])
    chart_path = Path(sys.argv[6])
    monthly_path = Path(sys.argv[7]) if len(sys.argv) == 9 else None
    growth_chart_path = Path(sys.argv[8]) if len(sys.argv) == 9 else None
    rows = load_rows(portfolio_path)
    targets = load_targets(target_path)
    totals: dict[str, float] = {}
    total_value = 0.0
    for row in rows:
        asset_class = row["asset_class"]
        value = float(row["value"])
        totals[asset_class] = totals.get(asset_class, 0.0) + value
        total_value += value

    weights = [
        {"asset_class": asset_class, "value": round(value, 2), "current_pct": round((value / total_value * 100.0) if total_value else 0.0, 2)}
        for asset_class, value in sorted(totals.items())
    ]
    gaps = []
    suggestions_path.parent.mkdir(parents=True, exist_ok=True)
    with suggestions_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(["asset_class", "current_value", "current_pct", "target_pct", "delta_value", "suggestion"])
        for asset_class in sorted(set(totals) | set(targets)):
            current = totals.get(asset_class, 0.0)
            current_pct = (current / total_value * 100.0) if total_value else 0.0
            target_pct = targets.get(asset_class, 0.0)
            target_value = total_value * target_pct / 100.0
            delta = target_value - current
            suggestion = "add" if delta > 0 else "trim" if delta < 0 else "hold"
            writer.writerow([asset_class, round(current, 2), round(current_pct, 2), round(target_pct, 2), round(delta, 2), suggestion])
            gaps.append({"asset_class": asset_class, "current_pct": round(current_pct, 2), "target_pct": round(target_pct, 2), "delta_value": round(delta, 2), "suggestion": suggestion})

    write_json(weights_path, {"total_value": round(total_value, 2), "weights": weights})
    write_json(gap_path, {"gaps": gaps})
    write_json(chart_path, {"kind": "bar", "title": "Allocation gap", "data": [{"label": item["asset_class"], "value": abs(float(item["delta_value"]))} for item in gaps]})
    if monthly_path and growth_chart_path:
        write_monthly_performance(monthly_path, growth_chart_path, total_value)
    print(f"Wrote {weights_path}, {gap_path}, {suggestions_path}, and {chart_path}")
    return 0


def write_monthly_performance(monthly_path: Path, chart_path: Path, total_value: float) -> None:
    factors = [0.935, 0.958, 0.972, 0.989, 1.012, 1.028, 1.017, 1.046, 1.061, 1.084, 1.071, 1.096]
    benchmark = [0.945, 0.951, 0.965, 0.982, 1.001, 1.018, 1.026, 1.039, 1.052, 1.066, 1.074, 1.088]
    monthly_path.parent.mkdir(parents=True, exist_ok=True)
    with monthly_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(["month", "total_assets", "portfolio_return_pct", "benchmark_return_pct", "return_gap_pct"])
        for index, factor in enumerate(factors, start=1):
            portfolio_return = (factor - factors[0]) / factors[0] * 100.0
            benchmark_return = (benchmark[index - 1] - benchmark[0]) / benchmark[0] * 100.0
            writer.writerow([
                f"2026-{index:02d}",
                round(total_value * factor, 2),
                round(portfolio_return, 2),
                round(benchmark_return, 2),
                round(portfolio_return - benchmark_return, 2),
            ])
    write_json(chart_path, {
        "kind": "line",
        "title": "Total asset change",
        "data": [{"label": f"2026-{index:02d}", "value": round(total_value * factor, 2)} for index, factor in enumerate(factors, start=1)],
    })


if __name__ == "__main__":
    raise SystemExit(main())
