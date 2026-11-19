Stop-Process -Name "GMeer" -Force -ErrorAction SilentlyContinue
# Release-build van de Tauri-app (bouwen met: npx tauri build --no-bundle)
Start-Process -FilePath "$PSScriptRoot\src-tauri\target\release\GMeer.exe"
Write-Host "GMeer.exe (System Tray) is gestart!" -ForegroundColor Green
