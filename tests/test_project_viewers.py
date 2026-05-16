import json

from aiws import storage
from aiws.app.routes import project_viewers


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
    assert "/api/project-viewers/investment-advisor/investment-rebalance" in frame
    asset = project_viewers.trusted_viewer_asset(root, "investment-advisor", "investment-rebalance-dashboard.js")
    assert b"custom investment viewer" in asset
