# esp32-wol

Wake your home PC from anywhere with a $5 ESP32, and have it come up ready for remote work.

Tap **Wake** on your phone. An ESP32 on your home network gets the message through a cloud MQTT broker and sends a
Wake-on-LAN magic packet to the PC. The PC boots, logs in, starts your remote tools (Claude Code Remote Control,
Codex, RustDesk) and locks the screen. When you're done, tap **Sleep**, **Hibernate** or **Shutdown**.

No port forwarding, no VPN, no always-on PC, no inbound connections to your home network. Everything talks *out* to
the broker over TLS.

```
phone ──"wake"──> MQTT broker (TLS 8883) ──> ESP32 at home ──magic packet──> PC
PC boots -> auto-login -> start-remote.ps1 -> Claude Code remote-control + Codex + RustDesk -> lock screen
phone ──"sleep" / "hibernate" / "shutdown"──> broker ──> PC agent on the PC
browser ──> dashboard (optional, behind Cloudflare Access) ──MQTT──> PC agent: stats, power, Claude Code sessions
```

## What you get

| Part | What it does | Needed? |
|---|---|---|
| **ESP32 firmware** (`firmware/`) | Listens for `wake`, sends the magic packet, reports `online`/`offline` | Yes |
| **Phone panel** (any MQTT app) | Wake/sleep/hibernate/shutdown buttons, ESP32 + PC status lights | Yes, or any MQTT client |
| **PC agent** (`pc/`) | Sleep/hibernate/shutdown on command, startup script, live stats for the dashboard | Optional (wake works without it) |
| **Dashboard** (`dashboard/`) | Web page: PC health, power buttons, start/stop Claude Code sessions in any project folder | Optional |

Start with the ESP32 and a phone panel. That alone gives you remote wake. Add the PC agent for remote power-off, and
the dashboard if you want a browser UI and one-tap Claude Code sessions.

## Requirements

- **ESP32** (classic ESP32 dev board; 2 MB flash is enough) on the same LAN as the PC, on **2.4 GHz** Wi-Fi.
- **PC** with Wake-on-LAN support, **wired Ethernet** (Wi-Fi WoL is unreliable), Windows 10/11 for the PC agent.
- **MQTT broker** reachable over TLS. The project uses [EMQX Cloud Serverless](https://www.emqx.com/en/cloud/serverless-mqtt)
  (free tier is plenty). Any broker with a publicly trusted certificate works.
- **ESP-IDF v6.1** to build the firmware.
- For the PC agent: Python 3.10+ on `PATH`.
- For the dashboard: a Linux host with Docker, a domain on Cloudflare, Cloudflare Tunnel + Access (free plan works).

## Get started

Follow **[docs/setup.md](docs/setup.md)**. It goes broker → ESP32 → phone → PC → dashboard, and you can stop after any
step.

## Documentation

| Doc | Covers |
|---|---|
| [Setup guide](docs/setup.md) | End-to-end install, step by step |
| [Firmware](docs/firmware.md) | Building, flashing, how the ESP32 side works |
| [PC agent](docs/pc-agent.md) | Startup script, power commands, auto-login, the dashboard side channel |
| [Dashboard](docs/dashboard.md) | Features, Cloudflare setup, deploying, local development |
| [MQTT protocol](docs/mqtt-protocol.md) | Every topic and payload, command signing, writing your own client |
| [Security](docs/security.md) | Threat model and what protects what |
| [Customizing](docs/customizing.md) | Changing topics, workspace folder, startup apps |
| [Troubleshooting](docs/troubleshooting.md) | PC won't wake, agent offline, dashboard errors |

## Repository layout

```
firmware/     ESP-IDF project for the ESP32 (C)
pc/           Windows PC agent (Python) + setup and startup scripts (PowerShell)
dashboard/    Web dashboard: Express server + React SPA, Dockerfile, compose file
.github/      CI: dashboard tests, build, deploy over SSH
docs/         Documentation
```

## Tests

```powershell
python -m pytest pc\tests                          # PC agent
cd dashboard; npm ci; npm run lint; npm test        # dashboard
```
