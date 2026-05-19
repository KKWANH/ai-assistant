import os
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Request

from aiws.api.dependencies import AppContainer
from aiws.api.dto import AdminAnalysisResponse, AdminLogResponse, AdminStatusResponse

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _log_dir() -> Path:
    return Path(os.environ.get("AIWS_LOG_DIR", ".aiws/runtime/logs")).resolve()


@router.get("/status", response_model=AdminStatusResponse)
def admin_status(request: Request) -> AdminStatusResponse:
    container: AppContainer = request.app.state.container
    projects = container.project_service.list_projects()
    session_count = sum(
        len(container.session_service.list_sessions(project.path)) for project in projects
    )
    log_files = tuple(str(path) for path in sorted(_log_dir().glob("*.log")))
    return AdminStatusResponse(
        pid=os.getpid(),
        workspace_root=str(container.workspace_root),
        project_count=len(projects),
        session_count=session_count,
        log_files=log_files,
        generated_at=datetime.now(UTC),
    )


@router.get("/logs", response_model=AdminLogResponse)
def admin_logs(lines: int = 200) -> AdminLogResponse:
    log_path = _log_dir() / "aiws.log"
    if not log_path.exists():
        return AdminLogResponse(path=str(log_path), lines=())
    content = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    return AdminLogResponse(path=str(log_path), lines=tuple(content[-lines:]))


@router.get("/analysis", response_model=AdminAnalysisResponse)
def admin_analysis() -> AdminAnalysisResponse:
    log_path = _log_dir() / "aiws.log"
    if log_path.exists():
        lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    else:
        lines = []
    error_lines = [line for line in lines if "error" in line.lower() or "traceback" in line.lower()]
    warning_lines = [line for line in lines if "warning" in line.lower() or "warn" in line.lower()]
    findings: list[str] = []
    if error_lines:
        findings.append(
            f"{len(error_lines)} error-like log lines found. Review latest error first."
        )
    if warning_lines:
        findings.append(f"{len(warning_lines)} warning-like log lines found.")
    if not findings:
        findings.append("No obvious errors or warnings in the daemon log.")
    return AdminAnalysisResponse(
        generated_at=datetime.now(UTC),
        error_count=len(error_lines),
        warning_count=len(warning_lines),
        findings=tuple(findings),
        metadata={"log_path": str(log_path), "lines_scanned": len(lines)},
    )
