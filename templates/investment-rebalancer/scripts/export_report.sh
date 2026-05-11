#!/usr/bin/env sh
set -eu

mkdir -p artifacts
{
  echo "# Rebalance Report"
  echo
  echo "Generated at: $(date -u)"
  echo
  echo "## Strategy"
  cat files/strategy.example.md
  echo
  echo "## Rebalance Table"
  if [ -f artifacts/rebalance-table.csv ]; then
    cat artifacts/rebalance-table.csv
  else
    echo "No rebalance table yet. Run rebalance_plan first."
  fi
} > artifacts/rebalance-report.md

echo "Wrote artifacts/rebalance-report.md"
