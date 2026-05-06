import subprocess

from aiws.supervisor import StatusSupervisor


class FakeProcess:
    def __init__(self, returncodes):
        self.returncodes = list(returncodes)
        self.last = None
        self.terminated = False

    def poll(self):
        if self.returncodes:
            self.last = self.returncodes.pop(0)
        return self.last

    def terminate(self):
        self.terminated = True


def test_supervisor_restarts_stopped_process(monkeypatch):
    processes = [FakeProcess([1]), FakeProcess([None])]

    def fake_popen(command, text, **kwargs):
        return processes.pop(0)

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    supervisor = StatusSupervisor(["example"])
    first = supervisor.run_once()
    second = supervisor.run_once()

    assert first.running is False
    assert second.running is True
    assert second.restarts == 1
