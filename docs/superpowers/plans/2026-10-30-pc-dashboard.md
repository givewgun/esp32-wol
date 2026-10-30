# PC Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A web dashboard at `pc.givewgun.com` that shows PC health, sends power commands, and starts/lists/stops Claude Code Remote Control sessions in `C:\Users\gunka\workspace\<folder>` with a per-launch permission mode.

**Architecture:** The PC agent (`pc/power-agent.pyw`, extended with a `pc/pcagent/` package) publishes stats/folders/sessions to EMQX and executes HMAC-signed commands. A Node/Express container `pc-dash` on the Oracle VM holds the only MQTT connection, verifies Cloudflare Access JWTs, signs commands, and streams state to a React SPA over SSE. GitHub Actions deploys it over SSH like horizon/legion.

**Tech Stack:** Python 3.14 + paho-mqtt 2.1 + psutil + pytest (PC); Node 20 ESM + Express 4 + `mqtt` + `jose` + vitest + supertest (server); React 18 + Vite 5 + Tailwind 3 + @testing-library/react (web); Docker, docker compose, GitHub Actions `appleboy/ssh-action@v1`, Cloudflare Tunnel + Access.

**Spec:** `docs/superpowers/specs/2026-10-30-pc-dashboard-design.md`

## Global Constraints

- Never commit the owner's email. It lives only in the Cloudflare Access policy and GitHub secret `ALLOWED_EMAIL`. Before committing, check `git diff --cached | grep -iF "$OWNER_EMAIL"` is empty (`OWNER_EMAIL` set only in the local shell).
- Existing MQTT behaviour unchanged: `wol/desktop` payloads `wake`/`sleep`/`hibernate`/`shutdown` stay unsigned; ESP32 firmware untouched; retained messages on command topics are ignored.
- New topics, exact names: `wol/desktop/pc/stats` (retained), `wol/desktop/pc/folders` (retained), `wol/desktop/pc/sessions` (retained), `wol/desktop/pc/cmd` (not retained), `wol/desktop/pc/reply` (not retained).
- Permission modes enum, in this UI order: `bypassPermissions` (preselected), `acceptEdits`, `auto`, `default`, `dontAsk`, `plan`.
- Folder scope: direct subfolders of `%USERPROFILE%\workspace`, names only, skipping names starting with `.` and non-directories.
- Command signing: HMAC-SHA256, hex, over the canonical form (below); reject `|now - ts| > 60` s and any `id` seen in the last 120 s; constant-time compare.
- Spawning uses an argv list, never a shell string; the session's name is passed as `--name=<folder>` (single argv element).
- Container `pc-dash`, port `8080`, `expose` only, networks `default` + external `tunnel-gateway`, app dir on VM `/opt/pc-dash/app`.
- Stats interval 5 s. Dashboard marks stats stale when `ts` is older than 30 s or `wol/desktop/pc` is `offline`.
- Pentest scope: only `pc.givewgun.com`, the `pc-dash` container, the PC agent, and our own topics. No DoS/load testing, no testing of Cloudflare/EMQX infrastructure.

### Wire formats (shared by PC and server)

Canonical form for signing: the command object **without** `sig`, keys sorted, compact JSON (`,` and `:` separators, no spaces), non-ASCII left unescaped. Values are only strings and integers. Python: `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`. JS: build an object with keys in sorted order, then `JSON.stringify`.

```
cmd    start:   {"id": "<32 hex>", "ts": <unix s>, "action": "start", "folder": "<name>", "mode": "<mode>", "sig": "<hex>"}
       stop:    {"id", "ts", "action": "stop", "pid": <int>, "sig"}
       refresh: {"id", "ts", "action": "refresh", "sig"}
reply:          {"id": "<same id>", "ok": true|false, "error"?: "<text>", "pid"?: <int>}
stats:          {"ts", "host", "uptime_s", "cpu_pct", "ram": {"used", "total"},
                 "gpu": {"name", "util_pct", "vram_used_mb", "vram_total_mb", "temp_c"} | null,
                 "disks": [{"mount", "free", "total"}]}            (bytes for ram/disks)
folders:        ["blink", "horizon", ...]
sessions:       {"ts", "sessions": [{"pid", "folder", "name", "mode", "started"}]}   (mode/name null if not on cmdline; started = unix s)
```

