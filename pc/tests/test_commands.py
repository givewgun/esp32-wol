import json

import pytest

from pcagent.commands import CommandHandler
from pcagent.signing import sign

NOW = 1767000000
SECRET = "s"


@pytest.fixture
def env(tmp_path):
    for name in ("horizon", "blink"):
        (tmp_path / name).mkdir()
    calls = {"start": [], "stop": []}
    running = [{"pid": 77, "folder": "blink", "name": "blink", "mode": "plan", "started": 1}]

    def start(ws, folder, mode):
        calls["start"].append((folder, mode))
        return 4242

    handler = CommandHandler(SECRET, tmp_path, start=start, stop=lambda pid: calls["stop"].append(pid),
                             scan=lambda ws: running, clock=lambda: NOW)
    return handler, calls


def msg(n=[0], **fields):
    n[0] += 1
    cmd = {"id": f"{n[0]:032x}", "ts": NOW, **fields}
    cmd["sig"] = sign(cmd, SECRET)
    return json.dumps(cmd).encode()


def test_start_ok_returns_pid(env):
    handler, calls = env
    reply = handler.handle(msg(action="start", folder="horizon", mode="bypassPermissions"))
    assert reply["ok"] is True and reply["pid"] == 4242
    assert calls["start"] == [("horizon", "bypassPermissions")]


@pytest.mark.parametrize("folder", ["..", r"C:\Windows", r"horizon\..\..", "missing", "", ".git"])
def test_start_unknown_folder(env, folder):
    handler, calls = env
    reply = handler.handle(msg(action="start", folder=folder, mode="plan"))
    assert {k: v for k, v in reply.items() if k != "sig"} == {"id": reply["id"], "ok": False, "error": "unknown folder"}
    assert calls["start"] == []


def test_start_bad_mode(env):
    handler, calls = env
    assert handler.handle(msg(action="start", folder="horizon", mode="rm"))["error"] == "bad mode"
    assert calls["start"] == []


def test_start_folder_already_running(env):
    handler, calls = env
    assert handler.handle(msg(action="start", folder="blink", mode="plan"))["error"] == "already running"
    assert calls["start"] == []


def test_stop_only_scanned_pids(env):
    handler, calls = env
    assert handler.handle(msg(action="stop", pid=4))["error"] == "not a claude session"
    assert handler.handle(msg(action="stop", pid=77))["ok"] is True
    assert calls["stop"] == [77]


def test_unknown_action(env):
    handler, _ = env
    assert handler.handle(msg(action="exec"))["error"] == "unknown action"


def test_refresh_ok(env):
    handler, _ = env
    assert handler.handle(msg(action="refresh"))["ok"] is True


def test_unsigned_rejected_without_side_effects(env):
    handler, calls = env
    payload = json.dumps({"id": "x" * 32, "ts": NOW, "action": "start", "folder": "horizon", "mode": "plan"}).encode()
    assert handler.handle(payload)["error"] == "unsigned"
    assert calls["start"] == []


def test_replay_rejected(env):
    handler, calls = env
    payload = msg(action="start", folder="horizon", mode="plan")
    handler.handle(payload)
    assert handler.handle(payload)["error"] == "replay"
    assert len(calls["start"]) == 1


@pytest.mark.parametrize("payload", [b"not json", b"[]", b'{"ts": 1}', b'{"id": 5}', b"\xff\xfe"])
def test_malformed_json_returns_none(env, payload):
    handler, _ = env
    assert handler.handle(payload) is None


def test_oversized_payload_ignored(env):
    handler, calls = env
    assert handler.handle(msg(action="start", folder="horizon", mode="plan", pad="x" * 5000)) is None
    assert calls["start"] == []


def test_dry_run_does_not_spawn(env, tmp_path):
    _, calls = env
    handler = CommandHandler(SECRET, tmp_path, start=lambda *a: calls["start"].append(a), stop=calls["stop"].append,
                             scan=lambda ws: [], clock=lambda: NOW, dry_run=True)
    assert handler.handle(msg(action="start", folder="horizon", mode="plan"))["ok"] is True
    assert calls["start"] == []


def test_replies_are_signed(env):
    handler, _ = env
    reply = handler.handle(msg(action="refresh"))
    assert reply["sig"] == sign(reply, SECRET)
    bad = handler.handle(msg(action="start", folder="..", mode="plan"))
    assert bad["sig"] == sign(bad, SECRET)


def test_commands_signed_before_agent_start_rejected(tmp_path):
    handler = CommandHandler(SECRET, tmp_path, scan=lambda ws: [], clock=lambda: NOW + 30)
    assert handler.handle(msg(action="refresh"))["error"].startswith("stale")


def test_stale_error_shows_both_clocks(env):
    handler, _ = env
    cmd = {"id": "f" * 32, "ts": NOW - 120, "action": "refresh"}
    cmd["sig"] = sign(cmd, SECRET)
    err = handler.handle(json.dumps(cmd).encode())["error"]
    assert err.startswith("stale") and str(NOW) in err and str(NOW - 120) in err


def test_already_running_ignores_case(env):
    handler, calls = env
    assert handler.handle(msg(action="start", folder="blink", mode="plan"))["error"] == "already running"
    handler.scan = lambda ws: [{"pid": 9, "folder": "HORIZON", "name": None, "mode": None, "started": 1}]
    assert handler.handle(msg(action="start", folder="horizon", mode="plan"))["error"] == "already running"


def test_start_failure_reported(env):
    handler, _ = env
    handler.start = lambda ws, f, m: (_ for _ in ()).throw(RuntimeError("claude exited with code 1"))
    assert handler.handle(msg(action="start", folder="horizon", mode="plan"))["error"] == "claude exited with code 1"


def test_stop_access_denied_reported(env):
    import psutil
    handler, _ = env
    handler.stop = lambda pid: (_ for _ in ()).throw(psutil.AccessDenied(pid))
    assert handler.handle(msg(action="stop", pid=77))["error"] == "access denied"


@pytest.mark.parametrize("folder", ["my project", "-leading", "café", "local-llm-server;C", "a&b^c%d"])
def test_start_odd_but_real_folder_names(tmp_path, folder):
    (tmp_path / folder).mkdir()
    started = []
    handler = CommandHandler(SECRET, tmp_path, start=lambda ws, f, m: started.append(f) or 1,
                             scan=lambda ws: [], clock=lambda: NOW)
    assert handler.handle(msg(action="start", folder=folder, mode="plan"))["ok"] is True
    assert started == [folder]
