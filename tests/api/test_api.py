from fastapi.testclient import TestClient

from aiws.api.app import create_app

HTTP_OK = 200


def test_health_and_workspace_init(tmp_path) -> None:
    client = TestClient(create_app(tmp_path))

    health = client.get("/api/health")
    assert health.status_code == HTTP_OK
    assert health.json()["ok"] is True

    workspace = client.post("/api/workspace/init", json={})
    assert workspace.status_code == HTTP_OK
    assert workspace.json()["initialized"] is True


def test_project_session_message_api(tmp_path) -> None:
    client = TestClient(create_app(tmp_path))
    client.post("/api/workspace/init", json={})

    project = client.post(
        "/api/projects",
        json={"path": "research", "title": "Research"},
    )
    assert project.status_code == HTTP_OK

    session = client.post(
        "/api/projects/research/sessions",
        json={"slug": "planning", "title": "Planning"},
    )
    assert session.status_code == HTTP_OK
    session_id = session.json()["session"]["id"]

    message = client.post(
        "/api/projects/research/sessions/planning/messages",
        json={"session_id": session_id, "role": "user", "content": "Hello"},
    )
    assert message.status_code == HTTP_OK

    messages = client.get("/api/projects/research/sessions/planning/messages")
    assert messages.status_code == HTTP_OK
    assert messages.json()["messages"][0]["content"] == "Hello"


def test_subproject_session_api_accepts_two_level_project_path(tmp_path) -> None:
    client = TestClient(create_app(tmp_path))
    client.post("/api/workspace/init", json={})
    client.post("/api/projects", json={"path": "research", "title": "Research"})
    client.post("/api/projects", json={"path": "research/brief", "title": "Brief"})

    response = client.post(
        "/api/projects/research/brief/sessions",
        json={"slug": "planning", "title": "Planning"},
    )

    assert response.status_code == HTTP_OK
    assert response.json()["session"]["project_path"] == "research/brief"


def test_admin_status_and_analysis(tmp_path, monkeypatch) -> None:
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    (log_dir / "aiws.log").write_text("warning: slow\nerror: failed\n", encoding="utf-8")
    monkeypatch.setenv("AIWS_LOG_DIR", str(log_dir))
    client = TestClient(create_app(tmp_path / "workspace"))

    response = client.get("/api/admin/analysis")

    assert response.status_code == HTTP_OK
    assert response.json()["error_count"] == 1
    assert response.json()["warning_count"] == 1
