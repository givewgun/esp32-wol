# Setup guide

Five steps. Each one works on its own, so you can stop after step 3 (remote wake) or step 4 (remote wake + power-off).

1. [MQTT broker](#1-mqtt-broker)
2. [ESP32](#2-esp32)
3. [Phone panel](#3-phone-panel)
4. [PC](#4-pc)
5. [Dashboard (optional)](#5-dashboard-optional)

---

## 1. MQTT broker

Everything talks to one MQTT broker over TLS. The steps below use EMQX Cloud Serverless; any broker with a publicly
trusted TLS certificate on port 8883 works the same way.

1. Create a free [EMQX Cloud Serverless](https://www.emqx.com/en/cloud/serverless-mqtt) deployment.
2. Note its address, e.g. `xxxxxxxx.ala.asia-southeast1.emqxsl.com`.
3. Under *Access Control > Authentication*, add a username and password. One login shared by the ESP32, PC agent,
   phone and dashboard is fine: dashboard commands that can run code are signed separately (see
   [security.md](security.md)). Separate logins per device are better if your broker supports topic ACLs.

The broker URI for the rest of this guide is `mqtts://<your-address>:8883`.

## 2. ESP32

Full details: [firmware.md](firmware.md).

### Prepare the PC for Wake-on-LAN

Do this first, or the magic packet will arrive at a PC that ignores it.

- **BIOS/UEFI:** enable *Wake on LAN* / *Power On By PCI-E* (name varies by vendor). Disable *ErP* / *Deep Sleep*
  if present, since they cut power to the NIC.
- **Windows, Device Manager > your Ethernet adapter > Properties:**
  - *Power Management*: tick *Allow this device to wake the computer* and *Only allow a magic packet to wake*.
  - *Advanced*: set *Wake on Magic Packet* = Enabled (and *Shutdown Wake-On-Lan* = Enabled if listed).
- **Windows Fast Startup off:** *Control Panel > Power Options > Choose what the power buttons do > Turn on fast
  startup* (untick). Fast Startup often prevents waking from a shutdown.
- Note the adapter's **MAC address**: `getmac /v` or `ipconfig /all` (*Physical Address* of the Ethernet adapter).

### Build and flash

Install [ESP-IDF v6.1](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/get-started/), then:

```powershell
. $env:IDF_PATH\export.ps1          # or open the "ESP-IDF PowerShell" shortcut
cd firmware
copy main\secrets.example.h main\secrets.h
```

Fill in `main\secrets.h`:

```c
#define WIFI_SSID "your-2.4ghz-ssid"
#define WIFI_PASS "your-wifi-password"

#define MQTT_URI  "mqtts://xxxxxxxx.ala.asia-southeast1.emqxsl.com:8883"
#define MQTT_USER "device"
#define MQTT_PASS "your-mqtt-password"

#define PC_MAC { 0x00, 0x11, 0x22, 0x33, 0x44, 0x55 }   // PC's wired NIC
```

Then:

```powershell
idf.py build
idf.py -p COM3 flash monitor        # your port; hold BOOT if it says "Wrong boot mode"
```

In the monitor you should see `MQTT connected`. Leave the ESP32 plugged into USB power somewhere on your LAN.

`secrets.h` is gitignored. The PC agent reads its MQTT login from this same file, so keep it on the PC even if you
flash from another machine.

## 3. Phone panel

Any MQTT client works. These steps use **IoT MQTT Panel** (Android/iOS).

Connection:

| Setting | Value |
|---|---|
| Broker | your broker address |
| Port | `8883` |
| Network protocol | **MQTT SSL** |
| Username / password | your broker login |

Panels (every button: QoS 1, **retain off**):

| Panel | Name | Topic | Payload / settings |
|---|---|---|---|
| Button | Wake | `wol/desktop` | `wake` |
| Button | Sleep | `wol/desktop` | `sleep` |
| Button | Hibernate | `wol/desktop` | `hibernate` |
| Button | Shutdown | `wol/desktop` | `shutdown`; turn on the confirm option if your app has one |
| LED | ESP32 | `wol/desktop/status` | on = `online`, off = `offline` |
| LED | PC | `wol/desktop/pc` | on = `online`, off = `offline` |

> **Retain must be off.** The ESP32 and PC agent ignore retained commands on purpose, so a retained `wake` does
> nothing (and would otherwise fire on every reconnect).

**Test:** shut the PC down, tap **Wake**. It should power on within a few seconds. The Sleep/Hibernate/Shutdown buttons
need step 4.

## 4. PC

Full details: [pc-agent.md](pc-agent.md).

Prerequisites on the PC:

- Python 3.10+ on `PATH` (`python --version`), with `pythonw.exe` alongside.
- This repo cloned, with `firmware\main\secrets.h` filled in (step 2).
- [Claude Code](https://code.claude.com) installed and logged in, if you want remote AI sessions.
- [RustDesk](https://rustdesk.com) installed to `C:\Program Files\RustDesk`, if you want remote desktop.
- A `%USERPROFILE%\workspace` folder: this is where Claude Code sessions start. Put your projects in it.

Then:

1. **Trust the workspace once.** Run `claude` in `%USERPROFILE%\workspace` and accept the trust prompt.
2. **Run setup** from the repo root:

   ```powershell
   powershell -ExecutionPolicy Bypass -File pc\setup.ps1
   ```

   It adds two logon shortcuts (*Remote Work* and *Power Agent*), installs `paho-mqtt` and `psutil`, generates
   `pc\agent-secret.txt` (the dashboard command key, gitignored), and installs RustDesk as a service (UAC prompt).
   Safe to re-run.
3. **Auto-login**, so a cold boot reaches the desktop without you:

   ```powershell
   winget install Microsoft.Sysinternals.Autologon
   ```

   Run `Autologon`, enter your Windows password, click *Enable*.
   - Microsoft account: username = account email, **domain empty**, password = account password (not your PIN).
   - First turn off *Settings > Accounts > Sign-in options > "For improved security, only allow Windows Hello
     sign-in"*, or auto-login won't work.

   The startup script locks the screen right after it starts your tools, so the PC is never left sitting unlocked.
4. **Start the agent now** (it runs at every logon from now on): double-click *Power Agent* in `shell:startup`, or
   sign out and back in.

**Test:** the PC LED on your phone turns on. Tap **Sleep**. The PC sleeps, the LED goes off. Tap **Wake**. It comes back
and the LED turns on again a few seconds later.

Leave Windows' normal sleep timers on: an idle PC goes back to sleep and you wake it again from the phone. Waking from
sleep or hibernate resumes your session; the startup script only runs after a cold boot.

## 5. Dashboard (optional)

A web page for the PC: health stats, power buttons, and starting/stopping Claude Code sessions in any workspace folder,
from a phone or any browser. It needs a Linux host with Docker and a domain on Cloudflare.

Follow [dashboard.md](dashboard.md).
