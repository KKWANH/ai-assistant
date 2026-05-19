from pathlib import Path


class PathGuard:
    def __init__(self, root: Path, *, allow_external_paths: bool = False) -> None:
        self.root = root.resolve()
        self.allow_external_paths = allow_external_paths

    def resolve_under_root(self, path: str | Path) -> Path:
        candidate = Path(path)
        if not candidate.is_absolute():
            candidate = self.root / candidate
        resolved = candidate.resolve(strict=False)
        if self.allow_external_paths:
            return resolved
        if resolved == self.root or self.root in resolved.parents:
            return resolved
        raise ValueError(f"Path escapes allowed root: {path}")

    def assert_existing_path_safe(self, path: str | Path) -> Path:
        resolved = self.resolve_under_root(path)
        if resolved.exists() and resolved.is_symlink():
            target = resolved.resolve(strict=True)
            if target != self.root and self.root not in target.parents:
                raise ValueError(f"Symlink escapes allowed root: {path}")
        return resolved
