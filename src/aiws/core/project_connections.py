"""Explicit project-to-project resource links.

Project links are intentionally separate from the project nesting model. A
project may only see another project's exported resource metadata when an
approved link exists.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import uuid4

from aiws import storage
from aiws.core import action_registry, contracts


CONNECTIONS_FILE = "connections.json"


def connections_path(root: str | Path, project_path: str) -> Path:
    return storage.project_dir(root, project_path) / CONNECTIONS_FILE


def load_outgoing(root: str | Path, project_path: str) -> list[dict[str, Any]]:
    storage.ensure_project_exists(root, project_path)
    path = connections_path(root, project_path)
    if not path.exists():
        return []
    data = storage.read_json(path)
    links = data.get("links") if isinstance(data.get("links"), list) else []
    return [normalize_link(item) for item in links if isinstance(item, dict)]


def save_outgoing(root: str | Path, project_path: str, links: list[dict[str, Any]]) -> None:
    path = connections_path(root, project_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    storage.write_json(path, {"links": [normalize_link(item) for item in links]})


def payload(root: str | Path, project_path: str, username: str | None) -> dict[str, Any]:
    storage.ensure_project_exists(root, project_path)
    all_links = list_all_links(root)
    incoming = [item for item in all_links if item.get("toProject") == project_path and item.get("status") != "revoked"]
    outgoing = [item for item in all_links if item.get("fromProject") == project_path and item.get("status") != "revoked"]
    current_exports = exports_for_project(root, project_path)
    configured_imports = imports_for_project(root, project_path)
    connected_resources = []
    for link in incoming:
        if link.get("status") != "approved":
            continue
        for item in exports_for_project(root, str(link.get("fromProject", ""))):
            if item.get("resourceType") in set(link.get("allowedResourceTypes") or []):
                connected_resources.append(
                    {
                        **item,
                        "sourceProjectId": link.get("fromProject"),
                        "mode": link.get("mode", "read"),
                        "linkId": link.get("linkId"),
                    }
                )

    visible_sources = []
    for project in storage.list_visible_projects(root, username):
        source_path = str(project.get("path", ""))
        if not source_path or source_path == project_path or project.get("hidden"):
            continue
        visible_sources.append(
            {
                "projectId": source_path,
                "title": project.get("title") or source_path,
                "exports": exports_for_project(root, source_path),
            }
        )

    return {
        "projectId": project_path,
        "exports": current_exports,
        "imports": configured_imports,
        "incomingLinks": incoming,
        "outgoingLinks": outgoing,
        "connectedResources": connected_resources,
        "resolvedImports": resolved_imports(root, project_path, configured_imports, connected_resources),
        "visibleSources": visible_sources,
    }


def resolved_imports(
    root: str | Path,
    project_path: str,
    configured_imports: list[dict[str, Any]],
    connected_resources: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Resolve approved linked resources into local aliases usable by Workflow Apps."""
    resolved: list[dict[str, Any]] = []
    for item in configured_imports:
        source_project = str(item.get("sourceProjectId") or "")
        resource_type = str(item.get("acceptedResourceType") or "")
        alias = str(item.get("localAlias") or resource_type)
        match = next(
            (
                resource
                for resource in connected_resources
                if resource.get("sourceProjectId") == source_project and resource.get("resourceType") == resource_type
            ),
            None,
        )
        if not match:
            continue
        latest = latest_artifact_for_pattern(root, source_project, str(match.get("artifactPattern") or ""))
        resolved.append(
            {
                "sourceProjectId": source_project,
                "resourceType": resource_type,
                "localAlias": alias,
                "mode": match.get("mode", "read"),
                "linkId": match.get("linkId", ""),
                "artifactPattern": match.get("artifactPattern", ""),
                "latestArtifact": latest,
                "projectId": project_path,
            }
        )
    return resolved


def latest_artifact_for_pattern(root: str | Path, project_path: str, artifact_pattern: str) -> dict[str, Any] | None:
    if not artifact_pattern or ".." in Path(artifact_pattern).parts or artifact_pattern.startswith("/"):
        return None
    base = storage.project_dir(root, project_path)
    matches = [path for path in base.glob(artifact_pattern) if path.is_file()]
    if not matches:
        return None
    latest = max(matches, key=lambda path: path.stat().st_mtime)
    return {
        "path": latest.relative_to(base).as_posix(),
        "size": latest.stat().st_size,
        "updatedAt": storage.datetime_from_timestamp(latest.stat().st_mtime) if hasattr(storage, "datetime_from_timestamp") else storage.utc_now(),
    }


def request_link(
    root: str | Path,
    *,
    source_project: str,
    target_project: str,
    allowed_resource_types: list[str],
    mode: str,
    actor: str | None,
) -> dict[str, Any]:
    storage.ensure_project_exists(root, source_project)
    storage.ensure_project_exists(root, target_project)
    requested = [item for item in allowed_resource_types if item]
    if not requested:
        raise storage.WorkspaceError("Choose at least one resource type to connect.")
    links = load_outgoing(root, source_project)
    existing = next(
        (
            item
            for item in links
            if item.get("toProject") == target_project
            and item.get("mode") == mode
            and set(item.get("allowedResourceTypes") or []) == set(requested)
            and item.get("status") != "revoked"
        ),
        None,
    )
    if existing:
        return existing
    link = contracts.project_link_contract(
        link_id=f"link-{uuid4().hex[:12]}",
        from_project=source_project,
        to_project=target_project,
        allowed_resource_types=requested,
        mode=mode,
        granted_by=actor or "",
        created_at=storage.utc_now(),
        status="pending",
    )
    links.append(link)
    save_outgoing(root, source_project, links)
    return link