Shared test vector: `dashboard/test/fixtures/cmd-vector.json` = `{"secret", "cmd", "canonical", "sig"}`, read by both the pytest and vitest suites.

## Review Focus

1. **Start pressed while PC is asleep/off** → API answers `409 {"error":"PC is offline"}` right away, nothing is queued. Test: Task 5 `rejects session start when pc offline`.
2. **Odd but real folder names** (`local-llm-server;C` exists today, names with spaces, a leading `-`, unicode) → launch works and nothing is interpreted. Test: Task 2 `spawn argv passes folder as single --name= element`.
3. **Agent restarted while sessions run** → sessions keep running and reappear in the list. Test: Task 2 `scan finds processes not started by us` + Task 9 manual check.
4. **Phone backgrounds the tab / Cloudflare drops the SSE stream** → on reconnect the browser gets the full current snapshot immediately. Test: Task 5 `new SSE client receives snapshot first`.
5. **PC resumes from sleep with stale retained stats on the broker** → UI shows them greyed as stale, not live. Test: Task 6 `marks stats stale when ts older than 30s`.

---

### Task 0: Spike the risky Claude Code behaviours

No product code. Results decide details in Tasks 2 and 6.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-30-pc-dashboard-design.md` (append "Spike results" under "Risks")

- [ ] **Step 1:** Create `C:\Users\gunka\workspace\zz-spike` (never opened in Claude). Run `claude remote-control --name=zz-spike --permission-mode bypassPermissions` there in a new console. Record: does it show a trust prompt / hang? Does the session appear in claude.ai/code?
- [ ] **Step 2:** In that session, ask Claude to create a file. Record whether it asked permission (tells whether `--permission-mode` applies to the pre-created session).
- [ ] **Step 3:** Start a second `remote-control` in the same folder. Record whether both work independently.
- [ ] **Step 4:** With `psutil` installed (`python -m pip install --user psutil`), print `name()`, `cmdline()`, `cwd()` for every process named `claude.exe`. Record the exact argv shape of the server and of any child processes.
- [ ] **Step 5:** If a trust prompt blocks, find which `~/.claude.json` `projects[<path>]` key pre-trusts a folder (`hasTrustDialogAccepted`) and confirm setting it fixes Step 1. Record the exact key/path format.
- [ ] **Step 6:** Stop both servers, delete `zz-spike` (and its `~/.claude.json` entry if added). Write results into the spec; commit `docs: record remote-control spike results`.

### Task 1: Command signing (PC side) + shared test vector

**Files:**
- Create: `pc/pcagent/__init__.py` (empty), `pc/pcagent/signing.py`, `pc/tests/test_signing.py`, `dashboard/test/fixtures/cmd-vector.json`

**Interfaces:**
- Produces: `canonical(cmd: dict) -> str`; `sign(cmd: dict, secret: str) -> str` (hex); `verify(cmd: dict, secret: str, now: int, seen: dict[str, int]) -> str | None` returns an error string (`"unsigned"`, `"bad signature"`, `"stale"`, `"replay"`, `"bad field"`) or `None` when valid, and records the id in `seen` (pruning entries older than 120 s).

- [ ] **Step 1: Write failing tests** in `pc/tests/test_signing.py`:
  - `test_vector_matches`: loads the fixture, asserts `canonical(v["cmd"]) == v["canonical"]` and `sign(v["cmd"], v["secret"]) == v["sig"]`.
  - `test_verify_ok`, `test_verify_unsigned`, `test_verify_bad_sig` (flip one hex char), `test_verify_stale` (`ts = now - 61` → `"stale"`; `now + 61` → `"stale"`; `now - 60` → `None`), `test_verify_replay` (same cmd twice → second `"replay"`), `test_verify_rejects_float_or_nested` (`"pid": 1.5` or `{"a": 1}` → `"bad field"`), `test_sig_excluded_from_canonical`.
- [ ] **Step 2:** Run `python -m pytest pc/tests/test_signing.py -v` → FAIL (module missing).
- [ ] **Step 3:** Implement `signing.py` (`hmac.new(secret.encode(), canonical.encode("utf-8"), hashlib.sha256).hexdigest()`, `hmac.compare_digest`). Generate the fixture once with `secret="test-secret"`, `cmd={"id":"0123456789abcdef0123456789abcdef","ts":1767000000,"action":"start","folder":"local-llm-server;C","mode":"bypassPermissions"}` and write `canonical`/`sig` into the JSON.
- [ ] **Step 4:** Run tests → PASS.
- [ ] **Step 5:** Commit `feat(pc): HMAC command signing with shared test vector`.

### Task 2: PC folders, session scan/spawn/stop, stats

**Files:**
- Create: `pc/pcagent/folders.py`, `pc/pcagent/sessions.py`, `pc/pcagent/stats.py`, `pc/tests/test_folders.py`, `pc/tests/test_sessions.py`, `pc/tests/test_stats.py`

**Interfaces:**
- Produces:
  - `list_folders(workspace: Path) -> list[str]`
  - `session_argv(claude: str, folder: str, mode: str) -> list[str]` → `[claude, "remote-control", f"--name={folder}", "--permission-mode", mode]`
  - `scan_sessions(workspace: Path, procs=None) -> list[dict]` (`procs` injectable iterable of objects with `.pid`, `.info` dict `name/cmdline/create_time`, `.cwd()`; default `psutil.process_iter([...])`); matches `name.lower() == "claude.exe"` and `cmdline[1] == "remote-control"`; `folder` = cwd relative to workspace if directly inside, else full cwd; parses `--name=`/`--name x` and `--permission-mode x`; sorted by `started`.
  - `start_session(workspace: Path, folder: str, mode: str, popen=subprocess.Popen) -> int` (pid); `cwd=workspace/folder`, `creationflags=CREATE_NEW_CONSOLE`, `STARTUPINFO` with `SW_SHOWMINNOACTIVE`; `claude` from `shutil.which("claude")` falling back to `~/.local/bin/claude.exe`.
  - `stop_session(pid: int) -> None` kills the psutil process tree (children first; `terminate`, `wait_procs(timeout=5)`, then `kill`).
  - `collect_stats(now: int, run=subprocess.run) -> dict` (stats wire format; `gpu` null if `nvidia-smi` fails; disks = `psutil.disk_partitions()` entries with `"fixed"` in `opts`; no CPU temp field).
- Apply Task 0 results: if a trust prompt blocked, `start_session` pre-trusts `workspace/folder` using the key format recorded in the spec, only for validated folders.

- [ ] **Step 1: Write failing tests:**
  - `test_list_folders_skips_dot_and_files` (tmp dir with `a`, `.git`, `b.txt`, `local-llm-server;C` → `["a", "local-llm-server;C"]`).
  - `test_spawn_argv_passes_folder_as_single_name_element` (folder `-x; rm` → argv element `"--name=-x; rm"`, no shell).
  - `test_start_session_uses_cwd_and_new_console` (fake popen records kwargs: `cwd`, `creationflags & CREATE_NEW_CONSOLE`, no `shell=True`).
  - `test_scan_finds_processes_not_started_by_us` (fake procs: one server with `--name=horizon --permission-mode acceptEdits` in `workspace/horizon`, one boot server with no flags in `workspace`, one `claude.exe` child with different argv, one `node.exe` → two sessions; boot one has `mode: None`, `folder` = full workspace path).
  - `test_scan_skips_vanished_process` (`.cwd()` raises `psutil.NoSuchProcess` → skipped).
  - `test_collect_stats_shape` and `test_collect_stats_gpu_null_when_nvidia_smi_missing` (fake `run` raising `FileNotFoundError`).
- [ ] **Step 2:** `python -m pytest pc/tests -v` → new tests FAIL.
- [ ] **Step 3:** Implement the three modules.
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5:** Commit `feat(pc): folder listing, session scan/spawn/stop, stats`.

### Task 3: PC command handler + agent wiring + setup

**Files:**
- Create: `pc/pcagent/commands.py`, `pc/tests/test_commands.py`
- Modify: `pc/power-agent.pyw`, `pc/setup.ps1`, `.gitignore`

**Interfaces:**
- Consumes: Task 1 `verify`; Task 2 `list_folders`, `scan_sessions`, `start_session`, `stop_session`.
- Produces: `class CommandHandler(secret: str, workspace: Path, *, start=start_session, stop=stop_session, scan=scan_sessions, clock=time.time, dry_run=False)` with `handle(payload: bytes) -> dict | None` returning a reply dict, or `None` when the payload is not even parseable JSON with a string `id` (logged, no reply). Reply errors: verify errors verbatim, `"unknown action"`, `"unknown folder"`, `"bad mode"`, `"not a claude session"`, `"payload too large"` (>4096 bytes).

- [ ] **Step 1: Write failing tests** in `test_commands.py` (fakes for start/stop/scan, fixed clock, secret `"s"`): `test_start_ok_returns_pid`, `test_start_unknown_folder` (`..`, `C:\\Windows`, `horizon\\..\\..`, missing name), `test_start_bad_mode`, `test_stop_only_scanned_pids` (pid 4 not in scan → `"not a claude session"`, stop not called), `test_unsigned_rejected_without_side_effects`, `test_replay_rejected`, `test_malformed_json_returns_none`, `test_oversized_payload`, `test_dry_run_does_not_spawn`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `commands.py`.
- [ ] **Step 4:** Modify `power-agent.pyw`: read secret from `pc/agent-secret.txt` (stripped; if missing, log and reject all `cmd` messages); subscribe `wol/desktop/pc/cmd` (QoS 1) in addition to `wol/desktop`; route by `msg.topic`, ignoring retained; publish replies to `wol/desktop/pc/reply`; on connect publish folders (retained); switch `loop_forever` to `loop_start()` + a main loop that every 5 s publishes stats (retained) and, when the scanned list changes (or on `refresh`), sessions (retained). Leave power handling and LWT unchanged. Keep `--dry-run`.
- [ ] **Step 5:** Modify `setup.ps1`: install `psutil` with `paho-mqtt`; if `pc\agent-secret.txt` is missing, write 32 random bytes as hex to it (`[Security.Cryptography.RandomNumberGenerator]`). Add `pc/agent-secret.txt` to `.gitignore`.
- [ ] **Step 6:** Tests PASS; then live smoke: stop the running hidden agent, run `python pc\power-agent.pyw --dry-run`, confirm `pc/power-agent.log` shows connect, and `mosquitto_sub`-free check via a short paho script that the retained `stats`/`folders`/`sessions` topics arrive. Restart the real agent.
- [ ] **Step 7:** Commit `feat(pc): signed session commands and stats publishing in agent`.

### Task 4: Dashboard server core (config, validate, sign, state)

**Files:**
- Create: `dashboard/package.json`, `dashboard/server/config.js`, `dashboard/server/validate.js`, `dashboard/server/sign.js`, `dashboard/server/state.js`, `dashboard/test/sign.test.js`, `dashboard/test/validate.test.js`, `dashboard/test/state.test.js`, `dashboard/vitest.config.js`, `dashboard/.gitignore`

**Interfaces:**
- Produces:
  - `loadConfig(env) -> {port, mqtt: {uri, user, pass}, access: {teamDomain, aud, allowedEmail}, cmdSecret}`; throws `Error("missing env: NAME")` for any of `MQTT_URI MQTT_USER MQTT_PASS CF_ACCESS_TEAM_DOMAIN CF_ACCESS_AUD ALLOWED_EMAIL PC_CMD_SECRET`; `PORT` default 8080; email lowercased.
  - `MODES` (array, Global Constraints order), `POWER = ["wake","sleep","hibernate","shutdown"]`, `validatePower(body) -> string` (action), `validateStart(body, folders) -> {folder, mode}`, `validatePid(raw, sessions) -> number`; each throws `ValidationError` (has `.status = 400`).
  - `canonical(cmd) -> string`, `signCommand(fields, secret, now = Date.now()) -> cmd` (adds `id` = 16 random bytes hex, `ts` = seconds, `sig`).
  - `createState() -> {apply(topic, payloadString), snapshot(), on("change", fn), off}` (an EventEmitter); snapshot = `{esp, pc, stats, folders, sessions}`, unparseable JSON payloads are ignored (keep previous value).
- package.json: `"type": "module"`, scripts `start` (`node server/index.js`), `test` (`vitest run`), `build` (`vite build`), `lint` (`eslint server web/src test`); deps `express mqtt jose`; devDeps `vitest supertest eslint` (+ web deps in Task 6).

- [ ] **Step 1: Write failing tests:** `sign.test.js` `matches python vector` (fixture → `canonical` and HMAC equal fixture), `signCommand adds id ts sig`; `validate.test.js` (`validateStart` rejects folder not in list, `..`, non-string, mode outside enum; accepts `local-llm-server;C`; `validatePid` rejects `"12abc"`, `-1`, pid not in sessions); `state.test.js` (applies each topic, ignores bad JSON, emits change).
- [ ] **Step 2:** `cd dashboard && npm install && npx vitest run` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(dashboard): server config, validation, signing, state`.

