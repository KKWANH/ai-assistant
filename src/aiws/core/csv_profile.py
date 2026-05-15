"""Deterministic CSV profiling and artifact generation."""

from __future__ import annotations

import csv
import json
import math
import statistics
from io import StringIO
from pathlib import Path
from typing import Any

from aiws.infra import file_store

MAX_PROFILE_ROWS = 10_000
MAX_PROFILE_COLUMNS = 200
SAMPLE_ROW_LIMIT = 10
PREVIEW_ROW_LIMIT = 25


def profile_csv_text(text: str, *, filename: str = "input.csv") -> dict[str, Any]:
    """Return a deterministic profile for CSV text without using an LLM."""
    sample = text[:8192]
    dialect = _sniff_dialect(sample)
    reader = csv.reader(StringIO(text), dialect)
    rows = list(reader)
    parser = "python-csv"
    truncated = False
    if len(rows) > MAX_PROFILE_ROWS + 1:
        rows = rows[: MAX_PROFILE_ROWS + 1]
        truncated = True
    header, data_rows = _split_header(rows)
    if len(header) > MAX_PROFILE_COLUMNS:
        header = header[:MAX_PROFILE_COLUMNS]
        data_rows = [row[:MAX_PROFILE_COLUMNS] for row in data_rows]
        truncated = True
    normalized_rows = [_normalize_row(row, len(header)) for row in data_rows]
    columns = [_column_profile(index, name, normalized_rows) for index, name in enumerate(header)]
    suspicious = _suspicious_columns(header, columns)
    return {
        "parser": parser,
        "filename": filename,
        "row_count": len(normalized_rows),
        "column_count": len(header),
        "columns": columns,
        "column_names": header,
        "missing_cells": sum(int(item["missing_count"]) for item in columns),
        "numeric_columns": [item["name"] for item in columns if item["inferred_type"] == "number"],
        "categorical_columns": [item["name"] for item in columns if item["inferred_type"] != "number"],
        "sample_rows": [_row_dict(header, row) for row in normalized_rows[:SAMPLE_ROW_LIMIT]],
        "suspicious_columns": suspicious,
        "truncated": truncated,
        "limits": {"max_rows": MAX_PROFILE_ROWS, "max_columns": MAX_PROFILE_COLUMNS},
    }


def model_context_from_profile(profile: dict[str, Any]) -> str:
    """Create the only CSV content that should be sent to an LLM."""
    compact_columns = [
        {
            "name": item.get("name"),
            "type": item.get("inferred_type"),
            "missing": item.get("missing_count"),
            "unique": item.get("unique_count"),
            "numeric": item.get("numeric_stats"),
        }
        for item in profile.get("columns", [])
    ]
    compact = {
        "parser": profile.get("parser"),
        "filename": profile.get("filename"),
        "row_count": profile.get("row_count"),
        "column_count": profile.get("column_count"),
        "missing_cells": profile.get("missing_cells"),
        "columns": compact_columns,
        "sample_rows": profile.get("sample_rows", [])[:5],
        "suspicious_columns": profile.get("suspicious_columns", []),
    }
    return (
        "CSV deterministic analysis profile follows. Summarize only these computed facts; "
        "do not invent column meanings or infer facts not present in the profile.\n\n"
        + json.dumps(compact, ensure_ascii=False, indent=2)
    )


def write_csv_artifacts(
    artifact_root: Path,
    profile: dict[str, Any],
    source_text: str,
) -> list[dict[str, Any]]:
    artifact_root.mkdir(parents=True, exist_ok=True)
    artifacts: list[dict[str, Any]] = []
    artifacts.append(_write_artifact(artifact_root / "csv-profile.json", json.dumps(profile, ensure_ascii=False, indent=2) + "\n"))
    artifacts.append(_write_artifact(artifact_root / "csv-preview.csv", preview_csv(source_text)))
    artifacts.append(_write_artifact(artifact_root / "csv-summary.md", summary_markdown(profile)))
    missing = missing_values_csv(profile)
    if missing:
        artifacts.append(_write_artifact(artifact_root / "missing-values.csv", missing))
    numeric = numeric_stats_csv(profile)
    if numeric:
        artifacts.append(_write_artifact(artifact_root / "numeric-stats.csv", numeric))
    suspicious = suspicious_markdown(profile)
    if suspicious:
        artifacts.append(_write_artifact(artifact_root / "suspicious-columns.md", suspicious))
    return artifacts


def preview_csv(source_text: str) -> str:
    rows = list(csv.reader(StringIO(source_text)))
    output = StringIO()
    writer = csv.writer(output)
    writer.writerows(rows[:PREVIEW_ROW_LIMIT])
    return output.getvalue()


