# PC dashboard: monitor, power, and Claude Code session launcher

Date: 2026-10-30. Status: design, awaiting approval.

## Why

The owner works from an office where the only clients are a locked-down work laptop (browser only, nothing can be
installed) and a phone. Today the home PC wakes over MQTT and boots straight into one `claude remote-control` server
in `C:\Users\gunka\workspace`, which shows up in claude.ai/code. To work in any other project folder they must
RustDesk into the PC, open cmd, `cd` to the folder and run `claude remote-control` by hand. That is slow on a laptop
and miserable on a phone.

The goal of this phase is a web dashboard, reachable from any browser, that removes the RustDesk step: pick a folder,
pick a permission mode, start a Claude Code session there, and see/stop what is running. While we are at it, the
dashboard also shows basic PC health and carries the power buttons the phone MQTT panel has today.

Success: from the phone, wake the PC, start a session in `workspace\horizon` with full access, open claude.ai/code and
see it, all without RustDesk.

## Goals

1. **Session launcher.** List the subfolders of `C:\Users\gunka\workspace`. Start a Claude Code Remote Control session
   in a chosen folder with a permission mode chosen at launch (preselected: `bypassPermissions`, the owner's usual
   "full access"; the others — `acceptEdits`, `auto`, `default`, `dontAsk`, `plan` — one tap away).
2. **Session list.** Show every running `claude remote-control` process on the PC: folder, permission mode (if known),
   start time. Stop any of them (with a confirm). This includes the one `start-remote.ps1` launches at boot.
3. **PC monitor.** At-a-glance basics: online/offline, CPU %, RAM, GPU util / VRAM / temp, CPU temp if obtainable,
   disk free, uptime. Live-ish (refresh every few seconds while the PC is on; "last seen" when it is not).
4. **Power control.** Wake / Sleep / Hibernate / Shutdown buttons (Shutdown confirms), plus ESP32 and PC online LEDs —
   the same things the IoT MQTT Panel shows.
5. **Usable from a phone** browser first, work laptop browser second.
6. **Auto-deploy** via GitHub Actions to the existing Oracle VM, following the horizon/legion pattern.

## Non-goals

- Chatting inside the dashboard. Conversation stays in claude.ai/code / the Claude app. (The owner said a built-in
  chat "sounds cool but not the priority" — a possible later phase.)
- Folders outside `C:\Users\gunka\workspace` (e.g. OneDrive projects). Not now.
- Managing Codex, RustDesk, or anything other than Claude Code sessions.
- Long-term metric history / graphs. Current values are enough; Grafana already exists on the VM if that is ever wanted.
- Multiple users. One owner.
- Replacing the IoT MQTT Panel. It must keep working unchanged.

## Anti-goals (fails even if it "works")

- **Anyone other than the owner can reach the controls.** This page can start a Claude session with
  `bypassPermissions` on the home PC — effectively remote code execution. Auth is not optional and must fail closed.
- **Broker access alone is enough to start a session.** The MQTT login is shared widely (see "Signed commands").
- **The PC agent runs arbitrary input.** Folder must be one of the listed workspace subfolders (matched by name, no
  paths, no `..`), mode must be from the fixed enum. The agent never builds a shell string from message content.
- **Stale commands fire.** Same rule the project already follows: command messages are non-retained, retained ones
  are ignored, and nothing queued while the PC was off/asleep replays on wake.
- **Breaking what works today:** ESP32 wake, the existing `wol/desktop` payloads, the phone panel, the boot-time
  session, sleep/hibernate behaviour.
- **Sessions die with the agent.** Restarting/crashing the agent must not kill running Claude sessions, and the agent
  must rediscover them after a restart.

## Existing system (what we build on)

- `firmware/` — ESP32 subscribes to `wol/desktop` on EMQX Serverless (TLS 8883), sends a magic packet on `wake`,
  publishes retained `online`/`offline` (LWT) to `wol/desktop/status`.
