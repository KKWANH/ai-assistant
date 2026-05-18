"""Context policy planning for model turns."""

from __future__ import annotations

from dataclasses import asdict, dataclass

from . import context_receipts


@dataclass(frozen=True)
class ContextPlan:
    mode: str
    include_project_files: bool
    active_attachment_filenames: set[str] | None
    retrieval_enabled: bool
    reason: str

    def as_dict(self) -> dict[str, object]:
        value = asdict(self)
        filenames = self.active_attachment_filenames
        value["active_attachment_filenames"] = sorted(filenames) if filenames else []
        return value


def plan_context(content: str, *, active_files: set[str]) -> ContextPlan:
    """Choose the smallest useful context scope for this turn.

    Default chat should be retrieval-first. Prior project attachments are only
    copied into the prompt when the user explicitly asks for previous/all files.
    """
    if context_receipts.requests_prior_files(content):
        return ContextPlan(
            mode="full_project_context",
            include_project_files=True,
            active_attachment_filenames=None,
            retrieval_enabled=True,
            reason="explicit full or previous file request",
        )
    if active_files:
        return ContextPlan(
            mode="current_attachment",
            include_project_files=False,
            active_attachment_filenames=set(active_files),
            retrieval_enabled=True,
            reason="current attachments plus retrieval",
        )
    return ContextPlan(
        mode="retrieval_first",
        include_project_files=False,
        active_attachment_filenames=set(),
        retrieval_enabled=True,
        reason="default project retrieval without prior attachment dump",
    )
