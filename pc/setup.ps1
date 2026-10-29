# One-time PC setup for remote wake + work. Safe to re-run.

# Run start-remote.ps1 at every logon
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Remote Work.lnk")
$lnk.TargetPath = 'powershell.exe'
$lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\start-remote.ps1`""
$lnk.WindowStyle = 7  # minimized
$lnk.Save()

# RustDesk as a Windows service: starts at boot, works on the lock screen (UAC prompt)
Start-Process 'C:\Program Files\RustDesk\RustDesk.exe' -ArgumentList '--install-service' -Verb RunAs -Wait

Write-Host 'Done. Remaining manual step: auto-login via Sysinternals Autologon (see README).'
