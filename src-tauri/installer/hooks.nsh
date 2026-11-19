; Extra steps for the GMeer installer (NSIS), called by the Tauri installer.

; After installing: start GMeer automatically with Windows (current user only).
; It can be turned off later in GMeer under Options.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "GMeer" '"$INSTDIR\GMeer.exe"'
!macroend

; On uninstall: remove the startup entry again.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "GMeer"
!macroend
