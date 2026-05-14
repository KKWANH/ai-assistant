"""AIWS ask runner."""

from __future__ import annotations

import os
from datetime import datetime
from typing import Literal

from . import costs, search, storage
from .core import context_manifest, context_receipts
from .env import load_env
from .providers.gemini import GeminiProvider
from .providers.kimi import KimiProvider
from .providers.ollama import OllamaProvider
from .providers.openai import OpenAIProvider
from .providers.ernie import ErnieProvider


REMOTE_PROVIDERS = {"kimi", "gemini", "openai", "ernie"}


MemoryPolicy = Literal["off", "explicit_only", "suggest", "auto"]


EXPLICIT_MEMORY_MARKERS = (
    "기억해줘",
    "기억해 줘",
    "기억해",
    "앞으로",
    "remember",
    "remember this",
    "please remember",
    "from now on",
)


def get_provider(provider: str):
    if provider == "ollama":
        return OllamaProvider()
    if provider == "kimi":
        return KimiProvider()
    if provider == "gemini":
        return GeminiProvider()
    if provider == "openai":
        return OpenAIProvider()
    if provider == "ernie":
        return ErnieProvider()
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
    allow_remote: bool = False,
    allow_network: bool = False,
    confirm_cost: bool = False,
    execution_plan: dict[str, object] | None = None,
) -> str:
    load_env()
    provider = provider or os.environ.get("AIWS_DEFAULT_PROVIDER", "ollama")
    model = model or default_model_for_provider(provider)
    account_context = storage.account_context(root, actor)
    resolved_results = search_results or []
    if search.should_search(search_mode, content) and not resolved_results:
        if not allow_network:
            raise storage.WorkspaceError("Web search requires explicit network approval.")
        resolved_results = search.web_search(content)
    active_files = context_receipts.current_attachment_filenames(user_metadata)
    include_prior_files = context_receipts.should_include_prior_files(content, has_current_file=bool(active_files))
    prompt_context = (
        server_time_context()
        + account_context
        + search.format_search_context(resolved_results)
        + storage.build_prompt_context(
            root,
            project_path,
            session_slug,
            active_attachment_filenames=(active_files or None) if not include_prior_files else None,
            include_project_files=include_prior_files,
        )
    )
    network_used = bool(resolved_results)
    manifest = write_used_context(
        root,
        project_path,
        session_slug,
        prompt_context,
        actor,
        provider,
        model,
        search_mode,
        network_used=network_used,
        search_queries=[content] if network_used else [],
    )
    input_tokens = costs.rough_token_count(prompt_context + content)
    max_output_tokens = int(os.environ.get("AIWS_MAX_OUTPUT_TOKENS", "1024"))
    estimated = costs.estimate_cost(provider, model, input_tokens, max_output_tokens)
    enforce_remote_guardrails(root, actor, provider, estimated, allow_remote=allow_remote, confirm_cost=confirm_cost)
    client = get_provider(provider)
    storage.append_message(
        root,
        project_path,
        session_slug,
        role="user",
        content=stored_content if stored_content is not None else content,
        metadata=user_metadata,
        actor=actor,
    )
    try:
        response = client.chat(model=model, system=prompt_context, content=content, attachments=provider_attachments)
    except Exception as exc:
        if provider in REMOTE_PROVIDERS:
            storage.append_model_usage(
                root,
                {
                    "user_id": storage.slugify(actor) if actor else "local",
                    "chat_id": f"{project_path}/{session_slug}",
                    "provider": provider,
                    "model": model,
                    "input_tokens": input_tokens,
                    "output_tokens": 0,
                    "cached_input_tokens": 0,
                    "estimated_usd": estimated.get("estimated_cost"),
                    "actual_usd": None,
                    "status": "failed",
                    "error": f"{type(exc).__name__}: {str(exc)[:500]}",
                },
            )
        storage.record_usage(root, actor, asks=1)
        raise
    output_tokens = costs.rough_token_count(response)
    actual = costs.estimate_cost(provider, model, input_tokens, output_tokens)
    assistant_metadata = {
        "cost": actual,
        "search": search.results_metadata(search_mode, resolved_results),
        "context_receipt": context_receipts.build_context_receipt(
            manifest,
            provider,
            model,
            actual,
            current_files=active_files if not include_prior_files else None,
        ),
    }
    if execution_plan:
        assistant_metadata["execution_plan"] = execution_plan
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
    if provider in REMOTE_PROVIDERS:
        storage.append_model_usage(
            root,
            {
                "user_id": storage.slugify(actor) if actor else "local",
                "chat_id": f"{project_path}/{session_slug}",
                "provider": provider,
                "model": model,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cached_input_tokens": 0,
                "estimated_usd": estimated.get("estimated_cost"),
                "actual_usd": actual.get("estimated_cost"),
                "status": "completed",
            },
        )
    storage.record_usage(root, actor, asks=1)
    maybe_update_account_memory(root, actor, stored_content if stored_content is not None else content, project_path, session_slug)
    return response


