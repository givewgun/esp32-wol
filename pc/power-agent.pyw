# PC agent: MQTT power commands on wol/desktop, plus the dashboard side channel on wol/desktop/pc/*
# (stats, workspace folders, Claude Code Remote Control sessions, signed start/stop commands).
# Runs at logon (Startup shortcut from setup.ps1). Reuses the broker login from firmware/main/secrets.h.
# Usage: pythonw power-agent.pyw [--dry-run]   (--dry-run logs commands instead of acting)
import ctypes
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import paho.mqtt.client as mqtt

from pcagent.commands import CommandHandler
from pcagent.folders import list_folders
from pcagent.sessions import scan_sessions
from pcagent.stats import collect_stats

TOPIC_CMD = "wol/desktop"          # same topic as "wake"; the ESP32 handles that one
TOPIC_STATUS = "wol/desktop/pc"    # retained "online"/"offline" (LWT)
TOPIC_STATS = "wol/desktop/pc/stats"        # retained JSON snapshots for the dashboard
TOPIC_FOLDERS = "wol/desktop/pc/folders"
TOPIC_SESSIONS = "wol/desktop/pc/sessions"
TOPIC_DASH_CMD = "wol/desktop/pc/cmd"       # signed JSON commands from the dashboard
TOPIC_REPLY = "wol/desktop/pc/reply"
STATS_EVERY = 5
HERE = Path(__file__).resolve().parent
SECRETS = HERE.parent / "firmware" / "main" / "secrets.h"
CMD_SECRET = HERE / "agent-secret.txt"     # shared with the dashboard only (GitHub secret PC_CMD_SECRET)
WORKSPACE = Path.home() / "workspace"
DRY_RUN = "--dry-run" in sys.argv


def log(msg):
    # pythonw has no console; keep a small log next to the script
    with open(Path(__file__).with_suffix(".log"), "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
    if sys.stdout:
        print(msg, flush=True)


def read_secrets():
    text = SECRETS.read_text(encoding="utf-8")
    get = lambda name: re.search(rf'#define\s+{name}\s+"([^"]*)"', text).group(1)
    return urlparse(get("MQTT_URI")), get("MQTT_USER"), get("MQTT_PASS")


def read_cmd_secret():
    try:
        return CMD_SECRET.read_text(encoding="utf-8").strip() or None
    except FileNotFoundError:
        return None


def sleep_pc():
    # SetSuspendState(hibernate=False, force=False, disableWakeEvent=False): S3 sleep, Wake-on-LAN stays armed
    ctypes.windll.powrprof.SetSuspendState(False, False, False)


ACTIONS = {
    "shutdown": lambda: subprocess.run(["shutdown", "/s", "/f", "/t", "0"]),
    "hibernate": lambda: subprocess.run(["shutdown", "/h"]),
    "sleep": sleep_pc,
}

cmd_secret = read_cmd_secret()
handler = CommandHandler(cmd_secret, WORKSPACE, dry_run=DRY_RUN) if cmd_secret else None
last = {}  # topic -> last published payload, so folders/sessions only go out when they change


def publish_if_changed(client, topic, payload):
    if last.get(topic) != payload:
        client.publish(topic, payload, qos=1, retain=True)
        last[topic] = payload


def on_connect(client, userdata, flags, reason_code, properties):
    log(f"MQTT connected: {reason_code}")
    last.clear()  # republish everything after a reconnect
    client.subscribe([(TOPIC_CMD, 1), (TOPIC_DASH_CMD, 1)])
    client.publish(TOPIC_STATUS, "online", qos=1, retain=True)


def on_power(client, cmd):
    action = ACTIONS.get(cmd)
    if action is None:
        return  # "wake" and anything else is not for us
    log(f"Command: {cmd}{' (dry run)' if DRY_RUN else ''}")
    if DRY_RUN:
        return
    # Say goodbye first: the LWT would only fire after the keepalive times out
    client.publish(TOPIC_STATUS, "offline", qos=1, retain=True).wait_for_publish(5)
    action()


def on_dashboard(client, payload):
    if handler is None:
        log(f"Dashboard command ignored: {CMD_SECRET.name} missing")
        return
    reply = handler.handle(payload)
    if reply is None:
        log("Dashboard command ignored: malformed")
        return
    log(f"Dashboard command {reply}{' (dry run)' if DRY_RUN else ''}")
    client.publish(TOPIC_REPLY, json.dumps(reply), qos=1)


def on_message(client, userdata, msg):
    # Ignore retained messages so a stale command can't fire on every reconnect
    if msg.retain:
        return
    try:
        if msg.topic == TOPIC_CMD:
            on_power(client, msg.payload.decode(errors="replace"))
        elif msg.topic == TOPIC_DASH_CMD:
            on_dashboard(client, msg.payload)
    except Exception as e:  # never let one bad message kill the network thread
        log(f"Error handling {msg.topic}: {e!r}")


def publish_state(client):
    now = int(time.time())
    client.publish(TOPIC_STATS, json.dumps(collect_stats(now)), qos=0, retain=True)
    publish_if_changed(client, TOPIC_FOLDERS, json.dumps(list_folders(WORKSPACE)))
    sessions = scan_sessions(WORKSPACE)
    if last.get("sessions") != sessions:
        client.publish(TOPIC_SESSIONS, json.dumps({"ts": now, "sessions": sessions}), qos=1, retain=True)
        last["sessions"] = sessions


def main():
    uri, user, password = read_secrets()
    if handler is None:
        log(f"{CMD_SECRET.name} missing: dashboard session commands disabled (run setup.ps1)")
    # Clean session: a command sent while the PC is off/asleep is dropped, not replayed on next wake
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="pc-desktop", clean_session=True)
    client.username_pw_set(user, password)
    client.tls_set()  # Windows root store, same DigiCert chain the ESP32 trusts
    client.will_set(TOPIC_STATUS, "offline", qos=1, retain=True)
    client.on_connect = on_connect
    client.on_message = on_message
    client.reconnect_delay_set(min_delay=1, max_delay=60)
    client.connect_async(uri.hostname, uri.port or 8883, keepalive=30)
    client.loop_start()  # reconnects on its own, e.g. after resume
    while True:
        if client.is_connected():
            try:
                publish_state(client)
            except Exception as e:
                log(f"Error publishing state: {e!r}")
        time.sleep(STATS_EVERY)


if __name__ == "__main__":
    main()
