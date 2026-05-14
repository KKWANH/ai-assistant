from pathlib import Path

import pytest

from aiws import storage
from aiws.tools import shell


def test_shell_runs_allowed_argv_without_shell(tmp_path):
    result = shell.run(["printf", "hi"], cwd=tmp_path)

    assert result.returncode == 0
    assert result.stdout == "hi"
    assert result.args == ["printf", "hi"]


def test_shell_string_injection_is_rejected(tmp_path):
    target = tmp_path / "owned"

    with pytest.raises(storage.WorkspaceError, match="metacharacters"):
        shell.run(f"printf hi; touch {target}", cwd=tmp_path)

    assert not target.exists()


def test_shell_semicolon_chaining_does_not_execute(tmp_path):
    target = tmp_path / "owned"

    with pytest.raises(storage.WorkspaceError):
        shell.run(["sh", "-c", f"printf hi; touch {target}"], cwd=tmp_path)

    assert not target.exists()


@pytest.mark.parametrize(
    "argv",
    [
        ["sudo", "true"],
        ["curl", "https://example.com"],
        ["wget", "https://example.com"],
        ["ssh", "example.com"],
        ["scp", "a", "b"],
        ["nc", "-z", "example.com", "80"],
        ["bash", "-c", "echo hi"],
        ["sh", "-c", "echo hi"],
        ["python", "-c", "print(1)"],
        ["chmod", "777", "file"],
        ["chown", "root", "file"],
        ["rm", "-rf", "folder"],
    ],
)
def test_shell_rejects_forbidden_commands(tmp_path: Path, argv):
    with pytest.raises(storage.WorkspaceError):
        shell.run(argv, cwd=tmp_path)
