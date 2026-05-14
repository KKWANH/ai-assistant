"""Request context and permission guards for HTTP-facing code."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from aiws import storage


ProjectAccessMode = Literal["read", "write", "owner"]


@dataclass(frozen=True)
class RequestContext:
    root: str
    user: str | None
    require_auth: bool


def require_auth(ctx: RequestContext) -> None:
    if ctx.require_auth and not ctx.user:
        raise storage.WorkspaceError("Authentication required.")


def require_admin(ctx: RequestContext) -> None:
    if storage.has_accounts(ctx.root) and not storage.is_admin(ctx.root, ctx.user):
        raise storage.WorkspaceError("Admin access is required.")


def require_project_access(ctx: RequestContext, project_path: str, mode: ProjectAccessMode = "read") -> None:
    if not storage.has_accounts(ctx.root):
        return
    if mode == "owner":
        storage.ensure_project_owner(ctx.root, project_path, ctx.user)
        return
    storage.ensure_project_access(ctx.root, project_path, ctx.user)
    if mode == "write":
        project = storage.load_project(ctx.root, project_path)
        username = storage.slugify(ctx.user) if ctx.user else ""
        if project.get("owner") and project.get("owner") != username and not storage.is_admin(ctx.root, ctx.user):
            raise storage.WorkspaceError("Write access requires project owner or admin.")
