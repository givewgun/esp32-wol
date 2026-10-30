import pytest

from pcagent.folders import list_folders


def test_list_folders_skips_dot_and_files(tmp_path):
    for name in ("b", "a", ".git", "local-llm-server;C"):
        (tmp_path / name).mkdir()
    (tmp_path / "b.txt").write_text("x")
    assert list_folders(tmp_path) == ["a", "b", "local-llm-server;C"]


def test_list_folders_missing_workspace(tmp_path):
    assert list_folders(tmp_path / "nope") == []


def test_list_folders_skips_junctions_and_hidden(tmp_path):
    import ctypes
    import _winapi

    outside = tmp_path / "outside"
    ws = tmp_path / "ws"
    for p in (outside, ws, ws / "real", ws / "secret"):
        p.mkdir()
    _winapi.CreateJunction(str(outside), str(ws / "escape"))
    ctypes.windll.kernel32.SetFileAttributesW(str(ws / "secret"), 0x2)  # FILE_ATTRIBUTE_HIDDEN
    assert list_folders(ws) == ["real"]


def test_folder_info_reports_trust_and_git(tmp_path):
    from pcagent.folders import folder_info
    from pcagent.trust import config_key

    (tmp_path / "a").mkdir()
    (tmp_path / "b" / ".git").mkdir(parents=True)
    trusted = {config_key(tmp_path / "B").lower()}
    assert folder_info(tmp_path, trusted) == [
        {"name": "a", "trusted": False, "git": False},
        {"name": "b", "trusted": True, "git": True},
    ]


@pytest.mark.parametrize("name", ["new-app", "My_App.v2", "a", "x" * 64])
def test_valid_new_folder_names(name):
    from pcagent.folders import valid_new_name
    assert valid_new_name(name)


@pytest.mark.parametrize("name", ["", ".hidden", "-flag", "a b", "a/b", r"a\b", "..", "x" * 65, "con", "NUL",
                                  "com1", "lpt9.txt", "end.", "café", "a;b", "a&b"])
def test_invalid_new_folder_names(name):
    from pcagent.folders import valid_new_name
    assert not valid_new_name(name)
