from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(FileNotFoundError)
    async def file_not_found_handler(_: Request, exc: FileNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"error": str(exc) or "Not found"})

    @app.exception_handler(ValueError)
    async def value_error_handler(_: Request, exc: ValueError) -> JSONResponse:
        return JSONResponse(status_code=400, content={"error": str(exc)})

    @app.exception_handler(ValidationError)
    async def validation_error_handler(_: Request, exc: ValidationError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"error": exc.errors()})
