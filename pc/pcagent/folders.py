import stat
from pathlib import Path

HIDDEN = stat.FILE_ATTRIBUTE_HIDDEN | stat.FILE_ATTRIBUTE_SYSTEM


def _listed(p: Path):
    # Real, visible directories only: a junction or symlink could point outside the workspace
    if p.name.startswith(".") or p.is_symlink() or p.is_junction() or not p.is_dir():
        return False
    return not (p.stat().st_file_attributes & HIDDEN)


def list_folders(workspace: Path) -> list[str]:
    """Names of the direct subfolders of the workspace a session may be started in."""
    if not workspace.is_dir():
        return []
    return sorted(p.name for p in workspace.iterdir() if _listed(p))
