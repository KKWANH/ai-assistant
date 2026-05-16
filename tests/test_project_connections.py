from aiws import storage
from aiws.core import action_runs, project_connections


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
    (storage.project_dir(root, "diet") / "aiws.yaml").write_text(
        """
version: 1
name: Diet
resource_imports:
  - sourceProjectId: food
    acceptedResourceType: nutrition_snapshot
    localAlias: foods
commands:
""".strip(),
        encoding="utf-8",
    )
    artifacts_dir = storage.project_dir(root, "food") / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (artifacts_dir / "nutrition-snapshot.json").write_text('{"kcal": 520}', encoding="utf-8")

    before = project_connections.payload(root, "diet", None)
    assert before["connectedResources"] == []
    assert before["resolvedImports"] == []

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
    assert approved["resolvedImports"][0]["localAlias"] == "foods"
    assert approved["resolvedImports"][0]["latestArtifact"]["path"] == "artifacts/nutrition-snapshot.json"


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


def test_project_run_receives_resolved_import_aliases(tmp_path):
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
    (storage.project_dir(root, "diet") / "aiws.yaml").write_text(
        """
version: 1
name: Diet
resource_imports:
  - sourceProjectId: food
    acceptedResourceType: nutrition_snapshot
    localAlias: foods
workflow_apps:
  - id: diet_summary
    title: Diet Summary
    description: Uses linked nutrition snapshots.
    category: Food
    inputSchema:
    outputSchema:
    runPolicy:
      mode: approval_required
      requiresConfirmation: false
      network: blocked
      fileWrite: artifacts_only
      cloud: blocked
    defaultViewerLayout:
    supportedResources:
      - nutrition_snapshot
    permissions:
      file_read: true
commands:
  summarize_foods:
    kind: prompt_recipe
    label: Summarize linked foods
    workflow_app_id: diet_summary
    prompt: Use linked nutrition snapshots.
""".strip(),
        encoding="utf-8",
    )
    artifacts_dir = storage.project_dir(root, "food") / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (artifacts_dir / "nutrition-snapshot.json").write_text('{"kcal": 520}', encoding="utf-8")

    link = project_connections.request_link(
        root,
        source_project="food",
        target_project="diet",
        allowed_resource_types=["nutrition_snapshot"],
        mode="read",
        actor="owner",
    )
    project_connections.approve_link(root, link_id=link["linkId"], actor="owner")

    run = action_runs.run_project(root, "diet", "summarize_foods", actor="owner")

    resolved = run["inputs"]["resolved_imports"]
    assert resolved[0]["localAlias"] == "foods"
    assert resolved[0]["latestArtifact"]["path"] == "artifacts/nutrition-snapshot.json"
    input_resources = run["inputs"]["resolved_input_resources"]
    assert input_resources["resource_foods"]["alias"] == "foods"
    assert input_resources["resource_foods"]["latestArtifact"]["path"] == "artifacts/nutrition-snapshot.json"


def test_project_run_injects_resolved_import_alias_environment(tmp_path):
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
    diet_dir = storage.project_dir(root, "diet")
    (diet_dir / "scripts").mkdir(parents=True)
    (diet_dir / "scripts" / "show_import.py").write_text(
        "import os\nprint(os.environ.get('AIWS_IMPORT_FOODS_PATH', ''))\nprint('AIWS_RESOLVED_IMPORTS' in os.environ)\n",
        encoding="utf-8",
    )
    (diet_dir / "aiws.yaml").write_text(
        """
version: 1
name: Diet
resource_imports:
  - sourceProjectId: food
    acceptedResourceType: nutrition_snapshot
    localAlias: foods
commands:
  show_import:
    kind: python
    label: Show linked import
    script: scripts/show_import.py
    permissions:
      python: true
""".strip(),
        encoding="utf-8",
    )
    artifacts_dir = storage.project_dir(root, "food") / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (artifacts_dir / "nutrition-snapshot.json").write_text('{"kcal": 520}', encoding="utf-8")

    link = project_connections.request_link(
        root,
        source_project="food",
        target_project="diet",
        allowed_resource_types=["nutrition_snapshot"],
        mode="read",
        actor="owner",
    )
    project_connections.approve_link(root, link_id=link["linkId"], actor="owner")

    run = action_runs.run_project(root, "diet", "show_import", actor="owner", confirmed=True)

    assert "nutrition-snapshot.json" in run["stdout"]
    assert "True" in run["stdout"]
    assert "AIWS_IMPORT_FOODS_PATH" in run["inputs"]["resolved_import_env_keys"]
