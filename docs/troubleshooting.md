# Troubleshooting

## PC doesn't wake

Work from the ESP32 outward.

1. **Is the ESP32 online?** The ESP32 LED / `wol/desktop/status` should be `online`. If not, check its power and Wi-Fi
   (2.4 GHz only), and the broker details in `secrets.h`. `idf.py monitor` shows what's failing.
2. **Did it get the command?** In `idf.py monitor`, tapping Wake should print `Magic packet sent`.
   - `Ignoring retained message`: your app publishes with retain on. Turn it off for every button.
   - Nothing at all: the app is on a different topic or broker.
3. **Is the MAC right?** It must be the PC's **wired** adapter MAC, in `PC_MAC`.
4. **Same network?** The ESP32 and PC must be on the same subnet/VLAN; broadcasts don't cross routers or guest networks.
5. **Is the PC set up for WoL?** Check each item in [setup.md](setup.md#prepare-the-pc-for-wake-on-lan): BIOS WoL on,
   ErP off, adapter *Wake on Magic Packet* on, Fast Startup off. Some boards only wake from sleep/hibernate, not from
   full shutdown, or need the PC to have been shut down cleanly from Windows at least once after changing settings.
6. **Test from another machine** on the LAN with any WoL tool. If that fails too, it's the PC, not the ESP32.

## PC LED stays off

- The agent only runs once you're logged in. After a cold boot, auto-login must work. Check that the PC reaches the
  (locked) desktop on its own.
- Look at `pc\power-agent.log`. Common entries:
  - `MQTT connected: Not authorized`: wrong login in `secrets.h`.
  - A Python traceback about `paho` / `psutil`: re-run `setup.ps1`.
  - Nothing new: the agent isn't running. Double-click *Power Agent* in `shell:startup`.
- Run it in the foreground to see errors: `python pc\power-agent.pyw --dry-run` (end `pythonw.exe` first).

## PC LED says offline but the PC is on

After a crash or network drop, the broker sends the Last Will `offline` ~45 s later. The agent's 5 s heartbeat puts it
back to `online` once it reconnects. If it stays `offline`, the agent isn't running (see above).

## Sleep/shutdown buttons do nothing

- Commands sent while the PC agent is offline are dropped by design. Check the PC LED first.
- `--dry-run` logs the command without acting. Make sure you're not running a dry-run copy.

## Auto-login doesn't happen

- Microsoft account: username = account email, **domain empty**, password = account password, not PIN.
- Turn off *Settings > Accounts > Sign-in options > "only allow Windows Hello sign-in"*, then run `Autologon` again.

## Dashboard

| Symptom | Cause |
|---|---|
| Container exits with `missing env: X` | Set every variable in [dashboard.md](dashboard.md#configuration) |
| API returns 401 `unauthorized` | Access JWT invalid: check `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, and that `ALLOWED_EMAIL` is the email you log in with |
| `dashboard is not connected to the broker` (503) | Broker login/URI on the VM is wrong, or the VM can't reach the broker |
| `PC is offline` (409) | Wake it first |
| `PC did not answer` (504) | Agent is running without `pc\agent-secret.txt` (check its log), or isn't running |
| `bad signature` | `PC_CMD_SECRET` doesn't match `pc\agent-secret.txt` exactly |
| `stale: PC clock ..., command ts ...` | Clocks differ by over 60 s. Sync Windows time (*Settings > Time > Sync now*) and the server's (NTP) |
| `folder not trusted` | Tap *Trust folder* first |
| `already running` | One Remote Control server per folder; stop it or open another chat from claude.ai/code |
| `claude exited with code N` | Claude Code isn't logged in on the PC, or the CLI failed. Run `claude remote-control` in that folder by hand to see why |
| Folder missing from the list | Only direct, visible subfolders of the workspace are listed; no symlinks, junctions or dot-folders |
