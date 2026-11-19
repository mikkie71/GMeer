Stop-Process -Name "GMeer" -Force -ErrorAction SilentlyContinue
# Release build of the Tauri app (build with: npx tauri build --no-bundle)
Start-Process -FilePath "$PSScriptRoot\src-tauri\target\release\GMeer.exe"
Write-Host "GMeer.exe (system tray) has been started!" -ForegroundColor Green
