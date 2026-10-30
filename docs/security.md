# Security

The dashboard can start Claude Code with `bypassPermissions` on your PC. That's remote code execution by design, so
the system is built so that only you can trigger it, and so that it fails closed.

## What's exposed

| Component | Inbound connections | Outbound |
|---|---|---|
| ESP32 | None | Broker (TLS) |
| PC agent | None | Broker (TLS) |
| Dashboard container | Only from Cloudflare Tunnel; no host port | Broker (TLS), Cloudflare JWKS |
| Home network | Nothing forwarded | |

## Layers

| Threat | Protection |
|---|---|
| Stranger opens the dashboard | Cloudflare Access in front (one email allowed). The server *also* verifies the Access JWT on every `/api` call (RS256 signature, issuer, audience, exact email), so traffic that reaches the container any other way is rejected. |
| Someone with the broker login starts a session | Session/trust/create commands need an HMAC-SHA256 signature with `PC_CMD_SECRET`, known only to the dashboard and the PC. Broker access alone can only wake/sleep/shut down the PC and read its stats. |
| Replay of a captured command | Each command has a unique `id` (remembered 120 s) and a `ts` that must be within 60 s of the PC's clock and after the agent started. |
| Fake success/failure shown in the dashboard | PC replies are signed with the same key; the dashboard drops unsigned or mis-signed replies. |
| Path traversal / injection via folder names | The folder must exactly match a listed workspace subfolder (no paths, `..`, symlinks, junctions or hidden folders). New-folder names are restricted to `[A-Za-z0-9._-]`. `mode` is a fixed enum. The agent passes an argv list, never a shell string. |
| Stale command fires later | Commands are non-retained; retained ones are ignored; the PC uses a clean session so nothing queues while it's off. |
| Oversized or malformed input | 4 KB limits on both the API and the agent, JSON only, strict type checks. |

A pentest of the dashboard is written up in
[superpowers/specs/2026-10-30-pc-dashboard-pentest.md](superpowers/specs/2026-10-30-pc-dashboard-pentest.md).

## What the broker login can still do

Anyone with the broker username/password (it's on your phone, the ESP32 and the PC) can:

- wake, sleep, hibernate or **force shut down** the PC (unsaved work is lost),
- read stats, folder names and running sessions,
- publish fake retained status/stats, which the dashboard would display.

If that matters to you, give each device its own broker user with topic ACLs (EMQX supports this): e.g. the phone may
publish only to `wol/desktop`, the ESP32 may only subscribe to it.

## Your responsibilities

- Keep `firmware/main/secrets.h` and `pc/agent-secret.txt` out of git (both are gitignored) and off shared machines.
- Treat `PC_CMD_SECRET` like a password. If it leaks, delete `pc\agent-secret.txt`, re-run `setup.ps1`, restart the
  agent, and update the dashboard's secret.
- Keep the Access policy to your own email.
- Auto-login stores your Windows password (encrypted, as an LSA secret). The startup script locks the screen right
  away, but anyone with physical access during boot gets a brief window. Weigh that for your situation.
- `bypassPermissions` sessions let Claude run any command in that folder without asking. Pick a stricter mode when you
  don't need it.
