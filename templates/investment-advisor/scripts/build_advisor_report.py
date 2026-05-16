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


def main() -> int:
    if len(sys.argv) != 6:
        print("usage: build_advisor_report.py portfolio.csv interests.md rebalance.csv market.json output.md", file=sys.stderr)
        return 2
    portfolio_path = Path(sys.argv[1])
    interests_path = Path(sys.argv[2])
    rebalance_path = Path(sys.argv[3])
    market_path = Path(sys.argv[4])
    output_path = Path(sys.argv[5])
    portfolio = read_csv(portfolio_path)
    rebalance = read_csv(rebalance_path)
    interests = interests_path.read_text(encoding="utf-8") if interests_path.exists() else ""
    market = json.loads(market_path.read_text(encoding="utf-8")) if market_path.exists() else {"symbols": []}

    lines = [
        "# Investment Advisor Report",
        "",
        "> Educational research scaffold only. This is not financial advice.",
        "",
        "## Inputs",
        "",
        f"- Holdings rows: {len(portfolio)}",
        f"- Market snapshots: {len(market.get('symbols', []))}",
        "",
        "## Rebalance Deltas",
        "",
        "| Asset class | Current % | Target % | Delta value |",
        "| --- | ---: | ---: | ---: |",
    ]
    for row in rebalance:
        lines.append(f"| {row.get('asset_class', '')} | {row.get('current_pct', '')} | {row.get('target_pct', '')} | {row.get('delta_value', '')} |")
    lines.extend(["", "## Market Snapshot", ""])
    for item in market.get("symbols", []):
        if item.get("ok"):
            lines.append(f"- {item.get('symbol')}: {item.get('regular_market_price')} {item.get('currency')} on {item.get('exchange')}")
        else:
            lines.append(f"- {item.get('symbol')}: unavailable ({item.get('error')})")
    lines.extend(["", "## Research Direction", "", interests.strip() or "No investment interests file was provided."])
    lines.extend(
        [
            "",
            "## Next Checks",
            "",
            "- Verify market data source and timestamps.",
            "- Review concentration by account, asset class, and single symbol.",
            "- For target-price scenarios, state assumptions and downside cases before any decision.",
        ]
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
