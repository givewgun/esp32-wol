# ESP32 firmware

`firmware/` is a small ESP-IDF project (one file, `main/main.c`) that turns an ESP32 into an always-on Wake-on-LAN
bridge.

## What it does

1. Joins your Wi-Fi (station mode).
2. Connects to the MQTT broker over TLS as client `esp32-wol`, keepalive 30 s.
3. Publishes `online` (retained) to `wol/desktop/status`, with a Last Will of `offline` (retained). If the ESP32 loses
   power or Wi-Fi, the broker flips the status to `offline` after the keepalive times out.
4. Subscribes to `wol/desktop` at QoS 1.
5. On a **non-retained** `wake` message, broadcasts a magic packet (6 × `0xFF` + 16 × the PC's MAC) to
   `255.255.255.255:9` over UDP, three times in case one is dropped.

Everything else on `wol/desktop` (`sleep`, `shutdown`, ...) is logged as unknown and ignored. Those are for the PC agent.
Retained messages are ignored so a stale `wake` can't fire every time the ESP32 reconnects.

## Hardware

- Classic ESP32 (the `esp32` target), any dev board. 2 MB flash is enough (`sdkconfig.defaults` selects the large
  single-app partition, since Wi-Fi + TLS + MQTT won't fit the default 1 MB app slot).
- 2.4 GHz Wi-Fi on the **same broadcast domain** as the PC. A guest network or isolated VLAN won't reach it.
- USB power. No other wiring.

## Build

Requires [ESP-IDF v6.1](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/get-started/). The MQTT client
comes from the component manager (`main/idf_component.yml`), fetched on first build.

```powershell
. $env:IDF_PATH\export.ps1
cd firmware
copy main\secrets.example.h main\secrets.h   # first time only, then fill it in
idf.py build
idf.py -p COM3 flash monitor
```

Linux/macOS: same commands with `. $IDF_PATH/export.sh`, `cp`, and a port like `/dev/ttyUSB0`.

If flashing fails with `Wrong boot mode detected`, hold the **BOOT** button on the board while it connects.

## secrets.h

| Define | Example | Notes |
|---|---|---|
| `WIFI_SSID` | `"home-2g"` | 2.4 GHz only |
| `WIFI_PASS` | `"..."` | |
| `MQTT_URI` | `"mqtts://xxxx.emqxsl.com:8883"` | Must be `mqtts://` |
| `MQTT_USER` / `MQTT_PASS` | | Broker login |
| `PC_MAC` | `{ 0x00, 0x11, 0x22, 0x33, 0x44, 0x55 }` | MAC of the PC's **wired** NIC |

The file is gitignored. The PC agent parses `MQTT_URI`, `MQTT_USER` and `MQTT_PASS` out of it with a regex, so keep the
`#define NAME "value"` format.

## TLS

The firmware uses ESP-IDF's built-in certificate bundle (`esp_crt_bundle_attach`), so there's no CA file to manage.
Any broker whose certificate chains to a common public root works (EMQX Cloud chains to DigiCert Global Root G2).
A self-signed broker certificate won't work without changing `start_mqtt()` to pin your CA.

## Monitoring

`idf.py monitor` log lines to look for:

| Log | Meaning |
|---|---|
| `MQTT connected` | Connected and subscribed |
| `Magic packet sent` | Got `wake`, sent the packet |
| `Ignoring retained message` | Someone published `wake` with retain on; fix the sender |
| `Unknown command: sleep` | Normal: power commands are for the PC agent |
| `MQTT disconnected` | Broker or Wi-Fi problem; it reconnects on its own |

From anywhere, the `wol/desktop/status` topic tells you whether the ESP32 is up.
