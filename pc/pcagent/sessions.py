# Claude Code Remote Control servers on this PC: find, start, stop.
# The list always comes from the live process table, so it survives agent restarts and includes the
# server start-remote.ps1 launches at boot.
import ntpath
import shutil
import subprocess
from pathlib import Path

import psutil

SW_SHOWMINNOACTIVE = 7


def claude_exe():
    return shutil.which("claude") or str(Path.home() / ".local" / "bin" / "claude.exe")


def session_argv(claude, folder, mode):
    # --name=<folder> as one element: a folder name can never be read as a separate flag
    return [claude, "remote-control", f"--name={folder}", "--permission-mode", mode]


def _flag(cmdline, name):
    for i, arg in enumerate(cmdline):
        if arg.startswith(name + "="):
            return arg[len(name) + 1:]
        if arg == name and i + 1 < len(cmdline):
            return cmdline[i + 1]
    return None


def scan_sessions(workspace: Path, procs=None):
    if procs is None:
        procs = psutil.process_iter(["pid", "name", "cmdline", "create_time"])
    ws = ntpath.normcase(str(workspace))
    found = []
    for p in procs:
        info = p.info
        cmdline = info.get("cmdline") or []
        # argv[1] check: the desktop app and the VS Code extension also run a Claude.exe, and each chat is a child
        # claude.exe --print ... of its server
        if (info.get("name") or "").lower() != "claude.exe" or len(cmdline) < 2 or cmdline[1] != "remote-control":
            continue
        try:
            cwd = p.cwd()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        parent, leaf = ntpath.split(cwd.rstrip("\\/"))
        found.append({
            "pid": info["pid"],
            "folder": leaf if ntpath.normcase(parent) == ws else cwd,
            "name": _flag(cmdline, "--name"),
            "mode": _flag(cmdline, "--permission-mode"),
            "started": int(info.get("create_time") or 0),
        })
    return sorted(found, key=lambda s: s["started"])


def start_session(workspace: Path, folder, mode, popen=subprocess.Popen):
    """Start a server in its own minimized console so it outlives the agent. Returns its pid."""
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    si.wShowWindow = SW_SHOWMINNOACTIVE
    proc = popen(session_argv(claude_exe(), folder, mode), cwd=str(workspace / folder),
                 creationflags=subprocess.CREATE_NEW_CONSOLE, startupinfo=si)
    return proc.pid


def stop_session(pid):
    root = psutil.Process(pid)
    procs = root.children(recursive=True) + [root]  # chats first, then the server
    for p in procs:
        try:
            p.terminate()
        except psutil.NoSuchProcess:
            pass
    _, alive = psutil.wait_procs(procs, timeout=5)
    for p in alive:
        try:
            p.kill()
        except psutil.NoSuchProcess:
            pass
