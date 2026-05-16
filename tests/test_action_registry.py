from pathlib import Path

import pytest

from aiws import storage
from aiws.core import action_registry, context_manifest, home_workbench


def write_project_config(root: Path, project_path: str, body: str) -> None:
    path = storage.project_dir(root, project_path) / "aiws.yaml"
    path.write_text(body, encoding="utf-8")


def test_aiws_yaml_parsing_and_prompt_recipe_preview(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Investment")
    write_project_config(
        root,
        "investment",
        """
name: Investment
root: .
commands:
  summarize:
    kind: prompt_recipe
    label: Summarize
    description: Summarize files
    prompt: |
      Read the local files.
      Summarize them.
""",
    )

    config = action_registry.load_config(root, "investment")
    preview = action_registry.preview_action(root, "investment", "summarize")

    assert config["name"] == "Investment"
    assert preview["kind"] == "prompt_recipe"
    assert preview["output_type"] == "chat_prompt"
    assert preview["expected_output_files"] == []
    assert "Summarize them." in preview["prompt"]


def test_versioned_aiws_yaml_actions_alias_and_permissions(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Tools")
    write_project_config(
        root,
        "tools",
        """
version: 1
name: Tools
project:
  root: .
actions:
  summarize:
    kind: prompt_recipe
    label: Summarize
    prompt: Summarize local files.
  run_tool:
    kind: shell
    label: Run tool
    command: printf hi
""",
    )

    config = action_registry.load_config(root, "tools")

    assert config["version"] == 1
    assert config["root"] == "."
    assert "summarize" in config["actions"]
    assert config["actions"] == config["commands"]
    assert config["actions"]["summarize"]["permissions"]["file_read"] is True
    assert config["actions"]["summarize"]["permissions"]["network"] is False
    assert config["actions"]["run_tool"]["permissions"]["shell"] is True
    assert config["actions"]["run_tool"]["permissions"]["file_write"] is False


def test_aiws_yaml_rejects_unknown_version(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Tools")
    write_project_config(
        root,
        "tools",
        """
version: 99
commands: {}
""",
    )

    with pytest.raises(storage.WorkspaceError, match="Unsupported aiws.yaml version"):
        action_registry.load_config(root, "tools")


def test_aiws_yaml_root_must_stay_inside_project(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Tools")
    write_project_config(
        root,
        "tools",
        """
version: 1
root: ..
commands: {}
""",
    )

    with pytest.raises(storage.WorkspaceError, match="root must stay inside"):
        action_registry.load_config(root, "tools")


def test_aiws_yaml_views_and_panels_are_normalized(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Investment")
    write_project_config(
        root,
        "investment",
        """
name: Investment
views:
  - id: investment
    title: Investment Rebalancer
    layout: sidebar
    panels:
      - type: fileExplorer
        title: Portfolio Files
        source: files/
      - type: actionLauncher
        title: Rebalance Actions
        actions:
          - rebalance_plan
commands:
  rebalance_plan:
    kind: prompt_recipe
    label: Rebalance Plan
    prompt: Summarize files.
""",
    )

    config = action_registry.load_config(root, "investment")

    assert config["views"][0]["id"] == "investment"
    assert config["views"][0]["panels"][0]["type"] == "fileExplorer"
    assert config["views"][0]["panels"][1]["actions"] == ["rebalance_plan"]


def test_legacy_output_string_is_not_split_into_artifacts(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Investment")
    write_project_config(
        root,
        "investment",
        """
name: Investment
root: .
commands:
  summarize:
    kind: prompt_recipe
    output: chat_prompt
    label: Summarize
    prompt: Summarize files.
""",
    )

    preview = action_registry.preview_action(root, "investment", "summarize")
    run = action_registry.run_action(root, "investment", "summarize")

    assert preview["output_type"] == "chat_prompt"
    assert preview["expected_output_files"] == []
    assert run["artifacts"] == []


def test_shell_action_requires_confirmation_and_creates_run_folder(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Tools")
    write_project_config(
        root,
        "tools",
        """
name: Tools
root: .
commands:
  say_hi:
    kind: shell
    label: Say hi
    cwd: .
    command: printf hi
""",
    )

    preview = action_registry.preview_action(root, "tools", "say_hi")
    assert preview["requires_confirmation"] is True

    with pytest.raises(storage.WorkspaceError, match="confirmation"):
        action_registry.run_action(root, "tools", "say_hi")

    run = action_registry.run_action(root, "tools", "say_hi", confirmed=True)
    run_dir = Path(run["run_dir"])

    assert run["status"] == "completed"
    assert run["stdout"] == "hi"
    assert (run_dir / "run.json").exists()
    assert (run_dir / "logs.jsonl").exists()
    assert (run_dir / "run.md").exists()
    assert (run_dir / "stdout.txt").read_text(encoding="utf-8") == "hi"
    assert (run_dir / "stderr.txt").exists()
    assert (run_dir / "result.json").exists()


def test_secret_path_references_are_blocked(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Unsafe")
    write_project_config(
        root,
        "unsafe",
        """
name: Unsafe
root: .
commands:
  read_env:
    kind: shell
    command: cat .env
""",
    )

    with pytest.raises(storage.WorkspaceError, match="secret"):
        action_registry.load_config(root, "unsafe")


def test_action_cwd_path_traversal_is_rejected(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Unsafe")
    write_project_config(
        root,
        "unsafe",
        """
name: Unsafe
root: .
commands:
  escape:
    kind: shell
    cwd: ..
    command: printf hi
""",
    )

    with pytest.raises(storage.WorkspaceError, match="escapes"):
        action_registry.preview_action(root, "unsafe", "escape")


def test_action_absolute_script_path_is_rejected(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Unsafe")
    write_project_config(
        root,
        "unsafe",
        f"""
name: Unsafe
root: .
commands:
  escape:
    kind: python
    script: {tmp_path / "script.py"}
""",
    )

    with pytest.raises(storage.WorkspaceError, match="Absolute paths"):
        action_registry.run_action(root, "unsafe", "escape", confirmed=True)


def test_shell_action_requires_run_shell_capability(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Unsafe")
    write_project_config(
        root,
        "unsafe",
        """
name: Unsafe
root: .
commands:
  blocked:
    kind: shell
    permissions:
      shell: false
    command: printf hi
""",
    )

    with pytest.raises(storage.WorkspaceError, match="run_shell capability"):
        action_registry.run_action(root, "unsafe", "blocked", confirmed=True)


def test_python_action_requires_run_python_capability(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Unsafe")
    script = storage.project_dir(root, "unsafe") / "script.py"
    script.write_text("print('hi')\n", encoding="utf-8")
    write_project_config(
        root,
        "unsafe",
        """
name: Unsafe
root: .
commands:
  blocked:
    kind: python
    permissions:
      python: false
    script: script.py
""",
    )

    with pytest.raises(storage.WorkspaceError, match="run_python capability"):
        action_registry.run_action(root, "unsafe", "blocked", confirmed=True)


def test_run_record_contains_approval_capabilities_and_tails(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Tools")
    write_project_config(
        root,
        "tools",
        """
name: Tools
root: .
commands:
  say_hi:
    kind: shell
    label: Say hi
    command: printf hi
""",
    )

    run = action_registry.run_action(root, "tools", "say_hi", actor="kwanho", confirmed=True)

    assert run["approval"]["confirmed"] is True
    assert run["approval"]["approved_by"] == "kwanho"
    assert run["capabilities"]["run_shell"] is True
    assert run["stdout_tail"] == "hi"
    assert run["requested_by"] == "kwanho"
    assert run["inputs"]["command_line"] == "printf hi"
    assert run["outputs"]["expected_files"] == []


def test_investment_rebalancer_template_python_action(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Investment")

    config = action_registry.import_template(root, "investment", "investment-rebalancer")
    run = action_registry.run_action(root, "investment", "rebalance_plan", confirmed=True)

    assert "rebalance_plan" in config["commands"]
    assert run["status"] == "completed"
    assert "Wrote" in run["stdout"]
    assert (storage.project_dir(root, "investment") / "artifacts" / "rebalance-table.csv").exists()


def test_project_artifact_and_run_detail_readers(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Investment")
    action_registry.import_template(root, "investment", "investment-rebalancer")
    run = action_registry.run_action(root, "investment", "rebalance_plan", confirmed=True)

    detail = action_registry.read_run_detail(root, "investment", run["run_id"])
    artifact = action_registry.read_project_artifact(root, "investment", "artifacts/rebalance-table.csv")

    assert detail["run"]["run_id"] == run["run_id"]
    assert detail["logs"]
    assert detail["run"]["artifacts"][0]["viewer_type"] == "tableViewer"
    assert "Wrote" in detail["stdout"]
    assert artifact["kind"] == "csv"
    assert artifact["viewer_type"] == "tableViewer"
    assert "asset_class,current_value" in artifact["content"]


def test_recent_run_context_is_available_for_prompt_context(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Investment")
    storage.create_session(root, "investment", "May Review")
    action_registry.import_template(root, "investment", "investment-rebalancer")
    action_registry.run_action(root, "investment", "rebalance_plan", confirmed=True)

    context = storage.build_prompt_context(root, "investment", "may-review")

    assert "## Recent Project Action Runs" in context
    assert "리밸런싱 계산" in context


def test_context_manifest_summarizes_files_runs_and_cost(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Investment")
    storage.create_session(root, "investment", "May Review")
    action_registry.import_template(root, "investment", "investment-rebalancer")
    action_registry.run_action(root, "investment", "rebalance_plan", confirmed=True)

    manifest = context_manifest.build_context_manifest(
        root,
        "investment",
        "may-review",
        actor="kwanho",
        provider="gemini",
        model="gemini-2.5-flash-lite",
        search_mode="auto",
        prompt_context="x" * 4000,
    )

    assert manifest["actor"] == "kwanho"
    assert manifest["project"]["path"] == "investment"
    assert manifest["runs"][0]["command"] == "rebalance_plan"
    assert manifest["estimates"]["input_tokens"] >= 1000
    assert manifest["estimates"]["estimated_cost"] is not None
    assert any(item["type"] == "recent_runs" for item in manifest["included"])
    assert any(item["reason"] == "blocked secret path" for item in manifest["excluded"])


def test_context_manifest_records_retrieval_chunks_and_privacy(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Research")
    storage.create_session(root, "research", "Current")
    storage.create_session(root, "research", "Source")
    from aiws import attachments

    attachments.save_attachment(root, "research", "current", "brief.txt", b"current brief text", delivery="text_context")
    attachments.save_attachment(root, "research", "source", "archive.txt", b"prior archive text", delivery="text_context")

    manifest = context_manifest.build_context_manifest(
        root,
        "research",
        "current",
        provider="gemini",
        model="gemini-2.5-flash-lite",
        prompt_context="current brief text\nprior archive text",
        active_attachment_filenames={"brief.txt"},
        include_project_files=False,
    )

    assert [item["filename"] for item in manifest["included_chunks"]] == ["brief.txt"]
    assert manifest["included_chunks"][0]["privacy"] == "sent_to_cloud"
    assert manifest["privacy"]["files_sent_to_cloud"]
    assert any(item["filename"] == "archive.txt" and "limited" in item["reason"] for item in manifest["excluded"])


def test_suggest_actions_matches_recent_chat_text(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Investment")
    action_registry.import_template(root, "investment", "investment-rebalancer")

    suggestions = action_registry.suggest_actions(
        root,
        "investment",
        messages=[{"role": "user", "content": "포트폴리오 리밸런싱 계산을 실행하고 싶어"}],
    )

    assert suggestions
    assert suggestions[0]["command"] == "rebalance_plan"
    assert suggestions[0]["kind"] == "python"


def test_investment_advisor_template_runs_deterministic_actions(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Advisor")
    config = action_registry.import_template(root, "advisor", "investment-advisor")

    assert config["name"] == "Investment Advisor Workbench"
    assert "market_research" in config["commands"]
    preview = action_registry.preview_action(root, "advisor", "market_research")
    assert preview["capabilities"]["allow_network"] is True

    rebalance = action_registry.run_action(root, "advisor", "rebalance_plan", confirmed=True)
    report = action_registry.run_action(root, "advisor", "advisor_report", confirmed=True)

    assert rebalance["status"] == "completed"
    assert report["status"] == "completed"
    artifact_names = {Path(item["path"]).name for item in report["artifacts"]}
    assert "advisor-report.md" in artifact_names


def test_home_csv_analysis_creates_stats_artifacts(tmp_path):
    root = tmp_path / "workspace"
    storage.init_workspace(root)

    run = home_workbench.run_action(
        root,
        "local",
        "csv_analysis",
        upload=("table.csv", b"name,value,missing\nalpha,10,\nbeta,20,x\n"),
    )

    assert run["status"] == "completed"
    artifact_names = {Path(item["path"]).name for item in run["artifacts"]}
    assert {"csv-profile.json", "csv-preview.csv", "csv-summary.md", "missing-values.csv", "numeric-stats.csv"} <= artifact_names
    assert run["outputs"]["expected_artifacts"] == [
        "csv-profile.json",
        "csv-preview.csv",
        "csv-summary.md",
        "missing-values.csv",
        "numeric-stats.csv",
    ]
    assert run["capabilities"]["write_files"] is True
    detail = home_workbench.read_run_detail(root, "local", run["run_id"])
    assert detail["logs"]
    summary_path = next(item["path"] for item in run["artifacts"] if Path(item["path"]).name == "csv-summary.md")
    summary = home_workbench.read_artifact(root, "local", summary_path)
    assert "Rows: 2" in summary["content"]
    assert "`value`: min 10" in summary["content"]
    assert "`missing`: 1" in summary["content"]


def test_home_file_action_requires_file(tmp_path):
    root = tmp_path / "workspace"
    storage.init_workspace(root)

    with pytest.raises(storage.WorkspaceError, match="Attach a file"):
        home_workbench.run_action(root, "local", "document_summary", content="Summarize this")


def test_home_codex_prompt_requires_situation(tmp_path):
    root = tmp_path / "workspace"
    storage.init_workspace(root)

    with pytest.raises(storage.WorkspaceError, match="Describe the situation"):
        home_workbench.run_action(root, "local", "codex_task_prompt", content="   ")


def test_home_codex_prompt_starts_with_situation(tmp_path):
    root = tmp_path / "workspace"
    storage.init_workspace(root)

    run = home_workbench.run_action(
        root,
        "local",
        "codex_task_prompt",
        content="Login layout is confusing because the logo blends into the background.",
    )

    assert run["status"] == "completed"
    artifact = home_workbench.read_artifact(root, "local", run["artifacts"][0]["path"])
    assert "# Codex Task Brief" in artifact["content"]
    assert "## Situation" in artifact["content"]
    assert "Login layout is confusing" in artifact["content"]
    assert "## Verification Commands" in artifact["content"]
