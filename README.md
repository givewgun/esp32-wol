# esp32-wol

Wake the home PC from anywhere and have it ready for remote AI work (Claude Code + Codex).

```
phone (IoT MQTT Panel) ──"wake"──> EMQX Cloud (TLS 8883) ──> ESP32 at home ──magic packet──> PC
PC boots -> auto-login -> start-remote.ps1 -> Claude Code remote-control + Codex app -> lock screen
phone ──"shutdown"/"hibernate"/"sleep"──> EMQX Cloud ──> power-agent.pyw on the PC
work laptop -> claude.ai/code (Claude)  |  phone -> ChatGPT app (Codex)  |  RustDesk (desktop)
any browser -> pc.givewgun.com (Cloudflare Access) -> pc-dash on Oracle VM ──MQTT──> PC agent: stats, power, Claude sessions
```

## MQTT topics

| Topic | Payload | Who |
|---|---|---|
| `wol/desktop` | `wake` (QoS 1, **not retained**) | phone publishes, ESP32 sends magic packet |
| `wol/desktop` | `shutdown` / `hibernate` / `sleep` (QoS 1, **not retained**) | phone publishes, PC power agent acts |
| `wol/desktop/status` | `online` / `offline` (retained, LWT) | ESP32 publishes |
| `wol/desktop/pc` | `online` / `offline` (retained, LWT) | PC power agent publishes |
| `wol/desktop/pc/stats` | JSON: CPU, RAM, GPU, disks, uptime, `ts` (retained, every 5 s) | PC agent publishes |
| `wol/desktop/pc/folders` | JSON array of `%USERPROFILE%\workspace` subfolders (retained) | PC agent publishes |
| `wol/desktop/pc/sessions` | JSON: running `claude remote-control` servers (retained) | PC agent publishes |
| `wol/desktop/pc/cmd` | JSON `start` / `stop` / `refresh`, **HMAC-signed** (not retained) | dashboard publishes, PC agent acts |
| `wol/desktop/pc/reply` | JSON `{id, ok, error?}` (not retained) | PC agent publishes |

Retained messages on `wol/desktop` and `wol/desktop/pc/cmd` are ignored on purpose so a stale command can't fire on every reconnect.
A power command sent while the PC is already off or asleep is dropped, not replayed on the next wake.

## Firmware (ESP-IDF v6.1, classic ESP32)

```powershell
$env:IDF_TOOLS_PATH='C:\Espressif'; . C:\esp\v6.1\esp-idf\export.ps1
cd firmware
copy main\secrets.example.h main\secrets.h   # first time only, then fill in
idf.py build
idf.py -p COM10 flash monitor                # hold BOOT if it says "Wrong boot mode"
```

TLS uses the IDF certificate bundle (EMQX chains to DigiCert Global Root G2), so no CA file to manage.

## PC (one-time)

1. Run `claude` once in `%USERPROFILE%\workspace` and accept the workspace trust prompt.
2. Run `pc\setup.ps1`: adds the logon startup shortcuts (remote work + power agent), installs `paho-mqtt` + `psutil`,
   creates `pc\agent-secret.txt` (dashboard command key, gitignored), installs RustDesk as a service (UAC prompt).
   Needs Python on PATH and `firmware\main\secrets.h` filled in (the power agent reuses its MQTT login).
3. Auto-login: `winget install Microsoft.Sysinternals.Autologon`, run `Autologon`, enter your Windows password, Enable.
   Microsoft account: username = account email, **domain empty**, password = account password (not PIN).
   With a Microsoft account, turn off *Settings > Accounts > Sign-in options > "Only allow Windows Hello sign-in"* first.
4. Already done: Wake-on-LAN in BIOS + NIC, Fast Startup off.

Normal sleep/hibernate timers stay on: an idle PC goes back to sleep, and you wake it again from the phone.
Wake from sleep resumes the existing session, so the startup script only runs after a cold boot.

### Power agent

`pc\power-agent.pyw` runs hidden at logon and acts on `wol/desktop`:

| Payload | Does | Wake back with `wake` |
|---|---|---|
| `shutdown` | `shutdown /s /f /t 0` (force-closes apps, unsaved work is lost) | yes, cold boot -> auto-login -> startup script |
| `hibernate` | `shutdown /h` | yes, resumes session |
| `sleep` | S3 sleep via `SetSuspendState` | yes, resumes session (fastest) |

- Log: `pc\power-agent.log`. Test without acting: `python pc\power-agent.pyw --dry-run` (stop the hidden one first in Task Manager, `pythonw.exe`).
- Restart it: double-click *Power Agent* in `shell:startup`.
- It only runs while you are logged in; before auto-login finishes it can't receive commands.
- It also serves the dashboard: publishes stats/folders/sessions and runs signed `start`/`stop` commands
  (`pc\pcagent\`). Without `pc\agent-secret.txt` it ignores all dashboard commands. Tests: `python -m pytest pc\tests`.

## Dashboard (pc.givewgun.com)

Phone/laptop page to watch the PC, send power commands, and start/stop Claude Code sessions without RustDesk.

- **New session:** pick a folder under `%USERPROFILE%\workspace` and a permission mode (full access preselected);
  the agent runs `claude remote-control --name=<folder> --permission-mode <mode>` there in a minimized console.
  Chat in claude.ai/code as usual. One server per folder (Claude Code's rule): open more chats for a running folder
  from claude.ai/code, or stop it and start again to change the mode.
- **Sessions:** every running `claude remote-control`, including the boot-time one; Stop kills that server and its chats.
- **Security:** Cloudflare Access (one-time PIN, owner's email only) in front; the server also verifies the Access
  JWT on every `/api` call. Session commands are HMAC-signed with `PC_CMD_SECRET` (VM and PC only), so the shared
  MQTT login alone can't start anything. Pentest: `docs/superpowers/specs/2026-10-30-pc-dashboard-pentest.md`.
- **Code:** `dashboard/` (Express + React). `cd dashboard; npm ci; npm test; npm run build`.
- **Deploy:** push to `main` touching `dashboard/**` runs `.github/workflows/dashboard.yml`: test, build, SSH to the
  Oracle VM, `/opt/pc-dash/app`, `docker compose -f dashboard/docker-compose.prod.yml up -d --build`. Container
  `pc-dash` sits on the `tunnel-gateway` network; the `oracle-vm-gateway` tunnel routes `pc.givewgun.com` to it.
- **GitHub secrets:** `ORACLE_VM_HOST`, `ORACLE_VM_SSH_KEY`, `MQTT_URI`, `MQTT_USER`, `MQTT_PASS`,
  `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ALLOWED_EMAIL`, `PC_CMD_SECRET` (= contents of `pc\agent-secret.txt`).

## Phone (IoT MQTT Panel)

Connection (once): your EMQX Serverless address, port `8883`, network protocol **MQTT SSL**, username/password from EMQX.

Add these panels to the dashboard (every button: QoS 1, **retain off**):

| Panel | Name | Topic | Payload / settings |
|---|---|---|---|
| Button | Wake | `wol/desktop` | `wake` |
| Button | Sleep | `wol/desktop` | `sleep` |
| Button | Hibernate | `wol/desktop` | `hibernate` |
| Button | Shutdown | `wol/desktop` | `shutdown`; turn on the button's confirm option if your app version has one |
| LED | ESP32 | `wol/desktop/status` | on = `online`, off = `offline` |
| LED | PC | `wol/desktop/pc` | on = `online`, off = `offline` |

The *PC* LED goes off right before a power command and back on a few seconds after wake (once the agent reconnects).
Hard power loss or crash: it flips to `offline` after ~45 s (keepalive timeout).