def write_used_context(
    root: str,
    project_path: str,
    session_slug: str,
    prompt_context: str,
    actor: str | None,
    provider: str,
    model: str,
    search_mode: str,
    network_used: bool = False,
    search_queries: list[str] | None = None,
) -> dict[str, object]:
    path = storage.session_dir(root, project_path, session_slug) / "used_context.json"
    manifest = context_manifest.build_context_manifest(
        root,
        project_path,
        session_slug,
        actor=actor,
        provider=provider,
        model=model,
        search_mode=search_mode,
        prompt_context=prompt_context,
        network_used=network_used,
        search_queries=search_queries or [],
    )
    storage.write_json(
        path,
        {
            "created_at": storage.utc_now(),
            "actor": storage.slugify(actor) if actor else "local",
            "provider": provider,
            "model": model,
            "search_mode": search_mode,
            "context_chars": len(prompt_context),
            "context_preview": prompt_context[:8000],
            "manifest": manifest,
        },
    )
    return manifest


def default_model_for_provider(provider: str) -> str:
    if provider == "ollama":
        return os.environ.get("AIWS_DEFAULT_MODEL", "qwen3:4b")
    if provider == "kimi":
        return os.environ.get("AIWS_KIMI_DEFAULT_MODEL", "kimi-k2.5")
    if provider == "gemini":
        return os.environ.get("AIWS_GEMINI_DEFAULT_MODEL", "gemini-2.5-flash-lite")
    if provider == "openai":
        return os.environ.get("AIWS_OPENAI_DEFAULT_MODEL", "gpt-5.1-codex")
    if provider == "ernie":
        return os.environ.get("AIWS_ERNIE_DEFAULT_MODEL", "ernie-5.1")
    return ""


def server_time_context() -> str:
    now = datetime.now().astimezone()
    timezone = now.tzname() or str(now.astimezone().tzinfo)
    locale = os.environ.get("AIWS_LOCALE", "ko-KR")
    return (
        "## Current Server Time\n"
        f"Current server time: {now:%Y-%m-%d %H:%M}\n"
        f"Timezone: {timezone}\n"
        f"Locale: {locale}\n\n"
    )


def enforce_remote_guardrails(
    root: str,
    actor: str | None,
    provider: str,
    estimate: dict[str, object],
    *,
    allow_remote: bool,
    confirm_cost: bool,
) -> None:
    if provider not in REMOTE_PROVIDERS:
        return
    if os.environ.get("AIWS_DISABLE_REMOTE_BY_DEFAULT", "true").lower() in {"1", "true", "yes"} and not allow_remote:
        raise storage.WorkspaceError("Remote model use is disabled by default. Confirm cloud use to continue.")
    estimated_usd = float(estimate.get("estimated_cost") or 0.0)
    threshold = float(os.environ.get("AIWS_REQUIRE_CONFIRM_OVER_USD", "0.25"))
    if estimated_usd >= threshold and not confirm_cost:
        raise storage.WorkspaceError(f"Estimated remote model cost is USD {estimated_usd:.4f}. Confirm cost to continue.")
    daily_limit = float(os.environ.get("AIWS_DAILY_USD_LIMIT", "2"))
    monthly_limit = float(os.environ.get("AIWS_MONTHLY_USD_LIMIT", "20"))
    day_total = storage.model_usage_total_usd(root, actor, period="day")
    month_total = storage.model_usage_total_usd(root, actor, period="month")
    if day_total + estimated_usd > daily_limit:
        raise storage.WorkspaceError("Daily API budget would be exceeded.")
    if month_total + estimated_usd > monthly_limit:
        raise storage.WorkspaceError("Monthly API budget would be exceeded.")


def maybe_update_account_memory(
    root: str,
    actor: str | None,
    content: str,
    project_path: str,
    session_slug: str,
) -> None:
    if not actor:
        return
    policy = memory_policy()
    if not should_store_memory(content, policy):
        return
    summary = summarize_for_memory(content)
    if not summary:
        return
    try:
        storage.append_account_memory(
            root,
            actor,
            f"Recent chat in {project_path}/{session_slug}: {summary}",
            source="explicit" if policy in {"explicit_only", "suggest"} else "auto",
            metadata={"project_path": project_path, "session_slug": session_slug},
        )
    except storage.WorkspaceError:
        return


def memory_policy() -> MemoryPolicy:
    value = os.environ.get("AIWS_MEMORY_POLICY", "explicit_only").strip().lower()
    if value in {"off", "explicit_only", "suggest", "auto"}:
        return value  # type: ignore[return-value]
    return "explicit_only"


def should_store_memory(content: str, policy: MemoryPolicy = "explicit_only") -> bool:
    if policy == "off":
        return False
    text = " ".join(content.replace("\n", " ").split())
    if not text:
        return False
    lowered = text.lower()
    explicit = any(marker in lowered or marker in text for marker in EXPLICIT_MEMORY_MARKERS)
    if policy in {"explicit_only", "suggest"}:
        return explicit
    if policy == "auto":
        return explicit or len(text) >= 20
    return False


def summarize_for_memory(content: str) -> str:
    text = " ".join(content.replace("\n", " ").split())
    if not text:
        return ""
    return text[:220]
