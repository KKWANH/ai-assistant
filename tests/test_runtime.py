import shutil
import subprocess
import sys

from aiws import runtime as runtime_module
from aiws.runtime import LocalRuntime, ManagedProcess


class FakeProcess:
    def __init__(self):
        self.terminated = False
        self.killed = False

    def poll(self):
        return None

    def terminate(self):
        self.terminated = True

    def wait(self, timeout):
        return 0

    def kill(self):
        self.killed = True


def test_runtime_builds_ui_and_ollama_processes(tmp_path, monkeypatch):
    monkeypatch.setattr(shutil, "which", lambda name: "/usr/local/bin/ollama" if name == "ollama" else None)
    monkeypatch.setattr(runtime_module, "is_port_open", lambda host, port: False)

    runtime = LocalRuntime(
        root=str(tmp_path),
        mode="local",
        port=8765,
        password=None,
        start_ollama=True,
        idle_timeout=1800,
        status_path=None,
    )

    processes = runtime.build_processes()

    assert [process.name for process in processes] == ["aiws-ui", "ollama"]
    assert processes[0].command[:7] == [sys.executable, "-m", "aiws.cli", "ui", "start", "--root", str(tmp_path)]
    assert processes[1].command == ["/usr/local/bin/ollama", "serve"]


def test_runtime_reuses_existing_ollama_process(tmp_path, monkeypatch):
    monkeypatch.setattr(shutil, "which", lambda name: "/usr/local/bin/ollama" if name == "ollama" else None)
    monkeypatch.setattr(runtime_module, "is_port_open", lambda host, port: port == 11434)

    runtime = LocalRuntime(
        root=str(tmp_path),
        mode="local",
        port=8765,
        password=None,
        start_ollama=True,
        idle_timeout=1800,
        status_path=None,
    )

    processes = runtime.build_processes()

    assert [process.name for process in processes] == ["aiws-ui"]


def test_managed_process_starts_in_new_session(monkeypatch):
    calls = {}

    def fake_popen(command, text, **kwargs):
        calls["command"] = command
        calls["text"] = text
        calls["kwargs"] = kwargs
        return FakeProcess()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    process = ManagedProcess("example", ["example"])
    process.start()

    assert calls["command"] == ["example"]
    assert calls["text"] is True
    assert calls["kwargs"]["start_new_session"] is True
    assert process.is_running() is True
