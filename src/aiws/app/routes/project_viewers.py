"""Trusted project viewer payload builders."""

from __future__ import annotations

import csv
import fnmatch
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from aiws import storage
from aiws.core import project_connections
from aiws.infra.paths import resolve_under_root

VIEWER_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


def investment_rebalance_payload(root: str | Path, project_path: str) -> dict[str, Any]:
    """Return a composed JSON payload for the built-in investment dashboard viewer."""
    base = storage.project_dir(root, project_path)
    return {
        "viewerId": "investment-rebalance-dashboard",
        "projectId": project_path,
        "summary": investment_summary(base),
        "weights": read_json(base, "artifacts/current-weights.json", {}),
        "gaps": read_json(base, "artifacts/target-gap.json", {}),
        "suggestions": read_csv(base, "artifacts/rebalance-suggestions.csv"),
        "monthlyPerformance": read_csv(base, "artifacts/monthly-performance.csv"),
        "growthChart": read_json(base, "artifacts/portfolio-growth-chart.json", {}),
        "reportMarkdown": read_text(base, "artifacts/rebalance-report.md", ""),
    }


def investment_summary(base: Path) -> dict[str, Any]:
    weights = read_json(base, "artifacts/current-weights.json", {})
    gaps = read_json(base, "artifacts/target-gap.json", {})
    rows = gaps.get("gaps") if isinstance(gaps, dict) else []
    weights_rows = weights.get("weights") if isinstance(weights, dict) else []
    return {
        "totalValue": weights.get("total_value", 0) if isinstance(weights, dict) else 0,
        "assetClasses": len(weights_rows) if isinstance(weights_rows, list) else 0,
        "needsAdd": sum(1 for row in rows if isinstance(row, dict) and row.get("suggestion") == "add") if isinstance(rows, list) else 0,
        "needsTrim": sum(1 for row in rows if isinstance(row, dict) and row.get("suggestion") == "trim") if isinstance(rows, list) else 0,
    }


def read_json(base: Path, relative_path: str, fallback: dict[str, Any]) -> dict[str, Any]:
    path = safe_project_file(base, relative_path)
    if not path.exists():
        return fallback
    value = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    return value if isinstance(value, dict) else fallback


def read_text(base: Path, relative_path: str, fallback: str) -> str:
    path = safe_project_file(base, relative_path)
    if not path.exists():
        return fallback
    return path.read_text(encoding="utf-8", errors="replace")


def read_csv(base: Path, relative_path: str) -> list[dict[str, str]]:
    path = safe_project_file(base, relative_path)
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8", errors="replace", newline="") as file:
        return list(csv.DictReader(file))


def safe_project_file(base: Path, relative_path: str) -> Path:
    return resolve_under_root(base, relative_path)


def trusted_viewer_manifest(root: str | Path, project_path: str) -> dict[str, Any]:
    """Read a project-owned trusted viewer manifest without executing code."""
    base = storage.project_dir(root, project_path)
    manifest_path = safe_project_file(base, "viewers/manifest.json")
    if not manifest_path.exists():
        return {"projectId": project_path, "viewers": [], "build": build_status(base)}
    raw = json.loads(manifest_path.read_text(encoding="utf-8", errors="replace"))
    viewers = raw.get("viewers") if isinstance(raw, dict) else []
    if not isinstance(viewers, list):
        viewers = []
    return {
        "projectId": project_path,
        "viewers": [normalize_manifest_viewer(base, item) for item in viewers if isinstance(item, dict)],
        "build": build_status(base),
    }


