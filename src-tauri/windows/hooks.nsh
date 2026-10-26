; Fetchlane installer hooks. Fetchlane registers these per-user keys itself at
; startup (see src-tauri/src/integration.rs and notify.rs); uninstalling
; removes them again.

!macro NSIS_HOOK_POSTUNINSTALL
  ; Native messaging host for the browser extension.
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\dev.fetchlane.host"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\dev.fetchlane.host"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\dev.fetchlane.host"
  DeleteRegKey HKCU "Software\Chromium\NativeMessagingHosts\dev.fetchlane.host"
  ; Notification identity (name and icon).
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\${BUNDLEID}"
  ; "Open with" entry for .torrent files.
  DeleteRegValue HKCU "Software\Classes\.torrent\OpenWithProgids" "Fetchlane.Torrent"
  DeleteRegKey HKCU "Software\Classes\Fetchlane.Torrent"
  ; The magnet link handler, only if it is still Fetchlane's.
  ReadRegStr $0 HKCU "Software\Classes\magnet\shell\open\command" ""
  StrCmp $0 '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"' 0 +2
    DeleteRegKey HKCU "Software\Classes\magnet"
!macroend
