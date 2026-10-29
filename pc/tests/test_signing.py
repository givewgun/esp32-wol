import json
from pathlib import Path

from pcagent.signing import canonical, sign, verify

VECTOR = json.loads(
    (Path(__file__).resolve().parents[2] / "dashboard" / "test" / "fixtures" / "cmd-vector.json").read_text("utf-8")
)
NOW = 1767000000
SECRET = "s"


def signed(**fields):
    cmd = {"id": "a" * 32, "ts": NOW, "action": "refresh", **fields}
    cmd["sig"] = sign(cmd, SECRET)
    return cmd


def test_vector_matches():
    assert canonical(VECTOR["cmd"]) == VECTOR["canonical"]
    assert sign(VECTOR["cmd"], VECTOR["secret"]) == VECTOR["sig"]


def test_sig_excluded_from_canonical():
    cmd = dict(VECTOR["cmd"], sig="whatever")
    assert canonical(cmd) == VECTOR["canonical"]


def test_verify_ok():
    assert verify(signed(), SECRET, NOW, {}) is None


def test_verify_unsigned():
    cmd = signed()
    del cmd["sig"]
    assert verify(cmd, SECRET, NOW, {}) == "unsigned"


def test_verify_bad_sig():
    cmd = signed()
    cmd["sig"] = ("0" if cmd["sig"][0] != "0" else "1") + cmd["sig"][1:]
    assert verify(cmd, SECRET, NOW, {}) == "bad signature"


def test_verify_wrong_secret():
    assert verify(signed(), "other", NOW, {}) == "bad signature"


def test_verify_stale():
    assert verify(signed(), SECRET, NOW + 61, {}) == "stale"
    assert verify(signed(), SECRET, NOW - 61, {}) == "stale"
    assert verify(signed(), SECRET, NOW + 60, {}) is None


def test_verify_replay():
    seen = {}
    cmd = signed()
    assert verify(cmd, SECRET, NOW, seen) is None
    assert verify(cmd, SECRET, NOW + 1, seen) == "replay"


def test_seen_pruned_after_120s():
    seen = {"old": NOW - 121, "recent": NOW - 10}
    verify(signed(), SECRET, NOW, seen)
    assert "old" not in seen and "recent" in seen


def test_verify_rejects_float_or_nested():
    assert verify(signed(pid=1.5), SECRET, NOW, {}) == "bad field"
    assert verify(signed(folder={"a": 1}), SECRET, NOW, {}) == "bad field"
    assert verify(signed(pid=True), SECRET, NOW, {}) == "bad field"


def test_verify_requires_string_id_and_int_ts():
    cmd = {"id": 5, "ts": NOW, "action": "refresh"}
    cmd["sig"] = sign(cmd, SECRET)
    assert verify(cmd, SECRET, NOW, {}) == "bad field"
