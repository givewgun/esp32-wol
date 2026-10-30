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
    assert reply == {"id": reply["id"], "ok": False, "error": "unknown folder"}
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
