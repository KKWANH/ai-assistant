import json

from aiws import storage
from aiws.app.routes import project_viewers
from aiws.core import project_connections


def test_investment_viewer_payload_reads_trusted_artifacts(tmp_path):
    root = tmp_path
    storage.init_workspace(root)
    storage.create_project(root, "Investment Advisor", slug="investment-advisor")
    artifacts = storage.project_dir(root, "investment-advisor") / "artifacts"
    artifacts.mkdir(parents=True)
    (artifacts / "current-weights.json").write_text(json.dumps({"total_value": 1000, "weights": [{"symbol": "VOO"}]}), encoding="utf-8")
    (artifacts / "target-gap.json").write_text(json.dumps({"gaps": [{"symbol": "VOO", "suggestion": "add"}]}), encoding="utf-8")
    (artifacts / "monthly-performance.csv").write_text("month,total_value\n2026-01,1000\n", encoding="utf-8")
    (artifacts / "rebalance-report.md").write_text("# Report", encoding="utf-8")

    payload = project_viewers.investment_rebalance_payload(root, "investment-advisor")

    assert payload["viewerId"] == "investment-rebalance-dashboard"
    assert payload["summary"]["totalValue"] == 1000
    assert payload["summary"]["needsAdd"] == 1
    assert payload["monthlyPerformance"][0]["month"] == "2026-01"


def test_trusted_viewer_manifest_reload_and_frame(tmp_path):
    root = tmp_path
    storage.init_workspace(root)
    storage.create_project(root, "Investment Advisor", slug="investment-advisor")
    viewers = storage.project_dir(root, "investment-advisor") / "viewers"
    viewers.mkdir(parents=True)
    (viewers / "manifest.json").write_text(
        json.dumps(
            {
                "viewers": [
                    {
                        "id": "investment-rebalance-dashboard",
                        "title": "Investment Dashboard",
                        "entry": "investment-rebalance-dashboard.viewer.tsx",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (viewers / "investment-rebalance-dashboard.viewer.js").write_text(
        "document.getElementById('root').textContent = 'custom investment viewer';",
        encoding="utf-8",
    )
    manifest_text = (viewers / "manifest.json").read_text(encoding="utf-8")
    (viewers / "manifest.json").write_text(
        manifest_text.replace("investment-rebalance-dashboard.viewer.tsx", "investment-rebalance-dashboard.viewer.js"),
        encoding="utf-8",
    )

    manifest = project_viewers.trusted_viewer_manifest(root, "investment-advisor")
    assert manifest["viewers"][0]["id"] == "investment-rebalance-dashboard"
    assert manifest["viewers"][0]["exists"] is True

    reloaded = project_viewers.reload_trusted_viewers(root, "investment-advisor")
    assert reloaded["build"]["status"] == "ready"
    assert reloaded["build"]["builtCount"] == 1

    frame = project_viewers.trusted_viewer_frame_html(root, "investment-advisor", "investment-rebalance-dashboard")
    assert "/project-viewers/investment-advisor/asset/investment-rebalance-dashboard.js" in frame
    assert "/api/project-viewers/investment-advisor/investment-rebalance-dashboard/payload" in frame
    asset = project_viewers.trusted_viewer_asset(root, "investment-advisor", "investment-rebalance-dashboard.js")
    assert b"custom investment viewer" in asset


def test_trusted_viewer_payload_uses_manifest_artifact_patterns(tmp_path):
    root = tmp_path
    storage.init_workspace(root)
    storage.create_project(root, "Meal Planner", slug="meal-planner")
    project = storage.project_dir(root, "meal-planner")
    viewers = project / "viewers"
    artifacts = project / "artifacts"
    viewers.mkdir(parents=True)
    artifacts.mkdir(parents=True)
    (viewers / "manifest.json").write_text(
        json.dumps(
            {
                "viewers": [
                    {
                        "id": "meal-dashboard",
                        "title": "Meal Dashboard",
                        "entry": "meal-dashboard.viewer.js",
                        "payload": {"artifacts": ["artifacts/nutrition.json", "artifacts/meals.csv"]},
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (viewers / "meal-dashboard.viewer.js").write_text("console.log('viewer')", encoding="utf-8")
    (artifacts / "nutrition.json").write_text(json.dumps({"kcal": 1800}), encoding="utf-8")
    (artifacts / "meals.csv").write_text("date,kcal\n2026-05-18,1800\n", encoding="utf-8")
    (artifacts / "ignored.md").write_text("# ignored", encoding="utf-8")

    payload = project_viewers.trusted_viewer_payload(root, "meal-planner", "meal-dashboard")

    assert payload["viewerId"] == "meal-dashboard"
    assert [item["path"] for item in payload["artifacts"]] == [
        "artifacts/meals.csv",
        "artifacts/nutrition.json",
    ]
    assert payload["artifacts"][0]["rows"][0]["kcal"] == "1800"
    assert payload["artifacts"][1]["json"]["kcal"] == 1800


def test_trusted_viewer_payload_includes_declared_linked_resource_aliases(tmp_path):
    root = tmp_path
    storage.init_workspace(root)
    storage.create_project(root, "Food", slug="food")
    storage.create_project(root, "Diet", slug="diet")
    (storage.project_dir(root, "food") / "aiws.yaml").write_text(
        """
version: 1
resource_exports:
  - resourceType: nutrition_snapshot
    artifactPattern: artifacts/nutrition-snapshot.json
    schemaVersion: "1"
commands:
""".strip(),
        encoding="utf-8",
    )
    diet = storage.project_dir(root, "diet")
    (diet / "aiws.yaml").write_text(
        """
version: 1
resource_imports:
  - sourceProjectId: food
    acceptedResourceType: nutrition_snapshot
    localAlias: foods
commands:
""".strip(),
        encoding="utf-8",
    )
    viewers = diet / "viewers"
    viewers.mkdir(parents=True)
    (viewers / "manifest.json").write_text(
        json.dumps(
            {
                "viewers": [
                    {
                        "id": "diet-dashboard",
                        "title": "Diet Dashboard",
                        "entry": "diet-dashboard.viewer.js",
                        "payload": {"linkedResources": ["foods"]},
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (viewers / "diet-dashboard.viewer.js").write_text("console.log('viewer')", encoding="utf-8")
    artifacts = storage.project_dir(root, "food") / "artifacts"
    artifacts.mkdir(parents=True)
    (artifacts / "nutrition-snapshot.json").write_text('{"kcal":520}', encoding="utf-8")
    link = project_connections.request_link(
        root,
        source_project="food",
        target_project="diet",
        allowed_resource_types=["nutrition_snapshot"],
        mode="read",
        actor="owner",
    )
    project_connections.approve_link(root, link_id=link["linkId"], actor="owner")

    payload = project_viewers.trusted_viewer_payload(root, "diet", "diet-dashboard")

    assert payload["linkedResources"][0]["alias"] == "foods"
    assert payload["linkedResources"][0]["artifact"]["json"]["kcal"] == 520
