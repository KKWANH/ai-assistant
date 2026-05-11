from pathlib import Path

import pytest

from aiws import storage
from aiws.core import action_registry


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
    assert "Summarize them." in preview["prompt"]


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


def test_investment_rebalancer_template_python_action(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Investment")

    config = action_registry.import_template(root, "investment", "investment-rebalancer")
    run = action_registry.run_action(root, "investment", "rebalance_plan", confirmed=True)

    assert "rebalance_plan" in config["commands"]
    assert run["status"] == "completed"
    assert "Wrote" in run["stdout"]
    assert (storage.project_dir(root, "investment") / "artifacts" / "rebalance-table.csv").exists()


def test_recent_run_context_is_available_for_prompt_context(tmp_path):
    root = tmp_path / "workspace"
    storage.create_project(root, "Investment")
    storage.create_session(root, "investment", "May Review")
    action_registry.import_template(root, "investment", "investment-rebalancer")
    action_registry.run_action(root, "investment", "rebalance_plan", confirmed=True)

    context = storage.build_prompt_context(root, "investment", "may-review")

    assert "## Recent Project Action Runs" in context
    assert "리밸런싱 계산" in context
