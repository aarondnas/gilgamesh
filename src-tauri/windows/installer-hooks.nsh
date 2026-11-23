; Gilgamesh: hooks for the NSIS installer of Tauri (tauri.windows.conf.json: bundle > windows > nsis >
; installerHooks). ASCII only, so it needs no BOM.
;
; .tex files get Gilgamesh under "Open with", without taking the default from the program the user
; opens them with now (TeXstudio, MiKTeX's TeXworks, VS Code ...): Tauri's own fileAssociations would
; make Gilgamesh the default. Whoever wants it chooses it there as the default. The app then opens the
; file's project (src-tauri/src/window/mod.rs, start_from_args and second_start). SHCTX is the
; current user's registry, as the installer installs per user. Uninstalling removes the entries,
; but not when the uninstaller runs as part of an update (/UPDATE).

!define GILGAMESH_PROGID "Gilgamesh.tex"

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\${GILGAMESH_PROGID}" "" "LaTeX document"
  WriteRegStr SHCTX "Software\Classes\${GILGAMESH_PROGID}\DefaultIcon" "" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr SHCTX "Software\Classes\${GILGAMESH_PROGID}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\.tex\OpenWithProgids" "${GILGAMESH_PROGID}" ""
  ; Explorer reads the associations anew
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue SHCTX "Software\Classes\.tex\OpenWithProgids" "${GILGAMESH_PROGID}"
    DeleteRegKey SHCTX "Software\Classes\${GILGAMESH_PROGID}"
    System::Call "shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)"
  ${EndIf}
!macroend
