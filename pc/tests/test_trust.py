import json

import pytest

from pcagent.trust import config_key, set_trusted, trusted_keys


def write(path, data):
    path.write_text(json.dumps(data), encoding="utf-8")


def test_config_key_uses_forward_slashes(tmp_path):
    assert config_key(tmp_path / "horizon") == str(tmp_path / "horizon").replace("\\", "/")


def test_trusted_keys_exact_paths_only(tmp_path):
    cfg = tmp_path / ".claude.json"
    write(cfg, {"projects": {"C:/Users/gunka/workspace": {"hasTrustDialogAccepted": True},
                             "C:/Users/gunka/workspace/horizon": {"hasTrustDialogAccepted": False},
                             "C:/Users/gunka/workspace/Blink": {"hasTrustDialogAccepted": True}}})
    assert trusted_keys(cfg) == {"c:/users/gunka/workspace", "c:/users/gunka/workspace/blink"}


def test_trusted_keys_missing_or_broken_config(tmp_path):
    assert trusted_keys(tmp_path / "nope.json") == set()
    (tmp_path / "bad.json").write_text("{not json")
    assert trusted_keys(tmp_path / "bad.json") == set()


def test_set_trusted_preserves_everything_else(tmp_path):
    cfg = tmp_path / ".claude.json"
    original = {"numStartups": 7, "projects": {"C:/x": {"hasTrustDialogAccepted": True, "allowedTools": ["a"]},
                                               "C:/ws/horizon": {"remoteControlSpawnMode": "same-dir"}}}
    write(cfg, original)
    set_trusted(cfg, tmp_path / "ignored")  # creates a new entry
    folder_key = config_key(tmp_path / "ignored")
    data = json.loads(cfg.read_text(encoding="utf-8"))
    assert data["numStartups"] == 7 and data["projects"]["C:/x"] == original["projects"]["C:/x"]
    assert data["projects"][folder_key] == {"hasTrustDialogAccepted": True}
    assert (tmp_path / ".claude.json.pc-agent.bak").exists()


def test_set_trusted_keeps_existing_project_fields(tmp_path):
    cfg = tmp_path / ".claude.json"
    folder = tmp_path / "horizon"
    write(cfg, {"projects": {config_key(folder): {"remoteControlSpawnMode": "same-dir"}}})
    set_trusted(cfg, folder)
    entry = json.loads(cfg.read_text(encoding="utf-8"))["projects"][config_key(folder)]
    assert entry == {"remoteControlSpawnMode": "same-dir", "hasTrustDialogAccepted": True}


def test_set_trusted_refuses_to_overwrite_unreadable_config(tmp_path):
    cfg = tmp_path / ".claude.json"
    cfg.write_text("{half written")
    with pytest.raises(RuntimeError):
        set_trusted(cfg, tmp_path / "horizon")
    assert cfg.read_text() == "{half written"
