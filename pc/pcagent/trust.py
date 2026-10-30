# Claude Code's per-folder trust lives in ~/.claude.json: projects["C:/path/to/folder"].hasTrustDialogAccepted.
# Remote Control refuses (or, in a console, prompts for) any folder without its own entry, even if a parent folder is
# trusted. The dashboard's Trust button sets the same flag the interactive prompt would.
import json
import os
import shutil
import time
from pathlib import Path

CLAUDE_JSON = Path.home() / ".claude.json"


def config_key(path: Path) -> str:
    return str(path).replace("\\", "/")


def trusted_keys(config: Path = CLAUDE_JSON) -> set[str]:
    """Lowercased project keys with trust accepted (Windows paths are case-insensitive)."""
    try:
        projects = json.loads(config.read_text(encoding="utf-8")).get("projects", {})
    except (OSError, ValueError):
        return set()
    return {k.lower() for k, v in projects.items() if isinstance(v, dict) and v.get("hasTrustDialogAccepted") is True}


def set_trusted(config: Path, folder: Path, attempts=5):
    """Mark folder trusted. Claude Code rewrites this file while it runs, so read it right before writing, swap the
    new file in atomically, keep a backup, and check the result."""
    key = config_key(folder)
    for attempt in range(attempts):
        try:
            data = json.loads(config.read_text(encoding="utf-8")) if config.exists() else {}
        except ValueError as e:
            if attempt == attempts - 1:
                raise RuntimeError("~/.claude.json is not valid JSON; not touching it") from e
            time.sleep(0.2)  # probably caught mid-write by Claude Code; read again
            continue
        if config.exists():
            shutil.copyfile(config, config.with_name(config.name + ".pc-agent.bak"))
        data.setdefault("projects", {}).setdefault(key, {})["hasTrustDialogAccepted"] = True
        tmp = config.with_name(config.name + ".pc-agent.tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        try:
            os.replace(tmp, config)
        except PermissionError:
            time.sleep(0.2)  # file briefly locked by another writer
            continue
        if key.lower() in trusted_keys(config):
            return
    raise RuntimeError("could not update ~/.claude.json")
