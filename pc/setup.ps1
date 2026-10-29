# One-time PC setup for remote wake + work. Safe to re-run.

# Run start-remote.ps1 at every logon
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Remote Work.lnk")
$lnk.TargetPath = 'powershell.exe'
$lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\start-remote.ps1`""
$lnk.WindowStyle = 7  # minimized
$lnk.Save()

# PC agent: MQTT power commands + dashboard (stats, Claude sessions), runs at every logon (no window)
python -m pip install --user --quiet paho-mqtt psutil

# Key for signed dashboard commands; the same value goes into the GitHub secret PC_CMD_SECRET
$secretFile = "$PSScriptRootgent-secret.txt"
if (-not (Test-Path $secretFile)) {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    -join ($bytes | ForEach-Object { $_.ToString('x2') }) | Set-Content -NoNewline -Encoding ascii $secretFile
}
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Power Agent.lnk")
$lnk.TargetPath = (Get-Command pythonw).Source
$lnk.Arguments = "`"$PSScriptRoot\power-agent.pyw`""
$lnk.WorkingDirectory = $PSScriptRoot
$lnk.Save()

# RustDesk as a Windows service: starts at boot, works on the lock screen (UAC prompt)
Start-Process 'C:\Program Files\RustDesk\RustDesk.exe' -ArgumentList '--install-service' -Verb RunAs -Wait

Write-Host 'Done. Remaining manual step: auto-login via Sysinternals Autologon (see README).'
