import re
import stat
from pathlib import Path

from .trust import config_key

HIDDEN = stat.FILE_ATTRIBUTE_HIDDEN | stat.FILE_ATTRIBUTE_SYSTEM
NEW_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}


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


def folder_info(workspace: Path, trusted: set[str]) -> list[dict]:
    """What the dashboard shows per folder: Claude Code trust (exact path) and whether it is a git repo."""
    return [{"name": name, "trusted": config_key(workspace / name).lower() in trusted,
             "git": (workspace / name / ".git").exists()} for name in list_folders(workspace)]


def valid_new_name(name) -> bool:
    """Names the dashboard may create: plain ASCII, no separators or spaces, not a Windows device name."""
    return (isinstance(name, str) and NEW_NAME.fullmatch(name) is not None and not name.endswith(".")
            and name.split(".")[0].lower() not in RESERVED)
