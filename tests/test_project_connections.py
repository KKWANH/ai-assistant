from aiws import storage
from aiws.core import project_connections


def test_project_connections_require_approved_link(tmp_path):
    root = tmp_path
    storage.init_workspace(root)
    storage.create_project(root, "Food", slug="food")
    storage.create_project(root, "Diet", slug="diet")

    (storage.project_dir(root, "food") / "aiws.yaml").write_text(
        """
version: 1
name: Food
resource_exports:
  - resourceType: nutrition_snapshot
    artifactPattern: artifacts/nutrition-snapshot.json
    schemaVersion: "1"
commands:
""".strip(),
        encoding="utf-8",
    )

    before = project_connections.payload(root, "diet", None)
    assert before["connectedResources"] == []

    link = project_connections.request_link(
        root,
        source_project="food",
        target_project="diet",
        allowed_resource_types=["nutrition_snapshot"],
        mode="read",
        actor="owner",
    )
    pending = project_connections.payload(root, "diet", None)
    assert pending["incomingLinks"][0]["status"] == "pending"
    assert pending["connectedResources"] == []

    project_connections.approve_link(root, link_id=link["linkId"], actor="owner")
    approved = project_connections.payload(root, "diet", None)
    assert approved["connectedResources"][0]["sourceProjectId"] == "food"
    assert approved["connectedResources"][0]["resourceType"] == "nutrition_snapshot"


def test_project_connection_revoke_hides_resources(tmp_path):
    root = tmp_path
    storage.init_workspace(root)
    storage.create_project(root, "Diet", slug="diet")
    storage.create_project(root, "Exercise", slug="exercise")

    link = project_connections.request_link(
        root,
        source_project="diet",
        target_project="exercise",
        allowed_resource_types=["project_report"],
        mode="compute",
        actor="owner",
    )
    project_connections.approve_link(root, link_id=link["linkId"], actor="owner")
    assert project_connections.payload(root, "exercise", None)["connectedResources"]

    project_connections.revoke_link(root, link_id=link["linkId"], actor="owner")
    assert project_connections.payload(root, "exercise", None)["connectedResources"] == []
