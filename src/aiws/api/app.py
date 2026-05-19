from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from aiws.api.dependencies import create_container
from aiws.api.errors import install_error_handlers
from aiws.api.routes import admin, health, messages, projects, sessions, workspace


def create_app(workspace_root: Path | None = None) -> FastAPI:
    app = FastAPI(title="AIWS", version="0.1.0")
    app.state.container = create_container(workspace_root)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)
    app.include_router(health.router)
    app.include_router(workspace.router)
    app.include_router(sessions.router)
    app.include_router(messages.router)
    app.include_router(projects.router)
    app.include_router(admin.router)

    web_dist = Path.cwd() / "web" / "dist"
    if web_dist.exists():
        assets = web_dist / "assets"
        if assets.exists():
            app.mount("/assets", StaticFiles(directory=assets), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa_fallback(full_path: str) -> FileResponse:
            requested = web_dist / full_path
            if requested.exists() and requested.is_file():
                return FileResponse(requested)
            return FileResponse(web_dist / "index.html")

    return app


app = create_app()