### Task 5: Dashboard server HTTP (Access auth, routes, SSE, MQTT)

**Files:**
- Create: `dashboard/server/access.js`, `dashboard/server/broker.js`, `dashboard/server/app.js`, `dashboard/server/index.js`, `dashboard/test/access.test.js`, `dashboard/test/app.test.js`

**Interfaces:**
- Consumes: Task 4 everything.
- Produces:
  - `createAccessVerifier({teamDomain, aud, allowedEmail, jwks?}) -> async (token) => email`; uses `jose.jwtVerify` with `issuer: https://<teamDomain>`, `audience: aud`, `algorithms: ["RS256"]`, JWKS default `createRemoteJWKSet(new URL("https://<teamDomain>/cdn-cgi/access/certs"))`; throws if `email` claim (lowercased) ≠ `allowedEmail`.
  - `connectBroker(config, state) -> {connected(), publishPower(action), sendCommand(fields) -> Promise<reply>}`; subscribes to `wol/desktop/status`, `wol/desktop/pc`, `wol/desktop/pc/{stats,folders,sessions,reply}`; `sendCommand` signs, publishes QoS 1 non-retained to `wol/desktop/pc/cmd`, resolves on matching reply id, rejects with `TimeoutError` after 10 s.
  - `createApp({state, broker, verify, staticDir}) -> express app`. Routes:
    - `GET /api/health` (no auth) → `{ok: true, mqtt: broker.connected()}`
    - every other `/api/*` requires header `Cf-Access-Jwt-Assertion` verified by `verify` → else `401 {"error":"unauthorized"}`
    - `GET /api/events` SSE: first event = `snapshot()`, then one per state change, `: ping` every 25 s
    - `POST /api/power {action}`, `POST /api/sessions {folder, mode}`, `POST /api/sessions/:pid/stop` — POSTs require `Content-Type: application/json` (else `415`); session routes return `409 {"error":"PC is offline"}` when `snapshot().pc !== "online"`; reply `ok:false` → `502 {"error": reply.error}`; timeout → `504 {"error":"PC did not answer"}`
    - static SPA from `staticDir` with fallback to `index.html`; headers on every response: `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`; `x-powered-by` disabled.
  - `index.js` wires `loadConfig(process.env)` → state → broker → verifier → app, listens on `config.port`.

