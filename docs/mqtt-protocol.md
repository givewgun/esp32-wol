# MQTT protocol

Everything goes through one broker. This page lists every topic so you can build your own client (a different phone
app, Home Assistant, a script, a smart button).

## Topics

| Topic | Payload | Retained | Published by | Consumed by |
|---|---|---|---|---|
| `wol/desktop` | `wake` | **no** | phone, dashboard | ESP32 |
| `wol/desktop` | `sleep` / `hibernate` / `shutdown` | **no** | phone, dashboard | PC agent |
| `wol/desktop/status` | `online` / `offline` | yes (LWT) | ESP32 | phone, dashboard |
| `wol/desktop/pc` | `online` / `offline` | yes (LWT) | PC agent | phone, dashboard |
| `wol/desktop/pc/stats` | JSON, every 5 s | yes | PC agent | dashboard |
| `wol/desktop/pc/folders` | JSON, on change | yes | PC agent | dashboard |
| `wol/desktop/pc/sessions` | JSON, on change | yes | PC agent | dashboard |
| `wol/desktop/pc/cmd` | signed JSON | **no** | dashboard | PC agent |
| `wol/desktop/pc/reply` | signed JSON | no | PC agent | dashboard |

Publish commands at **QoS 1**.

## Rules

- **Commands must not be retained.** The ESP32 and the PC agent drop retained messages on `wol/desktop` and
  `wol/desktop/pc/cmd`, so a stale command can't fire every time a device reconnects.
- **Commands to a sleeping PC are dropped.** The PC agent uses a clean MQTT session. A `shutdown` sent while the PC is
  off is not replayed on the next wake.
- **Status is retained with a Last Will.** On a clean power command the PC agent publishes `offline` first. On a crash
  or power loss the broker publishes `offline` after the keepalive expires (~45 s). The PC agent also re-publishes
  `online` every 5 s as a heartbeat.

## Quick test with mosquitto

```bash
B="-h xxxx.emqxsl.com -p 8883 --capath /etc/ssl/certs -u USER -P PASS"

mosquitto_sub $B -t 'wol/desktop/#' -v      # watch everything
mosquitto_pub $B -q 1 -t wol/desktop -m wake
mosquitto_pub $B -q 1 -t wol/desktop -m sleep
```

## State payloads

`wol/desktop/pc/stats`:

```json
{
  "ts": 1767000000,
  "host": "DESKTOP-1234",
  "uptime_s": 3600,
  "cpu_pct": 7.5,
  "ram": { "used": 8589934592, "total": 34359738368 },
  "gpu": { "name": "NVIDIA GeForce RTX 4070", "util_pct": 3, "vram_used_mb": 900, "vram_total_mb": 12282, "temp_c": 41 },
  "disks": [{ "mount": "C:\\", "free": 200000000000, "total": 1000000000000 }]
}
```

`gpu` is `null` without an NVIDIA GPU / `nvidia-smi`. Sizes are bytes.

`wol/desktop/pc/folders`: direct, visible, non-symlink subfolders of `%USERPROFILE%\workspace`:

```json
[{ "name": "my-project", "trusted": true, "git": true }]
```

`wol/desktop/pc/sessions`: running `claude remote-control` processes:

```json
{
  "ts": 1767000000,
  "sessions": [
    { "pid": 4242, "folder": "my-project", "name": "my-project", "mode": "bypassPermissions", "started": 1766990000 }
  ]
}
```

`folder` is the leaf name for sessions inside the workspace, or the full path otherwise. `name` and `mode` are `null`
when the process wasn't started with those flags (e.g. the boot-time session).

## Signed commands

Starting a Claude Code session with `bypassPermissions` is effectively remote code execution, and the broker login is
shared with the phone and the ESP32. So commands on `wol/desktop/pc/cmd` must carry an HMAC that only the dashboard and
the PC can make. The key is `pc\agent-secret.txt` on the PC and `PC_CMD_SECRET` on the dashboard.

### Format

```json
{
  "action": "start",
  "folder": "my-project",
  "mode": "bypassPermissions",
  "id": "0123456789abcdef0123456789abcdef",
  "ts": 1767000000,
  "sig": "9f0d...52a0"
}
```

| Field | Rule |
|---|---|
| `id` | Random string, unique per command (dashboard uses 16 random bytes as hex) |
| `ts` | Unix seconds, integer |
| `sig` | Hex HMAC-SHA256 of the canonical form, keyed with the secret |
| everything else | Strings or plain integers only (no floats, booleans, nulls, nesting) |

**Canonical form:** the object without `sig`, keys sorted, serialized as compact JSON (`,` and `:` with no spaces),
UTF-8, non-ASCII left as-is. In Python:

```python
json.dumps({k: v for k, v in cmd.items() if k != "sig"}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
```

`dashboard/test/fixtures/cmd-vector.json` has a known secret, command, canonical string and signature to test against.

### Checks on the PC

A command is rejected (with a reason in the reply) if:

- the signature doesn't match,
- `ts` is more than **60 s** away from the PC's clock (keep both clocks synced),
- `ts` is older than the agent's start time,
- the same `id` was seen in the last 120 s (replay).

Payloads over 4 KB or that aren't JSON objects with a string `id` are ignored without a reply.

### Actions

| `action` | Fields | Does |
|---|---|---|
| `start` | `folder`, `mode` | Starts `claude remote-control` in `workspace\<folder>`. Folder must be listed and trusted, not already running. Reply has `pid`. |
| `stop` | `pid` (int) | Kills a listed Remote Control process and its children |
| `trust` | `folder` | Marks a listed folder trusted in `~/.claude.json` |
| `create` | `folder`, `init` (`git` / `none`) | Creates and trusts a new folder; name: `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`, no trailing `.`, no Windows device names |
| `refresh` | | No-op; answers `ok` |

`mode` is one of `bypassPermissions`, `acceptEdits`, `auto`, `default`, `dontAsk`, `plan`.

### Replies

On `wol/desktop/pc/reply`, signed the same way with the same key, so nobody with only the broker login can fake a
result:

```json
{ "id": "<command id>", "ok": true, "pid": 4242, "sig": "..." }
{ "id": "<command id>", "ok": false, "error": "folder not trusted", "sig": "..." }
```

Verify the reply's `sig` before trusting it.
