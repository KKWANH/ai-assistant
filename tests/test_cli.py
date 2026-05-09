from aiws import cli
from aiws import runner


def test_cli_workflow_prints_prompt_context(tmp_path, capsys):
    root = tmp_path / "workspace"

    assert cli.main(["init", "--root", str(root)]) == 0
    assert cli.main(["skills", "list", "--root", str(root)]) == 0
    assert "andrej-karpathy-skills" in capsys.readouterr().out

    assert (
        cli.main(
            [
                "project",
                "create",
                "AI System",
                "--root",
                str(root),
                "--skills",
                "andrej-karpathy-skills",
            ]
        )
        == 0
    )
    assert cli.main(["project", "create", "Local Runner", "--root", str(root), "--parent", "ai-system"]) == 0
    assert cli.main(["session", "create", "ai-system/local-runner", "Ollama MVP", "--root", str(root)]) == 0
    assert (
        cli.main(
            [
                "session",
                "append",
                "ai-system/local-runner",
                "ollama-mvp",
                "--root",
                str(root),
                "--role",
                "user",
                "--content",
                "How should we implement the Ollama runner?",
            ]
        )
        == 0
    )

    assert cli.main(["prompt", "ai-system/local-runner", "ollama-mvp", "--root", str(root)]) == 0
    output = capsys.readouterr().out
    assert "# AIWS Prompt Context" in output
    assert "andrej-karpathy-skills/CLAUDE.md" in output
    assert "How should we implement the Ollama runner?" in output


def test_cli_returns_error_for_invalid_project_path(tmp_path, capsys):
    root = tmp_path / "workspace"
    assert cli.main(["init", "--root", str(root)]) == 0

    code = cli.main(["session", "create", "missing", "Nope", "--root", str(root)])

    assert code == 2
    assert "Project does not exist" in capsys.readouterr().err


def test_cli_account_and_project_visibility(tmp_path, capsys):
    root = tmp_path / "workspace"
    assert cli.main(["account", "create", "Kwanho", "--root", str(root), "--password", "secret", "--admin"]) == 0
    assert cli.main(["account", "create", "Parent", "--root", str(root), "--password", "parent-secret"]) == 0
    assert (
        cli.main(
            [
                "project",
                "create",
                "Private Notes",
                "--root",
                str(root),
                "--owner",
                "kwanho",
                "--visibility",
                "private",
            ]
        )
        == 0
    )
    assert (
        cli.main(
            [
                "project",
                "create",
                "Family Notes",
                "--root",
                str(root),
                "--owner",
                "parent",
                "--visibility",
                "public",
            ]
        )
        == 0
    )

    capsys.readouterr()
    assert cli.main(["project", "list", "--root", str(root), "--user", "parent"]) == 0
    output = capsys.readouterr().out
    assert "family-notes" in output
    assert "private-notes" not in output


def test_cli_ask_prints_response(tmp_path, capsys, monkeypatch):
    root = tmp_path / "workspace"
    assert cli.main(["init", "--root", str(root)]) == 0
    assert cli.main(["project", "create", "AI System", "--root", str(root)]) == 0
    assert cli.main(["session", "create", "ai-system", "Ollama MVP", "--root", str(root)]) == 0

    def fake_ask(root_arg, project_path, session_slug, *, provider, model, content, actor=None, search_mode="off"):
        assert root_arg == str(root)
        assert project_path == "ai-system"
        assert session_slug == "ollama-mvp"
        assert provider == "ollama"
        assert model == "qwen3:8b"
        assert content == "Hello"
        assert actor is None
        assert search_mode == "off"
        return "Hi from Ollama"

    monkeypatch.setattr(runner, "ask", fake_ask)

    code = cli.main(
        [
            "ask",
            "ai-system",
            "ollama-mvp",
            "--root",
            str(root),
            "--provider",
            "ollama",
            "--model",
            "qwen3:8b",
            "--content",
            "Hello",
        ]
    )

    assert code == 0
    assert "Hi from Ollama" in capsys.readouterr().out


def test_cli_lists_model_costs(tmp_path, capsys):
    root = tmp_path / "workspace"

    assert cli.main(["models", "costs", "--root", str(root)]) == 0

    output = capsys.readouterr().out
    assert "ollama" in output
    assert "kimi" in output


def test_cli_goal_set_and_prints_codex_prompt(tmp_path, capsys):
    root = tmp_path / "workspace"
    goal_file = tmp_path / "GOAL.md"
    goal_file.write_text(
        "# Goal\n\n## Objective\nShip P1.\n\n## Test Commands\n- .venv/bin/python -m pytest\n",
        encoding="utf-8",
    )

    assert cli.main(["init", "--root", str(root)]) == 0
    assert cli.main(["project", "create", "AI System", "--root", str(root)]) == 0
    assert cli.main(["goal", "set", "ai-system", "--file", str(goal_file), "--root", str(root)]) == 0
    assert "Ship P1." in capsys.readouterr().out

    assert cli.main(["goal", "ai-system", "--root", str(root)]) == 0
    assert "You are Codex" in capsys.readouterr().out


def test_cli_backup_create_and_restore(tmp_path, capsys):
    root = tmp_path / "workspace"
    restored = tmp_path / "restored"

    assert cli.main(["init", "--root", str(root)]) == 0
    assert cli.main(["project", "create", "AI System", "--root", str(root)]) == 0
    capsys.readouterr()
    assert cli.main(["backup", "create", "--root", str(root), "--output", str(tmp_path / "aiws-backup")]) == 0
    backup_path = capsys.readouterr().out.strip()
    assert backup_path.endswith("aiws-backup.tar.gz")

    assert cli.main(["backup", "restore", backup_path, "--root", str(restored)]) == 0
    assert "restored" in capsys.readouterr().out
    assert cli.main(["project", "list", "--root", str(restored)]) == 0
    assert "ai-system" in capsys.readouterr().out
