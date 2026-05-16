"""Action/model/home-workbench API payload builders."""

from __future__ import annotations

from pathlib import Path

from aiws.core import home_workbench, workbench_contracts


def action_library_payload() -> dict[str, object]:
    return {"actions": workbench_contracts.action_library()}


def models_payload() -> dict[str, object]:
    return {"models": workbench_contracts.model_catalog()}


def workbench_contract_payload() -> dict[str, object]:
    return workbench_contracts.workbench_contract()


def home_payload(root: str | Path, username: str | None) -> dict[str, object]:
    return {
        "actions": home_workbench.list_actions(),
        "runs": home_workbench.list_runs(root, username),
        "artifacts": home_workbench.list_artifacts(root, username),
        "views": [
            {
                "id": "home",
                "title": "Home Workbench",
                "layout": "sidebar",
                "panels": [
                    {"id": "starter-actions", "type": "actionLauncher", "title": "Starter Actions", "source": "actions"},
                    {"id": "recent-runs", "type": "runTimeline", "title": "Recent Runs", "source": "runs"},
                    {"id": "recent-artifacts", "type": "artifactGallery", "title": "Recent Artifacts", "source": "artifacts"},
                    {"id": "cost-meter", "type": "costMeter", "title": "Cost / Model", "source": "runtime"},
                ],
            }
        ],
        "message": "Home Workbench is ready for projectless starter actions.",
    }


def home_run_payload(root: str | Path, username: str | None, run_id: str) -> dict[str, object]:
    return home_workbench.read_run_detail(root, username or "local", run_id)


def home_artifact_payload(root: str | Path, username: str | None, artifact_path: str) -> dict[str, object]:
    return {"artifact": home_workbench.read_artifact(root, username or "local", artifact_path)}
