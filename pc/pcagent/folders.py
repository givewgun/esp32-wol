from pathlib import Path


def list_folders(workspace: Path) -> list[str]:
    """Names of the direct subfolders of the workspace a session may be started in."""
    if not workspace.is_dir():
        return []
    return sorted(p.name for p in workspace.iterdir() if p.is_dir() and not p.name.startswith("."))
