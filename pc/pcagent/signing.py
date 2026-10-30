# HMAC-SHA256 signing of dashboard -> PC commands. The broker login is shared with the phone panel and the ESP32,
# so a valid signature (key known only to the VM and this PC) is what authorises a command, not broker access.
# Must stay byte-identical to dashboard/server/sign.js; dashboard/test/fixtures/cmd-vector.json pins both.
import hashlib
import hmac
import json

MAX_SKEW = 60    # seconds between the dashboard's ts and our clock
SEEN_TTL = 120   # how long a used id is remembered (covers the full +-MAX_SKEW window)


def canonical(cmd):
    body = {k: v for k, v in cmd.items() if k != "sig"}
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sign(cmd, secret):
    return hmac.new(secret.encode(), canonical(cmd).encode("utf-8"), hashlib.sha256).hexdigest()


def _flat(cmd):
    # Only strings and plain ints, so both languages serialise the same bytes (bool is an int in Python)
    return all(isinstance(v, str) or (isinstance(v, int) and not isinstance(v, bool)) for v in cmd.values())


def verify(cmd, secret, now, seen):
    """Return None if cmd is authentic and fresh (and remember its id), else the reason it is not."""
    for cmd_id, ts in list(seen.items()):
        if now - ts > SEEN_TTL:
            del seen[cmd_id]
    sig = cmd.get("sig")
    if not isinstance(sig, str):
        return "unsigned"
    if not _flat(cmd) or not isinstance(cmd.get("id"), str) or not isinstance(cmd.get("ts"), int):
        return "bad field"
    if not hmac.compare_digest(sig, sign(cmd, secret)):
        return "bad signature"
    if abs(now - cmd["ts"]) > MAX_SKEW:
        return "stale"
    if cmd["id"] in seen:
        return "replay"
    seen[cmd["id"]] = now
    return None
