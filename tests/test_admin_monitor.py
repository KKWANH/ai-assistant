import json

from aiws import storage
from aiws.admin_monitor import admin_snapshot, structured_analysis


def test_admin_snapshot_reports_runtime_logs_and_model_failures(tmp_path):
    root = tmp_path / "workspace"
    storage.create_account(root, "Admin", "secret", admin=True)
    storage.append_model_usage(
        root,
        {
            "user_id": "admin",
            "provider": "gemini",
            "model": "gemini-2.5-pro",
            "status": "failed",
            "error": "quota reached",
            "estimated_usd": 0.01,
        },
    )
    workspace = storage.workspace_path(root)
    (workspace / "runtime-status.json").write_text(json.dumps({"status": "running"}), encoding="utf-8")
    log_dir = workspace / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    (log_dir / "aiws-server.log").write_text("ERROR example\n", encoding="utf-8")

    snapshot = admin_snapshot(root)

    assert snapshot["counts"]["accounts"] == 1
    assert snapshot["counts"]["failed_model_calls"] == 1
    assert snapshot["model_usage"]["failed"][0]["error"] == "quota reached"
    assert any(item["severity"] == "error" for item in snapshot["analysis"])


def test_structured_analysis_has_stable_json_shape(tmp_path):
    root = tmp_path / "workspace"
    snapshot = admin_snapshot(root)

    payload = json.loads(structured_analysis(snapshot, "runtime", "check now"))

    assert payload["kind"] == "runtime"
    assert payload["note"] == "check now"
    assert "findings" in payload