def normalize_manifest_viewer(base: Path, item: dict[str, Any]) -> dict[str, Any]:
    viewer_id = str(item.get("id") or "").strip()
    if not VIEWER_ID_RE.match(viewer_id):
        raise storage.WorkspaceError("Trusted viewer id must be alphanumeric, dash, or underscore.")
    entry = str(item.get("entry") or "").strip()
    if not entry:
        raise storage.WorkspaceError("Trusted viewer manifest entry is required.")
    entry_path = safe_project_file(base, f"viewers/{entry}" if not entry.startswith("viewers/") else entry)
    return {
        "id": viewer_id,
        "title": str(item.get("title") or viewer_id),
        "description": str(item.get("description") or ""),
        "entry": entry_path.relative_to(base).as_posix(),
        "sandbox": "allow-scripts",
        "framePath": f"frame/{viewer_id}",
        "assetPath": f"asset/{viewer_id}.js",
        "payload": item.get("payload", {}) if isinstance(item.get("payload", {}), dict) else {},
        "exists": entry_path.exists(),
    }


def reload_trusted_viewers(root: str | Path, project_path: str) -> dict[str, Any]:
    """Build trusted local viewer entries into iframe-loadable browser assets."""
    base = storage.project_dir(root, project_path)
    manifest = trusted_viewer_manifest(root, project_path)
    build_dir = safe_project_file(base, ".aiws-viewers")
    build_dir.mkdir(parents=True, exist_ok=True)
    builds = [build_viewer_asset(base, build_dir, item, project_path) for item in manifest["viewers"]]
    failed = [item for item in builds if item.get("status") != "built"]
    status = {
        "status": "empty" if not manifest["viewers"] else ("ready" if not failed else "partial"),
        "viewerCount": len(manifest["viewers"]),
        "builtCount": len([item for item in builds if item.get("status") == "built"]),
        "updatedAt": storage.utc_now(),
        "mode": "bundle",
        "viewers": builds,
    }
    storage.write_json(build_dir / "build.json", status)
    return {"projectId": project_path, "build": status, "manifest": trusted_viewer_manifest(root, project_path)}


def build_viewer_asset(base: Path, build_dir: Path, viewer: dict[str, Any], project_path: str) -> dict[str, Any]:
    viewer_id = str(viewer.get("id") or "")
    entry = safe_project_file(base, str(viewer.get("entry") or ""))
    output = safe_project_file(base, f".aiws-viewers/{viewer_id}.js")
    if not entry.exists():
        return {"id": viewer_id, "status": "missing_entry", "entry": str(viewer.get("entry") or "")}
    if entry.suffix.lower() == ".js":
        shutil.copyfile(entry, output)
        return {"id": viewer_id, "status": "built", "asset": output.relative_to(base).as_posix(), "mode": "copy-js"}
    esbuild = find_esbuild()
    if not esbuild:
        return {"id": viewer_id, "status": "missing_bundler", "entry": entry.relative_to(base).as_posix(), "mode": "tsx"}
    wrapper = build_dir / f"__{viewer_id}.entry.tsx"
    payload_url = f"/api/project-viewers/{project_path}/{viewer_id}/payload"
    wrapper.write_text(
        "\n".join(
            [
                'import React, { useEffect, useState } from "react";',
                'import { createRoot } from "react-dom/client";',
                f'import Viewer from {json.dumps(entry.as_posix())};',
                f'const endpoint = {json.dumps(payload_url)};',
                'function AIWSViewerHost() {',
                '  const [payload, setPayload] = useState<any>(null);',
                '  const [error, setError] = useState("");',
                '  useEffect(() => {',
                '    fetch(endpoint, { credentials: "include" })',
                '      .then((response) => { if (!response.ok) throw new Error(`viewer payload ${response.status}`); return response.json(); })',
                '      .then(setPayload)',
                '      .catch((err) => setError(String(err)));',
                '  }, []);',
                '  if (error) return <pre>{error}</pre>;',
                '  if (!payload) return <p>Loading viewer payload...</p>;',
                '  return <Viewer endpoint={endpoint} payload={payload} />;',
                '}',
                'createRoot(document.getElementById("root")!).render(<AIWSViewerHost />);',
                "",
            ]
        ),
        encoding="utf-8",
    )
    completed = subprocess.run(
        [
            str(esbuild),
            str(wrapper),
            "--bundle",
            "--format=esm",
            "--platform=browser",
            "--jsx=automatic",
            f"--outfile={output}",
            "--define:process.env.NODE_ENV=\"production\"",
        ],
        cwd=repo_root(),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
        check=False,
    )
    if completed.returncode != 0:
        return {
            "id": viewer_id,
            "status": "build_failed",
            "entry": entry.relative_to(base).as_posix(),
            "stderr": completed.stderr[-1000:],
        }
    return {"id": viewer_id, "status": "built", "asset": output.relative_to(base).as_posix(), "mode": "tsx-bundle"}


