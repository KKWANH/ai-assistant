import json
import os
import tempfile
from pathlib import Path
from typing import Any

from aiws.infrastructure.storage.jsonl import append_jsonl as append_jsonl_record
from aiws.infrastructure.storage.jsonl import read_jsonl as read_jsonl_records
from aiws.infrastructure.storage.locks import exclusive_file_lock


class JsonFileStore:
    """Small filesystem adapter for human-readable JSON and JSONL records."""

    def read_json(self, path: Path) -> dict[str, Any]:
        with path.open("r", encoding="utf-8") as file:
            decoded = json.load(file)
        if not isinstance(decoded, dict):
            raise ValueError(f"JSON document at {path} is not an object")
        return decoded

    def write_json(self, path: Path, data: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        lock_path = path.with_suffix(path.suffix + ".lock")
        with exclusive_file_lock(lock_path):
            self._atomic_write_text(
                path,
                json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            )

    def append_jsonl(self, path: Path, record: dict[str, Any]) -> None:
        lock_path = path.with_suffix(path.suffix + ".lock")
        with exclusive_file_lock(lock_path):
            append_jsonl_record(path, record)

    def read_jsonl(self, path: Path) -> list[dict[str, Any]]:
        return read_jsonl_records(path)

    def _atomic_write_text(self, path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(
            prefix=f".{path.name}.",
            suffix=".tmp",
            dir=path.parent,
            text=True,
        )
        tmp_path = Path(tmp_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as tmp_file:
                tmp_file.write(content)
                tmp_file.flush()
                os.fsync(tmp_file.fileno())
            tmp_path.replace(path)
        finally:
            if tmp_path.exists():
                tmp_path.unlink()
