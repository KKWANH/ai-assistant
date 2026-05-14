"""Atomic file persistence primitives for the file-based workspace."""

from __future__ import annotations

import json
import os
import secrets
from pathlib import Path
from typing import Any, Callable

from .locks import file_lock


def atomic_write_text(path: Path, content: str, *, encoding: str = "utf-8") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp")
    tmp.write_text(content, encoding=encoding)
    os.replace(tmp, path)


def atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    atomic_write_text(path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False) + "\n"
    with file_lock(path):
        with path.open("a", encoding="utf-8") as handle:
            handle.write(line)
            handle.flush()
            os.fsync(handle.fileno())


def locked_json_update(path: Path, default: dict[str, Any], mutator: Callable[[dict[str, Any]], Any]) -> Any:
    path.parent.mkdir(parents=True, exist_ok=True)
    with file_lock(path):
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
        else:
            data = dict(default)
        result = mutator(data)
        atomic_write_json(path, data)
        return result
