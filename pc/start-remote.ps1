# Runs at Windows logon (Startup shortcut from setup.ps1): primes the PC for remote AI work.
$Workspace = "$env:USERPROFILE\workspace"  # where Claude Code remote sessions start

# Wait for internet so remote-control registers cleanly after boot
while (-not (Test-NetConnection api.anthropic.com -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue)) {
    Start-Sleep -Seconds 5
}

# Claude Code: shows up in claude.ai/code and the Claude app. Closing this window ends it.
Start-Process claude -ArgumentList 'remote-control' -WorkingDirectory $Workspace -WindowStyle Minimized

# Codex: the desktop app hosts the remote connection for the ChatGPT mobile app
Start-Process 'shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App'

# Auto-login leaves the desktop open; lock it. Sessions keep running, RustDesk can unlock.
rundll32.exe user32.dll,LockWorkStation
