import time
from pathlib import Path

MAX_BYTES = 1_000_000


def append_log(path: Path, msg, max_bytes=MAX_BYTES):
    """Append a timestamped line; rotate to <name>.1 once the file passes max_bytes (keeps one old file)."""
    try:
        if path.stat().st_size > max_bytes:
            path.replace(path.with_name(path.name + ".1"))
    except FileNotFoundError:
        pass
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
