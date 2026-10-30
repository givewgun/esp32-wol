# PC agent

Everything in `pc/` runs on the Windows PC you wake. It has three parts:

| File | Runs | Does |
|---|---|---|
| `setup.ps1` | Once, by you | Installs logon shortcuts, Python deps, the dashboard key, RustDesk service |
| `start-remote.ps1` | At every logon | Starts your remote-work tools, then locks the screen |
| `power-agent.pyw` | At every logon, hidden | MQTT power commands + the dashboard side channel |

Install steps are in [setup.md](setup.md#4-pc). This page explains what each part does.

## setup.ps1

Safe to re-run. It:

1. Creates `Remote Work.lnk` in your Startup folder, running `start-remote.ps1` hidden.
2. `pip install --user paho-mqtt psutil`.
3. Generates `pc\agent-secret.txt` (32 random bytes, hex) if it doesn't exist. This is the HMAC key for dashboard
   commands. Gitignored. Copy it into the dashboard's `PC_CMD_SECRET`.
4. Creates `Power Agent.lnk` in your Startup folder, running `power-agent.pyw` with `pythonw` (no window).
5. Runs `RustDesk.exe --install-service` elevated, so RustDesk works at boot and on the lock screen. If you don't use
   RustDesk, that step just fails; nothing else depends on it.

## start-remote.ps1

Runs after each logon (so after each cold boot with auto-login; not after waking from sleep, since that resumes your
existing session):

1. Waits until `api.anthropic.com:443` is reachable, so Remote Control registers cleanly.
2. Starts `claude remote-control` in `%USERPROFILE%\workspace`, minimized. It shows up in
   [claude.ai/code](https://claude.ai/code) and the Claude app. Closing that window ends it.
3. Starts the Codex desktop app, which hosts the remote connection for the ChatGPT mobile app.
4. Locks the workstation. Running sessions keep going; RustDesk can unlock.

Edit it freely to start whatever you need. See [customizing.md](customizing.md).

## power-agent.pyw

A long-running Python process. It reads the MQTT login from `firmware\main\secrets.h`, connects as client
`pc-desktop` (TLS, keepalive 30 s, clean session), and publishes `online` to `wol/desktop/pc` with an `offline` Last
Will.

### Power commands

On a **non-retained** message on `wol/desktop`:

| Payload | Runs | Wake it back with `wake` |
|---|---|---|
| `shutdown` | `shutdown /s /f /t 0` (force-closes apps; unsaved work is lost) | Yes: cold boot → auto-login → startup script |
| `hibernate` | `shutdown /h` | Yes, resumes your session |
| `sleep` | S3 sleep via `SetSuspendState` (WoL stays armed) | Yes, resumes your session (fastest) |
| `wake` | Nothing (the ESP32 handles it) | |

Right before acting, the agent publishes `offline` so your status light reacts immediately.

Clean session means commands sent while the PC is off or asleep are **dropped**, not replayed when it wakes. You
won't wake the PC and have it immediately shut down again from a stale message.

### Dashboard side channel

Every 5 seconds while connected, it publishes (retained):

- `wol/desktop/pc` → `online` (heartbeat; heals a stale `offline`)
- `wol/desktop/pc/stats` → CPU %, RAM, NVIDIA GPU (via `nvidia-smi`, if present), disks, uptime
- `wol/desktop/pc/folders` → subfolders of `%USERPROFILE%\workspace` with trust and git status (only when changed)
- `wol/desktop/pc/sessions` → every running `claude remote-control` process (only when changed)

It also accepts **HMAC-signed** commands on `wol/desktop/pc/cmd`: start/stop a Claude Code session, trust a folder,
create a folder. Without `pc\agent-secret.txt` it ignores all of them. Format: [mqtt-protocol.md](mqtt-protocol.md).

Sessions are started as:

```
claude remote-control --name=<folder> --permission-mode <mode> --spawn same-dir
```

in a new minimized console, detached from the agent, so restarting the agent doesn't kill your sessions. The agent
finds them again by scanning processes.

**Trust:** Claude Code's Remote Control only runs in folders trusted at that exact path; a trusted parent folder doesn't
count. The *trust* command sets `hasTrustDialogAccepted` for the folder in `~/.claude.json`, exactly what answering the
CLI prompt does. A backup is kept at `~/.claude.json.pc-agent.bak`.

### Operating it

| Task | How |
|---|---|
| Log | `pc\power-agent.log` (rotates) |
| Dry run (log commands, don't act) | Stop the hidden one (Task Manager → `pythonw.exe`), then `python pc\power-agent.pyw --dry-run` |
| Restart | End `pythonw.exe` in Task Manager, double-click *Power Agent* in `shell:startup` |
| Tests | `python -m pytest pc\tests` |

The agent only runs while you're logged in. Between power-on and auto-login finishing, it can't receive commands.

## Code layout

```
pc/pcagent/
  power.py      Power command handling (publishes offline first, ignores repeats while going down)
  commands.py   Signed dashboard commands: validation and dispatch
  signing.py    HMAC-SHA256 sign/verify, replay and clock-skew checks
  sessions.py   Find, start and stop `claude remote-control` processes
  folders.py    Workspace folder listing, new-folder name rules
  trust.py      Read/write Claude Code folder trust in ~/.claude.json
  stats.py      CPU/RAM/GPU/disk/uptime snapshot
  logfile.py    Small rotating log
```