- [ ] **Step 1: Write failing tests:** `access.test.js` (local key pair via `jose.generateKeyPair` + `createLocalJWKSet`): accepts valid; rejects wrong aud, wrong issuer, expired, wrong email, `alg: none`, HS256 token signed with the public key. `app.test.js` (supertest, fake broker + fake verify): `health needs no auth and leaks no config`, `api requires access jwt`, `email header alone is not auth` (`Cf-Access-Authenticated-User-Email` without JWT → 401), `rejects non-json post with 415`, `rejects session start when pc offline`, `start passes validated fields to broker`, `bad folder 400 and broker not called`, `stop unknown pid 400`, `reply error maps to 502`, `timeout maps to 504`, `new SSE client receives snapshot first`, `security headers present`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS. Local smoke: run `node server/index.js` with real MQTT env + dummy Access values; `curl localhost:8080/api/health` → `{"ok":true,"mqtt":true}`.
- [ ] **Step 5:** Commit `feat(dashboard): access-guarded API, SSE stream, MQTT bridge`.

### Task 6: Dashboard web UI

**Files:**
- Create: `dashboard/index.html`, `dashboard/vite.config.js`, `dashboard/tailwind.config.js`, `dashboard/postcss.config.js`, `dashboard/web/src/main.jsx`, `dashboard/web/src/index.css`, `dashboard/web/src/api.js`, `dashboard/web/src/App.jsx`, `dashboard/web/src/components/{PowerCard,StatsCard,SessionsCard,NewSession,ConfirmButton}.jsx`, `dashboard/test/web.test.jsx`
- Modify: `dashboard/package.json` (react, react-dom, vite, @vitejs/plugin-react, tailwind, postcss, autoprefixer, @testing-library/react, jsdom), `dashboard/vitest.config.js` (jsdom for `*.test.jsx`)