def approve_link(root: str | Path, *, link_id: str, actor: str | None) -> dict[str, Any]:
    source_project, links, link = find_link(root, link_id)
    updated = contracts.project_link_contract(
        link_id=str(link["linkId"]),
        from_project=str(link["fromProject"]),
        to_project=str(link["toProject"]),
        allowed_resource_types=list(link.get("allowedResourceTypes") or []),
        mode=str(link.get("mode") or "read"),
        granted_by=actor or "",
        created_at=str(link.get("createdAt") or storage.utc_now()),
        status="approved",
    )
    replace_link(links, updated)
    save_outgoing(root, source_project, links)
    return updated


def revoke_link(root: str | Path, *, link_id: str, actor: str | None) -> dict[str, Any]:
    source_project, links, link = find_link(root, link_id)
    updated = contracts.project_link_contract(
        link_id=str(link["linkId"]),
        from_project=str(link["fromProject"]),
        to_project=str(link["toProject"]),
        allowed_resource_types=list(link.get("allowedResourceTypes") or []),
        mode=str(link.get("mode") or "read"),
        granted_by=actor or str(link.get("grantedBy") or ""),
        created_at=str(link.get("createdAt") or storage.utc_now()),
        status="revoked",
    )
    replace_link(links, updated)
    save_outgoing(root, source_project, links)
    return updated


def find_link(root: str | Path, link_id: str) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    for project in storage.list_projects(root):
        project_path = str(project.get("path", ""))
        links = load_outgoing(root, project_path)
        for link in links:
            if link.get("linkId") == link_id:
                return project_path, links, link
    raise storage.WorkspaceError("Project link was not found.")


def list_all_links(root: str | Path) -> list[dict[str, Any]]:
    links: list[dict[str, Any]] = []
    for project in storage.list_projects(root):
        project_path = str(project.get("path", ""))
        if project_path:
            links.extend(load_outgoing(root, project_path))
    return links


def exports_for_project(root: str | Path, project_path: str) -> list[dict[str, Any]]:
    config = action_registry.load_config(root, project_path)
    configured = config.get("resource_exports") if isinstance(config.get("resource_exports"), list) else []
    exports = [normalize_export(project_path, item) for item in configured if isinstance(item, dict)]
    seen = {item["resourceType"] for item in exports}
    for app in config.get("workflow_apps", []):
        if not isinstance(app, dict):
            continue
        for artifact in app.get("outputSchema", []) if isinstance(app.get("outputSchema"), list) else []:
            if not isinstance(artifact, dict):
                continue
            resource_type = str(artifact.get("id") or Path(str(artifact.get("path", ""))).stem).replace("-", "_")
            if resource_type in seen:
                continue
            exports.append(
                contracts.resource_export_contract(
                    project_id=project_path,
                    resource_type=resource_type,
                    artifact_pattern=str(artifact.get("path") or "artifacts/*"),
                    schema_version="1",
                    label=str(artifact.get("description") or resource_type.replace("_", " ").title()),
                )
            )
            seen.add(resource_type)
    if not exports:
        exports.append(
            contracts.resource_export_contract(
                project_id=project_path,
                resource_type="project_report",
                artifact_pattern="artifacts/*.md",
                schema_version="1",
                label="Project reports",
            )
        )
    return exports


def imports_for_project(root: str | Path, project_path: str) -> list[dict[str, Any]]:
    config = action_registry.load_config(root, project_path)
    configured = config.get("resource_imports") if isinstance(config.get("resource_imports"), list) else []
    return [normalize_import(item) for item in configured if isinstance(item, dict)]


def normalize_link(item: dict[str, Any]) -> dict[str, Any]:
    return contracts.project_link_contract(
        link_id=str(item.get("linkId") or item.get("link_id") or f"link-{uuid4().hex[:12]}"),
        from_project=str(item.get("fromProject") or item.get("from_project") or ""),
        to_project=str(item.get("toProject") or item.get("to_project") or ""),
        allowed_resource_types=[str(value) for value in item.get("allowedResourceTypes", []) if str(value).strip()],
        mode=str(item.get("mode") or "read"),
        granted_by=str(item.get("grantedBy") or item.get("granted_by") or ""),
        created_at=str(item.get("createdAt") or item.get("created_at") or storage.utc_now()),
        status=str(item.get("status") or "pending"),
    )


def normalize_export(project_path: str, item: dict[str, Any]) -> dict[str, Any]:
    return contracts.resource_export_contract(
        project_id=str(item.get("projectId") or item.get("project_id") or project_path),
        resource_type=str(item.get("resourceType") or item.get("resource_type") or "project_report"),
        artifact_pattern=str(item.get("artifactPattern") or item.get("artifact_pattern") or "artifacts/*"),
        schema_version=str(item.get("schemaVersion") or item.get("schema_version") or "1"),
        label=str(item.get("label") or ""),
    )


def normalize_import(item: dict[str, Any]) -> dict[str, Any]:
    return contracts.resource_import_contract(
        source_project_id=str(item.get("sourceProjectId") or item.get("source_project_id") or ""),
        accepted_resource_type=str(item.get("acceptedResourceType") or item.get("accepted_resource_type") or ""),
        local_alias=str(item.get("localAlias") or item.get("local_alias") or ""),
        status=str(item.get("status") or "pending"),
    )


def replace_link(links: list[dict[str, Any]], updated: dict[str, Any]) -> None:
    for index, item in enumerate(links):
        if item.get("linkId") == updated.get("linkId"):
            links[index] = updated
            return
    links.append(updated)
