"""AIWS ask runner."""

from __future__ import annotations

from . import costs, search, storage
from .providers.kimi import KimiProvider
from .providers.ollama import OllamaProvider


MEMORY_MARKERS = (
    "나는",
    "내 ",
    "제가",
    "저는",
    "우리",
    "원해",
    "좋아",
    "싫어",
    "기억",
    "prefer",
    "i like",
    "i want",
    "my ",
    "remember",
)


def get_provider(provider: str):
    if provider == "ollama":
        return OllamaProvider()
    if provider == "kimi":
        return KimiProvider()
    raise storage.WorkspaceError(f"Unsupported provider: {provider}")


def ask(
    root: str,
    project_path: str,
    session_slug: str,
    *,
    provider: str,
    model: str,
    content: str,
    actor: str | None = None,
    search_mode: str = "off",
    search_results: list[search.SearchResult] | None = None,
    user_metadata: dict[str, object] | None = None,
    stored_content: str | None = None,
    provider_attachments: list[dict[str, str]] | None = None,
) -> str:
    account_context = storage.account_context(root, actor)
    resolved_results = search_results or []
    if search.should_search(search_mode, content) and not resolved_results:
        resolved_results = []
    prompt_context = (
        account_context
        + search.format_search_context(resolved_results)
        + storage.build_prompt_context(root, project_path, session_slug)
    )
    client = get_provider(provider)
    cost = costs.estimate_cost(provider, model, costs.rough_token_count(prompt_context + content))
    storage.append_message(
        root,
        project_path,
        session_slug,
        role="user",
        content=stored_content if stored_content is not None else content,
        metadata=user_metadata,
        actor=actor,
    )
    response = client.chat(model=model, system=prompt_context, content=content, attachments=provider_attachments)
    assistant_metadata = {"cost": cost, "search": search.results_metadata(search_mode, resolved_results)}
    storage.append_message(
        root,
        project_path,
        session_slug,
        role="assistant",
        content=response,
        provider=provider,
        model=model,
        metadata=assistant_metadata,
        actor=actor,
    )
    storage.record_usage(root, actor, asks=1)
    maybe_update_account_memory(root, actor, stored_content if stored_content is not None else content, project_path, session_slug)
    return response


def maybe_update_account_memory(
    root: str,
    actor: str | None,
    content: str,
    project_path: str,
    session_slug: str,
) -> None:
    if not actor:
        return
    summary = summarize_for_memory(content)
    if not summary:
        return
    try:
        storage.append_account_memory(
            root,
            actor,
            f"Recent chat in {project_path}/{session_slug}: {summary}",
            source="auto",
            metadata={"project_path": project_path, "session_slug": session_slug},
        )
    except storage.WorkspaceError:
        return


def summarize_for_memory(content: str) -> str:
    text = " ".join(content.replace("\n", " ").split())
    if not text:
        return ""
    lowered = text.lower()
    if not any(marker in lowered or marker in text for marker in MEMORY_MARKERS):
        return text[:140] if len(text) >= 20 else ""
    return text[:220]
