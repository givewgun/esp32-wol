import subprocess
from pathlib import Path

import psutil

from pcagent import sessions
from pcagent.sessions import scan_sessions, session_argv, start_session

WS = Path(r"C:\Users\gunka\workspace")
CLAUDE = r"C:\Users\gunka\.local\bin\claude.exe"


class FakeProc:
    def __init__(self, pid, name, cmdline, cwd, created=100.0):
        self.pid = pid
        self.info = {"pid": pid, "name": name, "cmdline": cmdline, "create_time": created}
        self._cwd = cwd

    def cwd(self):
        if isinstance(self._cwd, Exception):
            raise self._cwd
        return self._cwd


def test_spawn_argv_passes_folder_as_single_name_element():
    argv = session_argv(CLAUDE, "-x; rm", "plan")
    # --spawn same-dir answers the spawn-mode prompt a git repo would otherwise show in the hidden console
    assert argv == [CLAUDE, "remote-control", "--name=-x; rm", "--permission-mode", "plan", "--spawn", "same-dir"]


def test_start_session_uses_cwd_and_new_console(tmp_path):
    (tmp_path / "horizon").mkdir()
    calls = {}

    class Popen:
        def __init__(self, argv, **kw):
            calls["argv"], calls["kw"] = argv, kw
            self.pid = 4242

        def wait(self, timeout):
            raise subprocess.TimeoutExpired("claude", timeout)

    pid = start_session(tmp_path, "horizon", "acceptEdits", popen=Popen)
    assert pid == 4242
    assert calls["argv"][1:] == ["remote-control", "--name=horizon", "--permission-mode", "acceptEdits",
                                 "--spawn", "same-dir"]
    assert calls["kw"]["cwd"] == str(tmp_path / "horizon")
    assert calls["kw"]["creationflags"] & subprocess.CREATE_NEW_CONSOLE
    assert not calls["kw"].get("shell")


def test_scan_finds_processes_not_started_by_us():
    procs = [
        FakeProc(10, "claude.exe", [CLAUDE, "remote-control", "--name=horizon", "--permission-mode", "acceptEdits"],
                 str(WS / "horizon"), created=200.0),
        FakeProc(11, "claude.exe", [CLAUDE, "remote-control"], str(WS), created=50.0),
        FakeProc(12, "claude.exe", [CLAUDE, "--print", "--sdk-url", "x", "--permission-mode", "plan"], str(WS / "horizon")),
        FakeProc(13, "Claude.exe", [r"C:\Program Files\WindowsApps\Claude\Claude.exe", "--startup"], r"C:\WINDOWS"),
        FakeProc(14, "node.exe", ["node", "remote-control"], str(WS)),
    ]
    assert scan_sessions(WS, procs=procs) == [
        {"pid": 11, "folder": str(WS), "name": None, "mode": None, "started": 50},
        {"pid": 10, "folder": "horizon", "name": "horizon", "mode": "acceptEdits", "started": 200},
    ]


def test_scan_parses_space_separated_name():
    procs = [FakeProc(10, "claude.exe", [CLAUDE, "remote-control", "--name", "blink"], str(WS / "blink"))]
    assert scan_sessions(WS, procs=procs)[0]["name"] == "blink"


def test_scan_skips_vanished_process():
    procs = [FakeProc(10, "claude.exe", [CLAUDE, "remote-control"], psutil.NoSuchProcess(10))]
    assert scan_sessions(WS, procs=procs) == []


def test_scan_folder_outside_workspace_is_full_path():
    procs = [FakeProc(10, "claude.exe", [CLAUDE, "remote-control"], r"D:\elsewhere\proj")]
    assert scan_sessions(WS, procs=procs)[0]["folder"] == r"D:\elsewhere\proj"


def test_stop_session_kills_children_then_parent(monkeypatch):
    order = []

    class P:
        def __init__(self, pid, kids=()):
            self.pid, self._kids = pid, list(kids)

        def children(self, recursive=False):
            return self._kids

        def terminate(self):
            order.append(self.pid)

    root = P(1, [P(2), P(3)])
    monkeypatch.setattr(sessions.psutil, "Process", lambda pid: root)
    monkeypatch.setattr(sessions.psutil, "wait_procs", lambda procs, timeout: (procs, []))
    sessions.stop_session(1)
    assert order == [2, 3, 1]


def test_claude_exe_prefers_native_binary(tmp_path, monkeypatch):
    exe = tmp_path / ".local" / "bin" / "claude.exe"
    exe.parent.mkdir(parents=True)
    exe.write_text("")
    monkeypatch.setattr(sessions.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(sessions.shutil, "which", lambda name: r"C:\npm\claude.cmd")
    assert sessions.claude_exe() == str(exe)


def test_claude_exe_never_returns_a_cmd_shim(tmp_path, monkeypatch):
    # A .cmd would run through cmd.exe, which interprets & ^ % in folder names
    monkeypatch.setattr(sessions.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(sessions.shutil, "which", lambda name: r"C:\npm\claude.cmd")
    import pytest
    with pytest.raises(FileNotFoundError):
        sessions.claude_exe()


def test_start_session_reports_immediate_exit(tmp_path, monkeypatch):
    (tmp_path / "horizon").mkdir()
    monkeypatch.setattr(sessions, "claude_exe", lambda: CLAUDE)

    class Popen:
        pid = 1

        def __init__(self, argv, **kw):
            pass

        def wait(self, timeout):
            return 3

    import pytest
    with pytest.raises(RuntimeError, match="exited with code 3"):
        start_session(tmp_path, "horizon", "plan", popen=Popen)


def test_stop_session_gone_process_is_ok(monkeypatch):
    def gone(pid):
        raise psutil.NoSuchProcess(pid)

    monkeypatch.setattr(sessions.psutil, "Process", gone)
    sessions.stop_session(5)  # no exception: already stopped