**Interfaces:**
- Consumes: Task 5 routes and snapshot shape.
- Produces: `useSnapshot()` hook (EventSource on `/api/events`, auto-reconnect is native), `post(path, body) -> Promise<{ok, error?}>`, `isStale(stats, pcStatus, nowMs) -> boolean` (true when `pcStatus !== "online"` or `nowMs/1000 - stats.ts > 30`). Vite builds to `dashboard/dist`, which the server serves.

Layout, mobile-first single column: **Power** (ESP32 + PC dots, Wake/Sleep/Hibernate buttons, Shutdown via `ConfirmButton`), **Stats** (CPU %, RAM, GPU util/VRAM/temp, disks free, uptime; greyed with "last seen <time>" when stale), **Sessions** (rows: folder, mode badge, started; Stop via `ConfirmButton`; link "Open claude.ai/code" → `https://claude.ai/code`), **New session** (folder `<select>`, mode segmented control with `bypassPermissions` preselected, Start disabled when PC offline). `ConfirmButton` = first tap turns it into "Tap again to confirm" for 3 s (no `window.confirm`). Errors shown inline from `post` result.

- [ ] **Step 1: Write failing tests** in `web.test.jsx`: `new session preselects bypassPermissions`, `start disabled when pc offline`, `stop needs two taps`, `marks stats stale when ts older than 30s`, `renders folder names as text` (folder `<img src=x onerror=alert(1)>` appears as text, no `img` element).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests PASS; `npm run build` succeeds; `grep -rE "MQTT_|PC_CMD" dist` and `grep -rF "$OWNER_EMAIL" dist` → no matches.
- [ ] **Step 5:** Commit `feat(dashboard): mobile-first web UI`.

