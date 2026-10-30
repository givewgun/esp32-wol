from pcagent.logfile import append_log


def test_append_log_rotates_when_too_big(tmp_path):
    log = tmp_path / "agent.log"
    log.write_text("x" * 100)
    append_log(log, "hello", max_bytes=50)
    assert (tmp_path / "agent.log.1").read_text() == "x" * 100
    assert log.read_text().endswith("hello\n") and len(log.read_text()) < 50


def test_append_log_appends(tmp_path):
    log = tmp_path / "agent.log"
    append_log(log, "a")
    append_log(log, "b")
    assert log.read_text().splitlines()[-1].endswith("b")
