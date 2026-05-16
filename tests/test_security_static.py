from pathlib import Path


def test_frontend_has_no_runtime_plugin_code_execution_paths():
    root = Path("web/src")
    forbidden = ["eval(", "new Function(", "import("]
    offenders: list[str] = []
    for path in root.rglob("*"):
        if path.suffix not in {".js", ".jsx", ".ts", ".tsx"}:
            continue
        text = path.read_text(encoding="utf-8")
        for token in forbidden:
            if token in text:
                offenders.append(f"{path}:{token}")
    assert offenders == []
