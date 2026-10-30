# Dashboard commands from wol/desktop/pc/cmd. Every command must be signed (see signing.py); folder and mode are
# checked against fixed lists before anything runs, and stop only accepts pids that are Remote Control servers.
import json
import time
from pathlib import Path

from .folders import list_folders
from .sessions import scan_sessions, start_session, stop_session
from .signing import verify

MODES = ("bypassPermissions", "acceptEdits", "auto", "default", "dontAsk", "plan")
MAX_PAYLOAD = 4096


class CommandHandler:
    def __init__(self, secret, workspace: Path, *, start=start_session, stop=stop_session, scan=scan_sessions,
                 clock=time.time, dry_run=False):
        self.secret, self.workspace = secret, workspace
        self.start, self.stop, self.scan, self.clock, self.dry_run = start, stop, scan, clock, dry_run
        self.seen = {}

    def handle(self, payload: bytes):
        """Reply dict for the dashboard, or None when the payload is too broken to answer."""
        if len(payload) > MAX_PAYLOAD:
            return None
        try:
            cmd = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return None
        if not isinstance(cmd, dict) or not isinstance(cmd.get("id"), str):
            return None
        error = verify(cmd, self.secret, int(self.clock()), self.seen)
        if error is None:
            try:
                return {"id": cmd["id"], "ok": True, **self._run(cmd)}
            except CommandError as e:
                error = str(e)
        return {"id": cmd["id"], "ok": False, "error": error}

    def _run(self, cmd):
        action = cmd.get("action")
        if action == "refresh":
            return {}
        if action == "start":
            folder, mode = cmd.get("folder"), cmd.get("mode")
            if folder not in list_folders(self.workspace):
                raise CommandError("unknown folder")
            if mode not in MODES:
                raise CommandError("bad mode")
            # Claude Code allows one server per folder; more chats are opened from claude.ai/code
            if any(s["folder"] == folder for s in self.scan(self.workspace)):
                raise CommandError("already running")
            if self.dry_run:
                return {}
            return {"pid": self.start(self.workspace, folder, mode)}
        if action == "stop":
            pid = cmd.get("pid")
            if pid not in [s["pid"] for s in self.scan(self.workspace)]:
                raise CommandError("not a claude session")
            if not self.dry_run:
                self.stop(pid)
            return {}
        raise CommandError("unknown action")


class CommandError(Exception):
    pass
