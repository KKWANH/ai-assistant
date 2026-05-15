.PHONY: test lint format-check typecheck security audit frontend-build ci

test:
	python -m pytest

lint:
	python -m ruff check src tests

format-check:
	python -m ruff format --check src tests

typecheck:
	python -m mypy src/aiws/infra src/aiws/tools src/aiws/core/context_manifest.py src/aiws/core/context_receipts.py

security:
	python -m bandit -q -c pyproject.toml -r src

audit:
	python -m pip_audit

frontend-build:
	cd web && npm run build

ci: lint format-check typecheck security test frontend-build
