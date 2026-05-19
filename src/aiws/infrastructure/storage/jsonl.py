import json
from pathlib import Path
from typing import Any


def encode_json_line(record: dict[str, Any]) -> str:
    return json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"


def append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as file:
        file.write(encode_json_line(record))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as file:
        for line_number, line in enumerate(file, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            decoded = json.loads(stripped)
            if not isinstance(decoded, dict):
                raise ValueError(f"JSONL record at {path}:{line_number} is not an object")
            records.append(decoded)
    return records
