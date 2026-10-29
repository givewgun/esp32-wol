from pcagent.folders import list_folders


def test_list_folders_skips_dot_and_files(tmp_path):
    for name in ("b", "a", ".git", "local-llm-server;C"):
        (tmp_path / name).mkdir()
    (tmp_path / "b.txt").write_text("x")
    assert list_folders(tmp_path) == ["a", "b", "local-llm-server;C"]


def test_list_folders_missing_workspace(tmp_path):
    assert list_folders(tmp_path / "nope") == []