def summary_markdown(profile: dict[str, Any]) -> str:
    columns = profile.get("columns", [])
    numeric = [item for item in columns if item.get("inferred_type") == "number"]
    missing = [item for item in columns if int(item.get("missing_count") or 0) > 0]
    lines = [
        "# CSV Summary",
        "",
        f"- Source: `{profile.get('filename', 'input.csv')}`",
        f"- Parser: `{profile.get('parser', 'python-csv')}`",
        f"- Rows: {profile.get('row_count', 0)}",
        f"- Columns: {profile.get('column_count', 0)}",
        f"- Missing cells: {profile.get('missing_cells', 0)}",
        f"- Numeric columns: {len(numeric)}",
        f"- Categorical columns: {max(0, len(columns) - len(numeric))}",
        "",
        "## Columns",
        "",
    ]
    for item in columns[:60]:
        lines.append(
            f"- `{item.get('name')}`: {item.get('inferred_type')} · "
            f"{item.get('missing_count')} missing · {item.get('unique_count')} unique"
        )
    if missing:
        lines.extend(["", "## Missing Values", ""])
        for item in missing[:60]:
            lines.append(f"- `{item.get('name')}`: {item.get('missing_count')}")
    if numeric:
        lines.extend(["", "## Numeric Stats", ""])
        for item in numeric[:60]:
            stats = item.get("numeric_stats") or {}
            lines.append(
                f"- `{item.get('name')}`: min {stats.get('min')}, max {stats.get('max')}, "
                f"mean {stats.get('mean')}, std {stats.get('std')}"
            )
    suspicious = profile.get("suspicious_columns") or []
    if suspicious:
        lines.extend(["", "## Warnings", ""])
        lines.extend(f"- {item}" for item in suspicious)
    return "\n".join(lines) + "\n"


def missing_values_csv(profile: dict[str, Any]) -> str:
    rows = [
        [item.get("name", ""), item.get("missing_count", 0), item.get("missing_ratio", 0)]
        for item in profile.get("columns", [])
        if int(item.get("missing_count") or 0) > 0
    ]
    if not rows:
        return ""
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["column", "missing_count", "missing_ratio"])
    writer.writerows(rows)
    return output.getvalue()


def numeric_stats_csv(profile: dict[str, Any]) -> str:
    rows = []
    for item in profile.get("columns", []):
        stats = item.get("numeric_stats")
        if not isinstance(stats, dict):
            continue
        rows.append([item.get("name", ""), stats.get("min"), stats.get("max"), stats.get("mean"), stats.get("std")])
    if not rows:
        return ""
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["column", "min", "max", "mean", "std"])
    writer.writerows(rows)
    return output.getvalue()


def suspicious_markdown(profile: dict[str, Any]) -> str:
    warnings = profile.get("suspicious_columns") or []
    if not warnings:
        return ""
    return "# Suspicious Columns\n\n" + "\n".join(f"- {item}" for item in warnings) + "\n"


def _sniff_dialect(sample: str) -> type[csv.Dialect] | csv.Dialect:
    try:
        return csv.Sniffer().sniff(sample)
    except csv.Error:
        return csv.excel


def _split_header(rows: list[list[str]]) -> tuple[list[str], list[list[str]]]:
    if not rows:
        return [], []
    first = [cell.strip() for cell in rows[0]]
    if first and any(cell for cell in first):
        return [_header_name(cell, index) for index, cell in enumerate(first)], rows[1:]
    width = max((len(row) for row in rows), default=0)
    return [f"column_{index + 1}" for index in range(width)], rows


def _header_name(value: str, index: int) -> str:
    return value.strip() or f"column_{index + 1}"


def _normalize_row(row: list[str], width: int) -> list[str]:
    return [(row[index].strip() if index < len(row) else "") for index in range(width)]


def _row_dict(header: list[str], row: list[str]) -> dict[str, str]:
    return {name: row[index] if index < len(row) else "" for index, name in enumerate(header)}


def _column_profile(index: int, name: str, rows: list[list[str]]) -> dict[str, Any]:
    values = [row[index] if index < len(row) else "" for row in rows]
    non_empty = [value for value in values if value != ""]
    numbers: list[float] = []
    numeric = bool(non_empty)
    for value in non_empty:
        try:
            numbers.append(float(value.replace(",", "")))
        except ValueError:
            numeric = False
            break
    inferred = "number" if numeric else "text"
    stats = _numeric_stats(numbers) if numeric and numbers else None
    return {
        "name": name,
        "index": index,
        "inferred_type": inferred,
        "missing_count": len(values) - len(non_empty),
        "missing_ratio": _round_ratio((len(values) - len(non_empty)) / len(values)) if values else 0,
        "unique_count": len(set(non_empty)),
        "sample_values": non_empty[:5],
        "numeric_stats": stats,
    }


def _numeric_stats(values: list[float]) -> dict[str, float | None]:
    std = statistics.pstdev(values) if len(values) > 1 else 0.0
    return {
        "min": _clean_float(min(values)),
        "max": _clean_float(max(values)),
        "mean": _clean_float(statistics.fmean(values)),
        "std": _clean_float(std),
    }


def _clean_float(value: float) -> float | None:
    if math.isnan(value) or math.isinf(value):
        return None
    return round(value, 6)


def _round_ratio(value: float) -> float:
    return round(value, 6)


def _suspicious_columns(header: list[str], columns: list[dict[str, Any]]) -> list[str]:
    warnings: list[str] = []
    lowered: dict[str, int] = {}
    for name in header:
        key = name.lower()
        lowered[key] = lowered.get(key, 0) + 1
    for name, count in lowered.items():
        if count > 1:
            warnings.append(f"Duplicate column name: {name}")
    for item in columns:
        name = str(item.get("name", "column"))
        ratio = float(item.get("missing_ratio") or 0)
        if ratio >= 0.5:
            warnings.append(f"`{name}` is at least 50% missing.")
        lowered_name = name.lower()
        if any(marker in lowered_name for marker in ("password", "secret", "token", "api_key", "apikey", "private_key")):
            warnings.append(f"`{name}` looks sensitive; keep it local unless explicitly reviewed.")
    return warnings[:20]


def _write_artifact(path: Path, content: str) -> dict[str, Any]:
    file_store.atomic_write_text(path, content)
    return {
        "path": path.name,
        "filename": path.name,
        "size": path.stat().st_size,
        "content_type": path.suffix.lstrip("."),
    }
