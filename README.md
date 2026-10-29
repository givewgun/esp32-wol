# esp32-wol

Wake the home PC from anywhere and have it ready for remote AI work (Claude Code + Codex).

```
phone (IoT MQTT Panel) ──"wake"──> EMQX Cloud (TLS 8883) ──> ESP32 at home ──magic packet──> PC
PC boots -> auto-login -> start-remote.ps1 -> Claude Code remote-control + Codex app -> lock screen
phone ──"shutdown"/"hibernate"/"sleep"──> EMQX Cloud ──> power-agent.pyw on the PC
work laptop -> claude.ai/code (Claude)  |  phone -> ChatGPT app (Codex)  |  RustDesk (desktop)
```

## MQTT topics

| Topic | Payload | Who |
|---|---|---|
| `wol/desktop` | `wake` (QoS 1, **not retained**) | phone publishes, ESP32 sends magic packet |
| `wol/desktop` | `shutdown` / `hibernate` / `sleep` (QoS 1, **not retained**) | phone publishes, PC power agent acts |
| `wol/desktop/status` | `online` / `offline` (retained, LWT) | ESP32 publishes |
| `wol/desktop/pc` | `online` / `offline` (retained, LWT) | PC power agent publishes |

Retained messages on `wol/desktop` are ignored on purpose so a stale command can't fire on every reconnect.
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
2. Run `pc\setup.ps1`: adds the logon startup shortcuts (remote work + power agent), installs `paho-mqtt`,
   installs RustDesk as a service (UAC prompt). Needs Python on PATH and `firmware\main\secrets.h` filled in
   (the power agent reuses its MQTT login).
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