### Task 7: Container, compose, CI/CD workflow

**Files:**
- Create: `dashboard/Dockerfile`, `dashboard/.dockerignore`, `dashboard/docker-compose.prod.yml`, `.github/workflows/dashboard.yml`

**Interfaces:**
- Consumes: package scripts from Tasks 4–6.
- Produces: image `pc-dash:latest`; workflow secrets list = `ORACLE_VM_HOST ORACLE_VM_SSH_KEY MQTT_URI MQTT_USER MQTT_PASS CF_ACCESS_TEAM_DOMAIN CF_ACCESS_AUD ALLOWED_EMAIL PC_CMD_SECRET`.

- Dockerfile: stage 1 `node:20-alpine` `npm ci` + `npm run build`; stage 2 `node:20-alpine`, `npm ci --omit=dev`, copy `server/` + `dist/`, `USER node`, `EXPOSE 8080`, `CMD ["node","server/index.js"]`.
- Compose: service `app`, `container_name: pc-dash`, `build: .`, `env_file: .env`, `expose: ["8080"]`, networks `default` + `tunnel-gateway` (external), `restart: unless-stopped`, healthcheck `node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`, `mem_limit: 256m`.
- Workflow: `on: push` to `main` with `paths: [dashboard/**, .github/workflows/dashboard.yml]`, `pull_request` same paths, `workflow_dispatch`. Jobs `test` (node 20, `npm ci`, lint, `npm test`, `npm run build`, working-directory `dashboard`) → `docker` (build only, main/dispatch) → `deploy` (main/dispatch; `concurrency: {group: deploy-pc-dash, cancel-in-progress: false}`; ssh-action script mirroring horizon: clone/pull into `/opt/pc-dash/app` using `GITHUB_TOKEN`, `sudo git reset --hard origin/main`, write `dashboard/.env` (chmod 600) from secrets with `PORT=8080`, `sudo docker compose -f dashboard/docker-compose.prod.yml --env-file dashboard/.env up -d --build`, `sudo docker system prune -f`).

- [ ] **Step 1:** Write the files.
- [ ] **Step 2:** `docker build -t pc-dash:test dashboard` succeeds locally (if Docker is available on the PC; otherwise rely on CI), image < 200 MB.
- [ ] **Step 3:** Commit `ci(dashboard): container and deploy workflow`.

### Task 8: Infrastructure: secrets, Cloudflare, first deploy

No new source files; operations against GitHub, Cloudflare, the VM.