def find_esbuild() -> Path | None:
    root = repo_root()
    candidates = [
        root / "web" / "node_modules" / ".bin" / "esbuild",
        root / "node_modules" / ".bin" / "esbuild",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    found = shutil.which("esbuild")
    return Path(found) if found else None


def repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def build_status(base: Path) -> dict[str, Any]:
    path = safe_project_file(base, ".aiws-viewers/build.json")
    if not path.exists():
        return {"status": "not_built", "viewerCount": 0, "mode": "bundle"}
    value = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    return value if isinstance(value, dict) else {"status": "unknown", "viewerCount": 0, "mode": "bundle"}


def trusted_viewer_frame_html(root: str | Path, project_path: str, viewer_id: str) -> str:
    manifest = trusted_viewer_manifest(root, project_path)
    viewer = next((item for item in manifest["viewers"] if item.get("id") == viewer_id), None)
    if not viewer:
        raise storage.WorkspaceError("Unknown trusted viewer.")
    title = str(viewer.get("title") or viewer_id)
    payload_url = f"/api/project-viewers/{project_path}/{viewer_id}/payload"
    asset = safe_project_file(storage.project_dir(root, project_path), f".aiws-viewers/{viewer_id}.js")
    asset_url = f"/project-viewers/{project_path}/asset/{viewer_id}.js" if asset.exists() else ""
    script = (
        f'<script>window.AIWS_VIEWER_PAYLOAD_URL = {json.dumps(payload_url)};</script>\n'
        f'    <script type="module" src="{html_escape(asset_url)}"></script>'
        if asset_url
        else f"""
    <script>
      fetch({json.dumps(payload_url)}, {{ credentials: "include" }})
        .then((response) => response.json())
        .then((payload) => {{ document.getElementById("payload").textContent = JSON.stringify(payload, null, 2); }})
        .catch((error) => {{ document.getElementById("payload").textContent = String(error); }});
    </script>"""
    )
    return f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{html_escape(title)}</title>
    <style>
      body {{ margin: 0; font-family: system-ui, sans-serif; background: #081018; color: #e8f1ff; }}
      main {{ padding: 20px; }}
      pre {{ white-space: pre-wrap; background: #111b28; border: 1px solid #26364a; padding: 12px; border-radius: 8px; }}
    </style>
  </head>
  <body>
    <main>
      <h1>{html_escape(title)}</h1>
      <div id="root"></div>
      <pre id="payload">{"Loading payload..." if not asset_url else ""}</pre>
    </main>
    {script}
  </body>
</html>"""


def trusted_viewer_asset(root: str | Path, project_path: str, asset_name: str) -> bytes:
    if not asset_name.endswith(".js") or not VIEWER_ID_RE.match(asset_name[:-3]):
        raise storage.WorkspaceError("Invalid trusted viewer asset.")
    path = safe_project_file(storage.project_dir(root, project_path), f".aiws-viewers/{asset_name}")
    if not path.exists() or not path.is_file():
        raise storage.WorkspaceError("Trusted viewer asset not built.")
    return path.read_bytes()


def trusted_viewer_payload(root: str | Path, project_path: str, viewer_id: str) -> dict[str, Any]:
    """Return the manifest-declared payload for a trusted viewer."""
    manifest = trusted_viewer_manifest(root, project_path)
    viewer = next((item for item in manifest["viewers"] if item.get("id") == viewer_id), None)
    if not viewer:
        raise storage.WorkspaceError("Unknown trusted viewer.")
    if viewer_id == "investment-rebalance-dashboard" and not viewer.get("payload"):
        return investment_rebalance_payload(root, project_path)
    base = storage.project_dir(root, project_path)
    payload = viewer.get("payload") if isinstance(viewer.get("payload"), dict) else {}
    artifact_patterns = payload.get("artifacts") if isinstance(payload, dict) else None
    patterns = [str(item) for item in artifact_patterns] if isinstance(artifact_patterns, list) else ["artifacts/**/*"]
    return {
        "viewerId": viewer_id,
        "projectId": project_path,
        "title": viewer.get("title", viewer_id),
        "payload": payload,
        "artifacts": [artifact_payload(base, path) for path in matching_artifacts(base, patterns)],
        "linkedResources": linked_resource_payloads(root, project_path, payload),
    }


def linked_resource_payloads(root: str | Path, project_path: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    requested = payload.get("linkedResources") or payload.get("resources") or payload.get("aliases")
    aliases = {str(item) for item in requested} if isinstance(requested, list) else set()
    resolved = project_connections.payload(root, project_path, None).get("resolvedImports", [])
    if not isinstance(resolved, list):
        return []
    items: list[dict[str, Any]] = []
    for item in resolved:
        if not isinstance(item, dict):
            continue
        alias = str(item.get("localAlias") or "")
        if aliases and alias not in aliases:
            continue
        artifact = item.get("latestArtifact")
        if not isinstance(artifact, dict) or not artifact.get("path"):
            continue
        source_project = str(item.get("sourceProjectId") or "")
        path = safe_project_file(storage.project_dir(root, source_project), str(artifact["path"]))
        if not path.exists() or not path.is_file():
            continue
        items.append(
            {
                "alias": alias,
                "sourceProjectId": source_project,
                "resourceType": item.get("resourceType", ""),
                "mode": item.get("mode", "read"),
                "linkId": item.get("linkId", ""),
                "artifact": artifact_payload(storage.project_dir(root, source_project), path),
            }
        )
    return items


def matching_artifacts(base: Path, patterns: list[str]) -> list[Path]:
    artifacts_root = safe_project_file(base, "artifacts")
    if not artifacts_root.exists():
        return []
    matches: list[Path] = []
    for path in sorted(artifacts_root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(base).as_posix()
        if any(fnmatch.fnmatch(rel, pattern) for pattern in patterns):
            matches.append(path)
    return matches[:100]


def artifact_payload(base: Path, path: Path) -> dict[str, Any]:
    rel = path.relative_to(base).as_posix()
    suffix = path.suffix.lower()
    size = path.stat().st_size
    item: dict[str, Any] = {"path": rel, "name": path.name, "type": artifact_type(suffix), "size": size}
    if size > 1_000_000:
        item["content_truncated"] = True
        return item
    if suffix == ".json":
        try:
            item["json"] = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except json.JSONDecodeError:
            item["text"] = path.read_text(encoding="utf-8", errors="replace")
        return item
    if suffix == ".csv":
        item["rows"] = read_csv(base, rel)
        item["text"] = path.read_text(encoding="utf-8", errors="replace")
        return item
    if suffix in {".md", ".txt", ".yaml", ".yml", ".log"}:
        item["text"] = path.read_text(encoding="utf-8", errors="replace")
    return item


def artifact_type(suffix: str) -> str:
    if suffix == ".json":
        return "json"
    if suffix == ".csv":
        return "table"
    if suffix == ".md":
        return "markdown"
    if suffix in {".txt", ".log", ".yaml", ".yml"}:
        return "text"
    return "file"


def html_escape(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
