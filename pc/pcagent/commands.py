# Dashboard commands from wol/desktop/pc/cmd. Every command must be signed (see signing.py); folder and mode are
# checked against fixed lists before anything runs, and stop only accepts pids that are Remote Control servers.
import json
import subprocess
import time
from pathlib import Path

import psutil

from .folders import list_folders, valid_new_name
from .sessions import scan_sessions, start_session, stop_session
from .signing import sign, verify
from .trust import CLAUDE_JSON, config_key, set_trusted, trusted_keys

MODES = ("bypassPermissions", "acceptEdits", "auto", "default", "dontAsk", "plan")
MAX_PAYLOAD = 4096
INITS = ("git", "none")


def git_init(path: Path):
    r = subprocess.run(["git", "init", "-q"], cwd=path, capture_output=True, text=True,
                       creationflags=subprocess.CREATE_NO_WINDOW)
    if r.returncode != 0:
        raise RuntimeError("git init failed")


class CommandHandler:
    def __init__(self, secret, workspace: Path, *, start=start_session, stop=stop_session, scan=scan_sessions,
                 clock=time.time, dry_run=False, trusted=lambda: trusted_keys(CLAUDE_JSON),
                 trust=lambda path: set_trusted(CLAUDE_JSON, path), git_init=git_init):
        self.secret, self.workspace = secret, workspace
        self.start, self.stop, self.scan, self.clock, self.dry_run = start, stop, scan, clock, dry_run
        self.trusted, self.trust, self.git_init = trusted, trust, git_init
        self.seen = {}
        # The replay cache is in memory, so anything signed before we started could be a replay
        self.started_at = int(clock())

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
        now = int(self.clock())
        error = verify(cmd, self.secret, now, self.seen)
        if error is None and cmd["ts"] < self.started_at:
            error = "stale"
        if error == "stale":
            error = f"stale: PC clock {now}, command ts {cmd['ts']} (clocks out of sync, or sent before agent start)"
        if error is None:
            try:
                return self._signed({"id": cmd["id"], "ok": True, **self._run(cmd)})
            except CommandError as e:
                error = str(e)
        return self._signed({"id": cmd["id"], "ok": False, "error": error})

    def _signed(self, reply):
        # Signed so a broker-login holder can't fake a result in the dashboard
        return {**reply, "sig": sign(reply, self.secret)}

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
            # Remote Control would refuse it, or wait at a trust prompt in the hidden console
            if config_key(self.workspace / folder).lower() not in self.trusted():
                raise CommandError("folder not trusted")
            # Claude Code allows one server per folder; more chats are opened from claude.ai/code
            if any(s["folder"].lower() == folder.lower() for s in self.scan(self.workspace)):
                raise CommandError("already running")
            if self.dry_run:
                return {}
            try:
                return {"pid": self.start(self.workspace, folder, mode)}
            except (OSError, RuntimeError) as e:
                raise CommandError(str(e)) from e
        if action == "stop":
            pid = cmd.get("pid")
            if pid not in [s["pid"] for s in self.scan(self.workspace)]:
                raise CommandError("not a claude session")
            if not self.dry_run:
                try:
                    self.stop(pid)
                except psutil.AccessDenied as e:
                    raise CommandError("access denied") from e
            return {}
        if action == "trust":
            folder = cmd.get("folder")
            if folder not in list_folders(self.workspace):
                raise CommandError("unknown folder")
            if not self.dry_run:
                self._trust(self.workspace / folder)
            return {}
        if action == "create":
            folder, init = cmd.get("folder"), cmd.get("init")
            if not valid_new_name(folder):
                raise CommandError("bad folder name")
            if init not in INITS:
                raise CommandError("bad init")
            path = self.workspace / folder
            if path.exists() or folder.lower() in (f.lower() for f in list_folders(self.workspace)):
                raise CommandError("folder exists")
            if self.dry_run:
                return {}
            path.mkdir()
            if init == "git":
                try:
                    self.git_init(path)
                except (OSError, RuntimeError) as e:
                    raise CommandError(str(e)) from e
            # Created just now by the owner and empty: no hooks or settings to review
            self._trust(path)
            return {}
        raise CommandError("unknown action")

    def _trust(self, path):
        try:
            self.trust(path)
        except (OSError, RuntimeError) as e:
            raise CommandError(str(e)) from e


class CommandError(Exception):
    pass
