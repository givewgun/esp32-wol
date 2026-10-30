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
