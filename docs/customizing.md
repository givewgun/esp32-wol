# Customizing

The defaults match one person's setup. Here's what to change for yours.

## Startup apps

`pc/start-remote.ps1` is a plain PowerShell script that runs at logon. Remove what you don't use and add what you do:

- **No Claude Code?** Delete the `claude remote-control` line and the network wait above it.
- **No Codex?** Delete the `OpenAI.Codex_...` line.
- **Don't want the screen locked?** Delete the `LockWorkStation` line (not recommended with auto-login).
- **Something else**, e.g. Ollama or a game streaming host: add a `Start-Process` line.

## Workspace folder

Claude Code sessions start in `%USERPROFILE%\workspace`, and the dashboard lists its subfolders. To use another folder,
change it in both places:

- `pc/start-remote.ps1`: `$Workspace`
- `pc/power-agent.pyw`: `WORKSPACE`

Then trust the new folder once (`claude` in it, accept the prompt).

## Topic names

The prefix `wol/desktop` is hard-coded. To run several PCs on one broker, or just rename it, change it everywhere:

| File | Where |
|---|---|
| `firmware/main/main.c` | `TOPIC_CMD`, `TOPIC_STATUS` |
| `pc/power-agent.pyw` | `TOPIC_*` constants |
| `dashboard/server/broker.js` | `SUBSCRIBE` list and the two `publish` calls |
| `dashboard/server/state.js` | topic → state map |
| Phone panel | every panel's topic |

Also give each extra PC agent and ESP32 a unique MQTT client ID (`pc-desktop` in `power-agent.pyw`, `esp32-wol` in
`main.c`): two clients with the same ID keep kicking each other off the broker.

## Broker

Any MQTT 3.1.1/5 broker with TLS on 8883 and a certificate from a public CA works (HiveMQ Cloud, a Mosquitto with
Let's Encrypt, ...). For a private CA, the ESP32 needs your CA pinned in `start_mqtt()` and the PC agent's
`client.tls_set()` needs `ca_certs=`.

## Power actions

`ACTIONS` in `pc/power-agent.pyw` maps payloads to what runs. Remove `/f` from `shutdown` if you'd rather have Windows
refuse to shut down over unsaved work, or add your own payloads (e.g. `restart` → `shutdown /r /t 0`). The ESP32 ignores
anything that isn't `wake`.

## Dashboard hostname and network

`dashboard/docker-compose.prod.yml` joins an external Docker network called `tunnel-gateway`, where the `cloudflared`
container lives. Rename it there if your tunnel uses another network, or replace the network with a `ports:` mapping if
you put a different reverse proxy in front. Keep Cloudflare Access (or equivalent) in front either way: the server
requires a valid Access JWT and won't serve the API without one.