- `pc/power-agent.pyw` — runs hidden at logon (Startup shortcut), paho-mqtt client id `pc-desktop`, clean session,
  handles `shutdown`/`hibernate`/`sleep` on `wol/desktop`, publishes retained LWT to `wol/desktop/pc`, reads broker
  login from `firmware/main/secrets.h`, logs to `pc/power-agent.log`, has `--dry-run`.
- `pc/start-remote.ps1` — at logon waits for internet, starts `claude remote-control` minimized in
  `%USERPROFILE%\workspace`, starts Codex, locks the screen.
- `pc/setup.ps1` — creates the Startup shortcuts, installs `paho-mqtt`.
- Claude Code on PC: `C:\Users\gunka\.local\bin\claude.exe`, v2.1.312. `claude remote-control` options of interest:
  `--name`, `--permission-mode <mode>`, `--spawn same-dir|worktree|session`, `--capacity`,
  `--[no-]create-session-in-dir`. One server is tied to the directory it was started in.
- PC GPU: RTX 5060 Ti, `nvidia-smi` on PATH. `psutil` is **not** installed yet.
- Oracle VM (`ubuntu@161.118.201.235`, aarch64, 11 GB RAM ~4 GB free, **disk 87% used, ~6 GB free**). Runs gunvest,
  legion, horizon, binanceth, oculory stacks in Docker. Public ingress is the `global-tunnel` cloudflared container on
  the external Docker network `tunnel-gateway`; tunnel is remotely managed (ingress rules live in Cloudflare, not on
  the VM). Apps live under `/opt/<app>/app`.
- CI pattern (horizon `.github/workflows/ci.yml`, legion `.github/workflows/ci.yml`): test → docker build →
  `appleboy/ssh-action@v1` to the VM using secrets `ORACLE_VM_HOST` + `ORACLE_VM_SSH_KEY`; on the VM clone/pull into
  `/opt/<app>/app` with `GITHUB_TOKEN`, write `.env` from secrets, `docker compose -f docker-compose.prod.yml up -d
  --build`, `docker system prune -f`. The app container joins `tunnel-gateway` with no host port.
- Repo: `github.com/givewgun/esp32-wol`, branch `main`. `gh` CLI is logged in as `givewgun`.

## Design (decided)

### Shape

```
browser (phone / work laptop)
   │ HTTPS  pc.givewgun.com   (Cloudflare Access: owner's email only)
   ▼
Cloudflare Tunnel (global-tunnel) ──► pc-dash container on the Oracle VM (tunnel-gateway network)
                                         │ MQTT over TLS 8883
                                         ▼
                                     EMQX Serverless  ◄──── ESP32 (wake, wol/desktop/status)
                                         ▲
                                         │ MQTT over TLS 8883
                                      PC agent (pc/power-agent.pyw grows into this)
                                         │ spawns / kills
                                         ▼
                                  claude remote-control  ──► claude.ai/code
```

- **VM ↔ PC transport is MQTT via the existing EMQX broker** (owner approved). The PC opens no ports, wake already
  needs MQTT, and the phone panel keeps working. Tailscale (used by legion) is not used here.
