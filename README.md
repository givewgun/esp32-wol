# esp32-wol

Wake the home PC from anywhere and have it ready for remote AI work (Claude Code + Codex).

```
phone (IoT MQTT Panel) ──"wake"──> EMQX Cloud (TLS 8883) ──> ESP32 at home ──magic packet──> PC
PC boots -> auto-login -> start-remote.ps1 -> Claude Code remote-control + Codex app -> lock screen
work laptop -> claude.ai/code (Claude)  |  phone -> ChatGPT app (Codex)  |  RustDesk (desktop, sleep/shutdown)
```

## MQTT topics

| Topic | Payload | Who |
|---|---|---|
| `wol/desktop` | `wake` (QoS 1, **not retained**) | phone publishes, ESP32 sends magic packet |
| `wol/desktop/status` | `online` / `offline` (retained, LWT) | ESP32 publishes |

Retained messages on `wol/desktop` are ignored on purpose so a stale `wake` can't fire on every reconnect.

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
2. Run `pc\setup.ps1`: adds the logon startup shortcut, installs RustDesk as a service (UAC prompt).
3. Auto-login: `winget install Microsoft.Sysinternals.Autologon`, run `Autologon`, enter your Windows password, Enable.
   Microsoft account: username = account email, **domain empty**, password = account password (not PIN).
   With a Microsoft account, turn off *Settings > Accounts > Sign-in options > "Only allow Windows Hello sign-in"* first.
4. Already done: Wake-on-LAN in BIOS + NIC, Fast Startup off.

Normal sleep/hibernate timers stay on: an idle PC goes back to sleep, and you wake it again from the phone.
Wake from sleep resumes the existing session, so the startup script only runs after a cold boot.

## Phone (IoT MQTT Panel)

- Connection: your EMQX Serverless address, port `8883`, network protocol **MQTT SSL**, username/password from EMQX.
- Button panel: topic `wol/desktop`, payload `wake`, QoS 1, retain off.
- LED panel: topic `wol/desktop/status`, on = `online`, off = `offline`.
