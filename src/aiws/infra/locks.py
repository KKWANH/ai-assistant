"""Small cross-process file locking helpers for AIWS file storage."""

from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

try:
    import fcntl
except ImportError:  # pragma: no cover - non-POSIX fallback is best-effort.
    fcntl = None  # type: ignore[assignment]


@contextmanager
def file_lock(path: Path) -> Iterator[None]:
    """Lock a sidecar file while a storage mutation is in progress."""
    lock_path = path.with_name(path.name + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+", encoding="utf-8") as handle:
        if fcntl is not None:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            if fcntl is not None:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
