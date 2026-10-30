from pathlib import Path

SETUP = Path(__file__).resolve().parents[1] / "setup.ps1"


def test_setup_has_no_control_characters():
    text = SETUP.read_text(encoding="utf-8")
    bad = [(i, hex(ord(ch))) for i, ch in enumerate(text) if ord(ch) < 32 and ch not in "\r\n\t"]
    assert bad == []


def test_secret_path_uses_join_path():
    assert "Join-Path $PSScriptRoot 'agent-secret.txt'" in SETUP.read_text(encoding="utf-8")
