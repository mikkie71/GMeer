; Extra stappen voor de GMeer-installer (NSIS), aangeroepen door de Tauri-installer.

; Na installatie: GMeer automatisch laten starten met Windows (alleen voor deze gebruiker).
; Uitzetten kan later in GMeer onder Opties.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "GMeer" '"$INSTDIR\GMeer.exe"'
!macroend

; Bij verwijderen: de opstart-regel weer opruimen.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "GMeer"
!macroend
