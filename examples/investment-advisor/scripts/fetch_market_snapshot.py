#!/usr/bin/env python3
"""Fetch public quote snapshots for watchlist symbols.

The script uses Yahoo's public chart endpoint as a lightweight demo source.
Operators should verify licensing and data quality before relying on it.
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path
from urllib import parse, request


def fetch_symbol(symbol: str) -> dict[str, object]:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{parse.quote(symbol)}?range=5d&interval=1d"
    try:
        with request.urlopen(url, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        return {"symbol": symbol, "ok": False, "error": f"{type(exc).__name__}: {exc}"}
    result = ((payload.get("chart") or {}).get("result") or [{}])[0]
    meta = result.get("meta") or {}
    return {
        "symbol": symbol,
        "ok": True,
        "currency": meta.get("currency", ""),
        "exchange": meta.get("exchangeName", ""),
        "regular_market_price": meta.get("regularMarketPrice"),
        "previous_close": meta.get("chartPreviousClose"),
        "data_source": "Yahoo chart public endpoint",
    }


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: fetch_market_snapshot.py watchlist.csv output.json", file=sys.stderr)
        return 2
    watchlist_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    with watchlist_path.open(newline="", encoding="utf-8") as file:
        rows = list(csv.DictReader(file))
    symbols = [str(row.get("symbol", "")).strip().upper() for row in rows if str(row.get("symbol", "")).strip()]
    snapshots = [fetch_symbol(symbol) for symbol in symbols]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps({"symbols": snapshots}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
