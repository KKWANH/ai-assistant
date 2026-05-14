"""Account domain facade.

This module is the new home for account/profile/memory operations. It delegates
to storage during the transition so existing CLI/UI imports keep working.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from aiws import storage


def create(root: str | Path, username: str, password: str, **kwargs: Any) -> dict[str, Any]:
    return storage.create_account(root, username, password, **kwargs)


def update_profile(root: str | Path, username: str, **kwargs: Any) -> dict[str, Any]:
    return storage.update_account_profile(root, username, **kwargs)


def append_memory(root: str | Path, username: str, content: str, **kwargs: Any) -> dict[str, Any]:
    return storage.append_account_memory(root, username, content, **kwargs)


def public(root: str | Path, username: str) -> dict[str, Any]:
    return storage.public_account(storage.load_account(root, username))
