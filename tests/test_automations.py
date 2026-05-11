from aiws import automations, storage


def test_default_openclaw_automation_project_runs(tmp_path, monkeypatch):
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

    projects = automations.list_projects(root)
    assert projects[0]["slug"] == automations.DEFAULT_OPENCLAW_SLUG
    assert projects[0]["category"] == "diagnostics"
    assert projects[0]["permissions"]["shell"] == "blocked"
    assert projects[0]["commands"]["self_check"]["permission"] == "read-only"

    run = automations.run_project(root, automations.DEFAULT_OPENCLAW_SLUG, actor="kwanho0096")

    assert run["status"] == "completed"
    assert run["category"] == "diagnostics"
    assert run["actor"] == "kwanho0096"
    assert "OpenClaw installed: yes" in run["observations"]
    assert automations.latest_run(root, automations.DEFAULT_OPENCLAW_SLUG)["run_id"] == run["run_id"]
