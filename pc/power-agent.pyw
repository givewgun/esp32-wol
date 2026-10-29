# PC power agent: MQTT "shutdown" / "hibernate" / "sleep" on wol/desktop -> power action.
# Runs at logon (Startup shortcut from setup.ps1). Reuses the broker login from firmware/main/secrets.h.
# Usage: pythonw power-agent.pyw [--dry-run]   (--dry-run logs commands instead of acting)
import ctypes
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

import paho.mqtt.client as mqtt

TOPIC_CMD = "wol/desktop"          # same topic as "wake"; the ESP32 handles that one
TOPIC_STATUS = "wol/desktop/pc"    # retained "online"/"offline" (LWT)
SECRETS = Path(__file__).resolve().parent.parent / "firmware" / "main" / "secrets.h"
DRY_RUN = "--dry-run" in sys.argv


def log(msg):
    # pythonw has no console; keep a small log next to the script
    with open(Path(__file__).with_suffix(".log"), "a", encoding="utf-8") as f:
        f.write(msg + "\n")
    if sys.stdout:
        print(msg, flush=True)


def read_secrets():
    text = SECRETS.read_text(encoding="utf-8")
    get = lambda name: re.search(rf'#define\s+{name}\s+"([^"]*)"', text).group(1)
    return urlparse(get("MQTT_URI")), get("MQTT_USER"), get("MQTT_PASS")


def sleep_pc():
    # SetSuspendState(hibernate=False, force=False, disableWakeEvent=False): S3 sleep, Wake-on-LAN stays armed
    ctypes.windll.powrprof.SetSuspendState(False, False, False)


ACTIONS = {
    "shutdown": lambda: subprocess.run(["shutdown", "/s", "/f", "/t", "0"]),
    "hibernate": lambda: subprocess.run(["shutdown", "/h"]),
    "sleep": sleep_pc,
}


def on_connect(client, userdata, flags, reason_code, properties):
    log(f"MQTT connected: {reason_code}")
    client.subscribe(TOPIC_CMD, qos=1)
    client.publish(TOPIC_STATUS, "online", qos=1, retain=True)


def on_message(client, userdata, msg):
    # Ignore retained messages so a stale command can't fire on every reconnect
    if msg.retain:
        return
    cmd = msg.payload.decode(errors="replace")
    action = ACTIONS.get(cmd)
    if action is None:
        return  # "wake" and anything else is not for us
    log(f"Command: {cmd}{' (dry run)' if DRY_RUN else ''}")
    if DRY_RUN:
        return
    # Say goodbye first: the LWT would only fire after the keepalive times out
    client.publish(TOPIC_STATUS, "offline", qos=1, retain=True).wait_for_publish(5)
    action()


def main():
    uri, user, password = read_secrets()
    # Clean session: a command sent while the PC is off/asleep is dropped, not replayed on next wake
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="pc-desktop", clean_session=True)
    client.username_pw_set(user, password)
    client.tls_set()  # Windows root store, same DigiCert chain the ESP32 trusts
    client.will_set(TOPIC_STATUS, "offline", qos=1, retain=True)
    client.on_connect = on_connect
    client.on_message = on_message
    client.reconnect_delay_set(min_delay=1, max_delay=60)
    client.connect_async(uri.hostname, uri.port or 8883, keepalive=30)
    client.loop_forever(retry_first_connection=True)  # reconnects on its own, e.g. after resume


if __name__ == "__main__":
    main()