- **Dashboard lives in this repo** under `dashboard/` and deploys from it (owner approved).
- **Folder scope:** direct subfolders of `C:\Users\gunka\workspace` only (owner's decision).
- **Permission mode is chosen per launch**, `bypassPermissions` preselected (owner's decision).

### PC agent (extend `pc/power-agent.pyw`)

Keeps everything it does today, and adds:

- **Stats** — publishes a JSON snapshot every ~5 s (≤10 s) to a retained topic, with a timestamp so the dashboard can
  show staleness. Contents: CPU %, RAM used/total, GPU name/util/VRAM/temp (`nvidia-smi --query-gpu ... --format=csv`),
  disk free per fixed drive, uptime, hostname. CPU temperature is best-effort (see "left to builder").
- **Folders** — publishes the sorted list of direct subfolders of `%USERPROFILE%\workspace` (names only, skip hidden
  and dot-folders and anything that is not a real directory) to a retained topic, on connect and on request.
- **Sessions** — the list is derived by **scanning running processes** for `claude remote-control` (by command line),
  not from in-memory bookkeeping, so it survives agent restarts and includes the boot-time session. For each: pid,
  folder (process cwd), permission mode and name parsed from the command line if present, start time. Published
  retained whenever it changes (poll on the stats tick is fine).
- **Commands** on a dedicated JSON command topic (non-retained, retained ignored):
  - `start {folder, mode}` → validate `folder` ∈ current folder list and `mode` ∈ enum; spawn
    `claude.exe remote-control --name "<folder>" --permission-mode <mode>` with cwd = that folder, as an argv list
    (no shell). Detached from the agent (own console, minimized, so it is visible if the owner RustDesks in and
    survives agent exit).
  - `stop {pid}` → only if that pid is currently in the scanned session list; terminate its process tree.
  - `refresh` → republish folders + sessions.
  - Each command carries a client-generated `id`; the agent publishes a result `{id, ok, error?}` to a reply topic so
    the UI can show success/failure.
- **Signed commands (builder's call, owner agreed).** The one EMQX login is shared by the phone panel, the ESP32,
  `secrets.h`, GitHub secrets and the VM, so broker access alone must not be enough to start a session. Every message
  on the command topic is signed by the dashboard backend with HMAC-SHA256 using a secret only the VM and the PC hold
  (`PC_CMD_SECRET`: GitHub secret → VM `.env`; on the PC a gitignored file next to the agent, e.g.
  `pc/agent-secret.txt`). The signature covers the canonical message including `id` and `ts`. The agent rejects
  (and logs) anything unsigned, badly signed, with `ts` more than 60 s from its clock, or with an `id` it has already
  seen in that window. Comparison is constant-time. Power payloads on `wol/desktop` stay unsigned and unchanged, since
  the phone panel and ESP32 must keep working as they are. The ESP32 subscribes to exactly `wol/desktop` (no
  wildcard), so it never receives the command topic; **no firmware change**.
- Requires `psutil` → `setup.ps1` installs it alongside `paho-mqtt`.
- `--dry-run` keeps working for the new commands (log instead of spawn/kill).

The boot-time session from `start-remote.ps1` stays as is; the dashboard simply discovers and can stop it.

### MQTT topics

Existing topics/payloads stay exactly as they are. New topics sit under `wol/desktop/pc/…`. Proposed (builder may
rename, but keep the prefix and the retained/non-retained split):

| Topic | Retained | Publisher | Payload |
|---|---|---|---|
| `wol/desktop` | no | dashboard | existing `wake` / `sleep` / `hibernate` / `shutdown` |
| `wol/desktop/status` | yes | ESP32 | existing |
| `wol/desktop/pc` | yes | PC agent | existing `online` / `offline` |
| `wol/desktop/pc/stats` | yes | PC agent | JSON snapshot + `ts` |
| `wol/desktop/pc/folders` | yes | PC agent | JSON array of names |
| `wol/desktop/pc/sessions` | yes | PC agent | JSON array of sessions + `ts` |
| `wol/desktop/pc/cmd` | no | dashboard | JSON `{id, action, ...}` |
| `wol/desktop/pc/reply` | no | PC agent | JSON `{id, ok, error?}` |

Note: the PC agent today subscribes to the exact topic `wol/desktop`; it must not start reacting to its own retained
topics. When the PC goes offline, retained stats/sessions stay on the broker — the dashboard treats them as "last
known" and greys them out based on `wol/desktop/pc` = `offline` and the `ts` age.

### Dashboard (VM)

- **One container** `pc-dash`: Node 20 + Express backend that serves a built single-page frontend and an API. Frontend:
  React + Vite + Tailwind, matching legion's `web/` stack. Mobile-first single page: status/power card on top, stats,
  session list with Stop, "New session" (folder picker + mode picker + Start), link to `https://claude.ai/code`.
- Backend holds **one** MQTT connection to EMQX (TLS 8883, unique client id, e.g. `pc-dash`), caches the latest
  retained values, and pushes updates to the browser over **Server-Sent Events**. Browser actions are plain
  `POST /api/...` calls that the backend validates (same enums/allowlist) and publishes. The browser never talks to
  MQTT directly and never sees broker credentials.
- **Auth: Cloudflare Access** on `pc.givewgun.com` with an allow policy for exactly the owner's email, sign-in by
  **one-time PIN** emailed to that address (owner's decision; works from the locked-down work laptop). The address is
  never committed to the repo: it lives only in the Cloudflare Access policy and in the GitHub secret
  `ALLOWED_EMAIL`, which the backend also checks against the JWT's `email` claim. The backend additionally verifies the `Cf-Access-Jwt-Assertion`
  JWT (team domain + application AUD from env) on every `/api` request and rejects if missing/invalid — fail closed,
  so a misrouted tunnel or a request from another container on `tunnel-gateway` cannot drive it. This is the
  builder's call over copying legion's Google-OAuth code, because it needs no Google Cloud console changes and
  Cloudflare is already scriptable from this environment.
- `docker-compose.prod.yml` in `dashboard/`: container name `pc-dash`, `expose` only, networks `default` +
  external `tunnel-gateway`, `restart: unless-stopped`, healthcheck on `/api/health` (unauthenticated, returns only
  `ok` + MQTT connection state). Keep the image small (multi-stage, alpine/slim) — VM disk is tight.

### Deployment

- New workflow `.github/workflows/dashboard.yml`, triggered on push to `main` touching `dashboard/**` or the workflow
  itself, plus `workflow_dispatch`; PRs run tests only. Jobs: test (vitest, lint/typecheck if present) → docker build →
  deploy over SSH, mirroring horizon: clone/pull into `/opt/pc-dash/app`, write `dashboard/.env` from secrets,
  `docker compose -f dashboard/docker-compose.prod.yml up -d --build`, `docker system prune -f`. Deploy job uses a
  `concurrency` group that never cancels mid-flight (legion pattern).
- **GitHub secrets on `givewgun/esp32-wol`** (set with `gh secret set`): `ORACLE_VM_HOST` (161.118.201.235),
  `ORACLE_VM_SSH_KEY` (from `C:\Users\gunka\OneDrive\Documents\gunvest\givewgun-pvt.key`), `MQTT_URI`, `MQTT_USER`,
  `MQTT_PASS` (values from `firmware/main/secrets.h`), `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ALLOWED_EMAIL`, `PC_CMD_SECRET`
  (freshly generated, 32+ random bytes; same value written to the PC's secret file).
- **Cloudflare** (via the Cloudflare MCP/API): add public hostname `pc.givewgun.com` → `http://pc-dash:<port>` to the
  existing remotely-managed tunnel used by `global-tunnel` (do not disturb its other routes), DNS CNAME, and a
  Cloudflare Access self-hosted application + allow policy for the owner's email.

### Testing and security testing (owner asked for both)

- **Unit tests:** dashboard backend (vitest: input validation, HMAC signing, Access JWT verification incl. missing /
  wrong AUD / expired / wrong issuer, SSE state) and PC agent (pytest: signature verify, replay window, folder/mode
  validation, process-scan parsing, `--dry-run`). CI runs the dashboard tests; agent tests run locally (Windows).
- **End-to-end on the real system:** wake → stats appear → start a session in a workspace folder with each of two
  modes → it appears in claude.ai/code and in the session list → stop it → the boot-time session is listed and
  stoppable → agent restart rediscovers sessions without killing them → phone panel buttons still work.
- **Pentest of our own components (authorized by the owner; scope is only `pc.givewgun.com`, the `pc-dash`
  container, the PC agent and our own MQTT topics — no testing of Cloudflare's or EMQX's own infrastructure, no load or
  DoS testing):**
  - Unauthenticated / forged-header access to every route, from the internet and from another container on
    `tunnel-gateway` (forged `Cf-Access-Jwt-Assertion`, `Cf-Access-Authenticated-User-Email` header alone, JWT with
    wrong AUD/alg `none`/expired).
  - MQTT attacks with the shared broker login: unsigned, badly signed, replayed, stale-`ts` and retained commands on
    the command topic; malformed JSON / oversized payloads must not crash the agent.
  - Input injection: folder names with `..`, absolute paths, `\`, quotes, `&`, `|`, unicode tricks, names of folders
    that don't exist; modes outside the enum; `stop` with pids that are not Claude sessions (e.g. `explorer.exe`).
  - Web: CSRF on POST routes (Access cookie is SameSite; still require JSON content-type / a custom header), XSS via
    folder names rendered in the UI, no secrets in the frontend bundle or `/api/health`, security headers.
  - Results written up in `docs/superpowers/specs/2026-10-30-pc-dashboard-pentest.md`: what was tried, what happened,
    what got fixed.

### Docs

README gets a "Dashboard" section: what it does, URL, new MQTT topics (extend the existing table), PC agent new
deps/behaviour, how deploy works, which secrets exist.

## Left to the builder

- Exact topic names within the `wol/desktop/pc/` prefix and JSON field names.
- Stats interval within 5–10 s. Keep payloads small (EMQX Serverless free tier meters traffic and session minutes; ~5 s
  × <1 KB is fine).
- CPU temperature source. Windows has no reliable built-in; options are LibreHardwareMonitor's WMI namespace if
  running, or omit the field. Omit rather than show a wrong number. GPU temp via `nvidia-smi` is required.
- How to spawn the detached, minimized console on Windows from `pythonw` (e.g. `CREATE_NEW_CONSOLE` +
  `STARTUPINFO` minimized, or `cmd /c start "" /min ...` with an argv list).
- How to detect `claude remote-control` processes robustly (`claude.exe` name + `remote-control` in cmdline).
- Whether to rename `power-agent.pyw` (if renamed, update `setup.ps1`, the Startup shortcut, `.gitignore`, README).
- Frontend visual design, within "mobile-first, glanceable, confirm on Shutdown and Stop".
- Port inside the container, Node package choices (e.g. `mqtt`, `jose` for JWT verification).

## Risks the builder must check early

1. **Workspace trust prompt.** A folder Claude Code has never been trusted in may show the trust dialog, and a
   headless `remote-control` could hang on it. Verify with a fresh folder. If it blocks, find the supported way to
   pre-trust (e.g. the project entry's `hasTrustDialogAccepted` in `~/.claude.json`) and have the agent apply it only
   to validated workspace subfolders — or surface "needs trust, open once via RustDesk" in the UI.
2. **`--permission-mode` applies to the pre-created session** of a `remote-control` server, not only to on-demand
   ones. Verify; if not, find the flag combo that does (e.g. `--spawn session`).
3. **Two servers in the same folder** (owner starts a second session where one already runs). Decide from testing:
   either allow it (each server = one pre-created session, which matches "start a new session") or block it and tell
   the owner to open a new chat in claude.ai/code. Prefer allowing it if it works cleanly.
4. **Process cwd read** via psutil for `claude.exe` under the same user should work; confirm.

### Spike results (2026-10-30, Claude Code 2.1.312, psutil 7.2.2)

1. **Trust:** no prompt and no hang in a never-opened subfolder. `~/.claude.json` has `C:/Users/gunka/workspace`
   trusted and no entry was created for the subfolder, so the parent's trust covers it. No pre-trust code needed.
2. **Permission mode:** the pre-created session's child process is spawned with the server's `--permission-mode`
   (seen in its argv), so the mode applies to it.
3. **Two servers in one folder: refused by Claude Code**, which prints "This folder is already served by a terminal
   `claude remote-control` on this device. Stop it first." and exits. Ruling: the agent refuses `start` for a folder
   that already has a server (`"already running"`), and the UI says to open a new chat for that folder in
   claude.ai/code, or stop the server and start it again to change the mode.
4. **Process shapes:** server = `C:\Users\gunka\.local\bin\claude.exe remote-control [flags]`, cwd readable via psutil.
   Each chat is a child `claude.exe --print --sdk-url ... --session-id cse_... --permission-mode <mode> ...`.
   The VS Code extension runs its own `claude.exe` (from `.vscode\extensions\...`) and the **Claude desktop app is
   also `Claude.exe`** (under `WindowsApps`), so matching must use `argv[1] == "remote-control"`, never the name
   alone. Killing the server's process tree (children first) cleanly stops it and its chats.
