from aiws import automations, storage


def test_automation_projects_do_not_create_openclaw_default(tmp_path, monkeypatch):
    root = tmp_path / "workspace"
    storage.init_workspace(root)

    monkeypatch.setattr(
        automations.openclaw,
        "status",
        lambda: {
            "installed": True,
            "version": "OpenClaw test",
            "gateway": {"ok": True, "summary": {"connectivity_probe": "ok"}},
            "sessions": {"count": 1, "sessions": []},
        },
    )

    assert automations.list_projects(root) == []

    project = automations.create_project(
        root,
        title="OpenClaw Status",
        kind="openclaw_status",
        slug="openclaw-status",
        commands={"status": {"kind": "openclaw_status", "permission": "read-only"}},
    )
    assert project["slug"] == "openclaw-status"

    run = automations.run_project(root, "openclaw-status", actor="kwanho0096")

    assert run["status"] == "completed"
    assert run["actor"] == "kwanho0096"
    assert "OpenClaw installed: yes" in run["observations"]
    assert automations.latest_run(root, "openclaw-status")["run_id"] == run["run_id"]
