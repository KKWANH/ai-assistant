"""AIWS ask runner."""

from __future__ import annotations

from . import costs, search, storage
from .providers.kimi import KimiProvider
from .providers.ollama import OllamaProvider


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
    response = client.chat(model=model, system=prompt_context, content=content)
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
    return response
