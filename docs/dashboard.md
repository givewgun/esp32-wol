# Dashboard

A small web app for watching and controlling the PC from a phone or any browser, with nothing to install on the
client. Useful from a locked-down work laptop.

## Features

- **Status:** ESP32 and PC online/offline, last-seen time.
- **Stats:** CPU, RAM, GPU (utilization, VRAM, temperature), disks, uptime. Live every 5 s while the PC is on.
- **Power:** Wake, Sleep, Hibernate, Shutdown (Shutdown asks for confirmation).
- **New session:** pick a folder in `%USERPROFILE%\workspace` and a permission mode (`bypassPermissions` preselected;
  also `acceptEdits`, `auto`, `default`, `dontAsk`, `plan`). The PC starts `claude remote-control` there. Then open
  [claude.ai/code](https://claude.ai/code) or the Claude app and chat as usual.
  - One Remote Control server per folder (Claude Code's rule). Open more chats in a running folder from
    claude.ai/code, or stop and restart it to change the mode.
- **Trust folder:** untrusted folders show `(untrusted)` and can't be started. *Trust folder* (two taps) trusts it the
  same way the CLI prompt would.
- **New folder:** name (letters, digits, `- _ .`, up to 64 chars) and optional `git init`. Created in the workspace and
  trusted.
- **Sessions:** every running `claude remote-control` on the PC, including the one started at boot. *Stop* kills that
  server and its chats.

## Architecture

```
browser ──HTTPS──> Cloudflare Access ──> Cloudflare Tunnel ──> pc-dash container (Express, port 8080)
                                                                    │
                                                         MQTT over TLS (subscribe state, publish commands)
                                                                    │
                                                              broker <──> PC agent
```

- **Server** (`dashboard/server/`): Express. Subscribes to the PC's retained topics, keeps the latest state in memory,
  streams it to the browser over Server-Sent Events (`/api/events`), and turns API calls into MQTT messages. Session,
  trust and folder commands are HMAC-signed and wait for the PC's signed reply (or time out).
- **Web** (`dashboard/web/`): React + Tailwind SPA, built by Vite into `dist/`, served by the same Express process.
- The container needs no inbound port. Cloudflare Tunnel connects out and routes your hostname to it.

### API

All `/api/*` routes except `/api/health` require a valid Cloudflare Access JWT for `ALLOWED_EMAIL`. POST bodies must be
JSON, at most 4 KB.

| Method | Path | Body | Does |
|---|---|---|---|
| GET | `/api/health` | | `{ok, mqtt}`; used by the container healthcheck |
| GET | `/api/events` | | SSE stream of the full state on every change |
| POST | `/api/power` | `{action}` | `wake` / `sleep` / `hibernate` / `shutdown` |
| POST | `/api/sessions` | `{folder, mode}` | Start a session (folder must be listed and trusted) |
| POST | `/api/sessions/:pid/stop` | | Stop a listed session |
| POST | `/api/folders/trust` | `{folder}` | Trust a listed folder |
| POST | `/api/folders` | `{folder, git}` | Create a folder (`git`: boolean) |

Errors: `409` PC offline / folder not trusted, `502` PC refused, `503` dashboard not connected to the broker, `504` PC
didn't answer within 10 s.

## Configuration

Every variable is required. The server refuses to start if any is missing.

| Variable | Example | Meaning |
|---|---|---|
| `MQTT_URI` | `mqtts://xxxx.emqxsl.com:8883` | Broker |
| `MQTT_USER` / `MQTT_PASS` | | Broker login |
| `CF_ACCESS_TEAM_DOMAIN` | `yourteam.cloudflareaccess.com` | Your Zero Trust team domain |
| `CF_ACCESS_AUD` | `4f2c...` | *Application Audience (AUD) Tag* of the Access application |
| `ALLOWED_EMAIL` | `you@example.com` | The only email allowed in |
| `PC_CMD_SECRET` | | Contents of `pc\agent-secret.txt` on the PC |
| `PORT` | `8080` | Optional, default 8080 |

## Cloudflare setup

You need a domain on Cloudflare and a host (e.g. a free-tier cloud VM) running Docker. Replace `pc.example.com` with
your hostname.

1. **Tunnel.** *Zero Trust > Networks > Tunnels*: create a tunnel and run its `cloudflared` connector on the host as a
   Docker container on a network the dashboard can join. The compose file expects an external Docker network named
   `tunnel-gateway`:

   ```bash
   docker network create tunnel-gateway
   docker run -d --name cloudflared --restart unless-stopped --network tunnel-gateway \
     cloudflare/cloudflared:latest tunnel --no-autoupdate run --token <TUNNEL_TOKEN>
   ```

   Add a public hostname `pc.example.com` → `http://pc-dash:8080`.
2. **Access application.** *Zero Trust > Access > Applications > Add > Self-hosted*: domain `pc.example.com`, policy
   *Allow*, include *Emails* = your email. Use the *One-time PIN* login method (or any IdP). Copy the application's
   **AUD tag** into `CF_ACCESS_AUD`.
3. Your team domain (*Zero Trust > Settings > Custom Pages*, or the URL of your Access login page) goes into
   `CF_ACCESS_TEAM_DOMAIN`.

The server verifies the `Cf-Access-Jwt-Assertion` header itself on every API call (signature, issuer, audience, email),
so a request that reaches the container without going through Access gets nothing.

## Deploy

### By hand

```bash
git clone https://github.com/<you>/esp32-wol && cd esp32-wol/dashboard
cat > .env <<'EOF'
MQTT_URI=mqtts://xxxx.emqxsl.com:8883
MQTT_USER=...
MQTT_PASS=...
CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com
CF_ACCESS_AUD=...
ALLOWED_EMAIL=you@example.com
PC_CMD_SECRET=...
EOF
chmod 600 .env
docker compose -f docker-compose.prod.yml up -d --build
```

### With GitHub Actions

`.github/workflows/dashboard.yml` runs lint, tests and build on every PR touching `dashboard/**`. On push to `main` it
also SSHes into your host as `ubuntu`, checks out the commit in `/opt/pc-dash/app`, writes `dashboard/.env` from
repository secrets, and runs `docker compose up -d --build`.

Add these repository secrets:

| Secret | Value |
|---|---|
| `ORACLE_VM_HOST` | Host IP or name (any SSH host works despite the name) |
| `ORACLE_VM_SSH_KEY` | Private key for the `ubuntu` user |
| `MQTT_URI`, `MQTT_USER`, `MQTT_PASS` | Broker |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ALLOWED_EMAIL` | Access |
| `PC_CMD_SECRET` | Contents of `pc\agent-secret.txt` |

The host needs Docker, `sudo` without a password for that user, and the `tunnel-gateway` network. If your SSH user isn't
`ubuntu`, change `username:` in the workflow.

## Local development

```bash
cd dashboard
npm ci
npm test          # vitest: server, signing vectors, React components
npm run lint
npm run build     # -> dist/
```

There's no auth bypass: running the server for real needs Cloudflare Access and a broker. The tests use a local JWKS and
a fake broker, so all behavior is covered without either.

`server/sign.js` and `pc/pcagent/signing.py` must produce byte-identical signatures; `test/fixtures/cmd-vector.json`
pins both. Change one, change the other, and update the vector.