- [ ] **Step 1:** Run `pc\setup.ps1` steps for psutil + secret file (or the equivalent lines) so `pc/agent-secret.txt` exists; restart the agent.
- [ ] **Step 2:** Set GitHub secrets on `givewgun/esp32-wol` with `gh secret set`, piping values (never echo them): `ORACLE_VM_HOST`=`161.118.201.235`; `ORACLE_VM_SSH_KEY` < key file; `MQTT_URI/USER/PASS` extracted from `firmware/main/secrets.h` by a one-off script piping into `gh secret set`; `PC_CMD_SECRET` < `pc/agent-secret.txt`; `ALLOWED_EMAIL` = owner's email.
- [ ] **Step 3:** Cloudflare (MCP/API): find the account, the tunnel whose connector is `global-tunnel` on the VM, and the `givewgun.com` zone. Append ingress rule `pc.givewgun.com → http://pc-dash:8080` **before** the catch-all, keeping every existing rule; create proxied CNAME `pc` → `<tunnel-id>.cfargotunnel.com`. Ensure the One-time PIN login method exists; create Access self-hosted application for `pc.givewgun.com` with an Allow policy `include: email = <owner>`. Read back the application AUD and team domain → set `CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN` secrets.
- [ ] **Step 4:** Push the branch, open a PR (tests job must pass), merge to `main` (or `workflow_dispatch` on the branch for the first deploy if the owner prefers). Watch the run with `gh run watch`.
- [ ] **Step 5:** Verify: `ssh ... 'sudo docker ps --filter name=pc-dash'` healthy; `curl -sI https://pc.givewgun.com` → `302` to the Access login; existing hostnames (horizon, legion) still respond as before.

### Task 9: End-to-end on the real system

- [ ] **Step 1:** In a browser, log in at `pc.givewgun.com` with the emailed PIN. Stats are live and update every ~5 s.
- [ ] **Step 2:** Start a session in `horizon` with `bypassPermissions` and one in `blink` with `plan`. Both appear in the list with the right mode and in claude.ai/code; the `plan` one refuses to edit.
- [ ] **Step 3:** The boot-time `workspace` session is listed. Stop the `blink` session → its console closes, it leaves the list.
- [ ] **Step 4:** Kill and restart the agent (Startup shortcut) → `horizon` keeps running and reappears in the list.
- [ ] **Step 5:** Sleep from the dashboard → PC dot goes offline, stats grey out; Wake → PC comes back, stats resume. Phone IoT MQTT Panel Wake/Sleep still work.
- [ ] **Step 6:** Note results in the PR description; fix anything broken via a new failing test first.

### Task 10: Pentest, report, README

**Files:**
- Create: `docs/superpowers/specs/2026-10-30-pc-dashboard-pentest.md`
- Modify: `README.md` (Dashboard section: URL, what it does, new topics added to the MQTT table, agent deps + `agent-secret.txt`, deploy + secrets list without values)

- [ ] **Step 1:** Run each attack from the spec's pentest list against production and record command, expected, actual:
  - no cookie / forged `Cf-Access-Jwt-Assertion` / email header only / JWT with wrong aud, `alg:none`, expired — from the internet and from `docker run --rm --network tunnel-gateway curlimages/curl http://pc-dash:8080/api/...` on the VM;
  - with the shared broker login (small paho script): unsigned, bad sig, replayed, stale, retained, malformed, 64 KB payloads on `wol/desktop/pc/cmd` → no spawn, agent still alive;
  - via the authenticated API: folder `..`, `C:\\Windows`, `horizon\\..\\..`, `"; calc"`, `-h`, unicode look-alike of a real folder, mode `rm`, stop pid of `explorer.exe`;
  - CSRF: form-encoded POST and cross-origin `fetch` without JSON content type → rejected; XSS: create folder `<img src=x onerror=alert(1)>` temporarily in workspace → rendered as text, then delete it;
  - `curl https://pc.givewgun.com/api/health` and the JS bundle contain no secrets; response headers present.
- [ ] **Step 2:** Fix every finding test-first (add the failing test to the owning module), redeploy, re-run that attack.
- [ ] **Step 3:** Write the report and README section; `git grep -iF "$OWNER_EMAIL"` → none.
- [ ] **Step 4:** Commit `docs: dashboard pentest report and README`.
