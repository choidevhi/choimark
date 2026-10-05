; ChoiMark installer hooks.
;
; Tauri's template already writes Software\Classes\.<ext> -> ChoiMark.Markdown.
; These hooks finish the job:
;   - quote the exe path in the open command (the template leaves it bare)
;   - use the dedicated .md document icon
;   - register Capabilities so ChoiMark shows up in Settings > Default apps
;   - run `choimark.exe --register-associations` (src-tauri/src/assoc.rs), which
;     clears "always open with" choices that name another app and writes a
;     signed UserChoice. Windows 10 accepts that, so .md opens in ChoiMark with
;     no prompt. Windows 11 Home/Pro only trust choices made in Windows' own UI
;     and ask once on the first double-click, with ChoiMark offered.

!define CHOIMARK_PROGID "ChoiMark.Markdown"
!define CHOIMARK_FILEEXTS "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts"

!macro CHOIMARK_LINK_EXT EXT
  WriteRegStr SHCTX "Software\Classes\.${EXT}" "" "${CHOIMARK_PROGID}"
  WriteRegStr SHCTX "Software\Classes\.${EXT}" "Content Type" "text/markdown"
  WriteRegStr SHCTX "Software\Classes\.${EXT}" "PerceivedType" "text"
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${CHOIMARK_PROGID}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities\FileAssociations" ".${EXT}" "${CHOIMARK_PROGID}"
!macroend

!macro CHOIMARK_UNLINK_EXT EXT
  ; Drop choices that point at ChoiMark so Windows asks again instead of
  ; pointing at a program that no longer exists.
  ReadRegStr $R2 HKCU "${CHOIMARK_FILEEXTS}\.${EXT}\UserChoice" "ProgId"
  ${If} $R2 == "${CHOIMARK_PROGID}"
    DeleteRegKey HKCU "${CHOIMARK_FILEEXTS}\.${EXT}\UserChoice"
  ${EndIf}
  ReadRegStr $R2 HKCU "${CHOIMARK_FILEEXTS}\.${EXT}\UserChoiceLatest\ProgId" "ProgId"
  ${If} $R2 == "${CHOIMARK_PROGID}"
    DeleteRegKey HKCU "${CHOIMARK_FILEEXTS}\.${EXT}\UserChoiceLatest"
  ${EndIf}

  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${CHOIMARK_PROGID}"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegValue SHCTX "Software\Classes\.${EXT}" "${CHOIMARK_PROGID}_backup"
  ReadRegStr $R1 SHCTX "Software\Classes\.${EXT}" ""
  ${If} $R1 == "${CHOIMARK_PROGID}"
  ${OrIf} $R1 == ""
    DeleteRegValue SHCTX "Software\Classes\.${EXT}" ""
    DeleteRegValue SHCTX "Software\Classes\.${EXT}" "Content Type"
    DeleteRegValue SHCTX "Software\Classes\.${EXT}" "PerceivedType"
  ${EndIf}
  DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\${CHOIMARK_PROGID}" "" "Markdown 문서"
  WriteRegStr SHCTX "Software\Classes\${CHOIMARK_PROGID}" "FriendlyTypeName" "Markdown 문서"
  WriteRegStr SHCTX "Software\Classes\${CHOIMARK_PROGID}\DefaultIcon" "" "$\"$INSTDIR\markdown-file.ico$\",0"
  WriteRegStr SHCTX "Software\Classes\${CHOIMARK_PROGID}\shell" "" "open"
  WriteRegStr SHCTX "Software\Classes\${CHOIMARK_PROGID}\shell\open" "" "ChoiMark로 열기"
  WriteRegStr SHCTX "Software\Classes\${CHOIMARK_PROGID}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""

  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""

  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities" "ApplicationDescription" "마크다운 편집기 · 미리보기"
  WriteRegStr SHCTX "Software\${PRODUCTNAME}\Capabilities" "ApplicationIcon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}" "Software\${PRODUCTNAME}\Capabilities"

  ; Explorer > New > Markdown 문서
  WriteRegStr SHCTX "Software\Classes\.md\ShellNew" "NullFile" ""

  !insertmacro CHOIMARK_LINK_EXT "md"
  !insertmacro CHOIMARK_LINK_EXT "markdown"
  !insertmacro CHOIMARK_LINK_EXT "mdown"
  !insertmacro CHOIMARK_LINK_EXT "mkd"
  !insertmacro CHOIMARK_LINK_EXT "mkdn"
  !insertmacro CHOIMARK_LINK_EXT "mdwn"
  !insertmacro CHOIMARK_LINK_EXT "mdtxt"
  !insertmacro CHOIMARK_LINK_EXT "mdtext"

  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --register-associations'
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegKey SHCTX "Software\Classes\.md\ShellNew"
    !insertmacro CHOIMARK_UNLINK_EXT "md"
    !insertmacro CHOIMARK_UNLINK_EXT "markdown"
    !insertmacro CHOIMARK_UNLINK_EXT "mdown"
    !insertmacro CHOIMARK_UNLINK_EXT "mkd"
    !insertmacro CHOIMARK_UNLINK_EXT "mkdn"
    !insertmacro CHOIMARK_UNLINK_EXT "mdwn"
    !insertmacro CHOIMARK_UNLINK_EXT "mdtxt"
    !insertmacro CHOIMARK_UNLINK_EXT "mdtext"
    DeleteRegKey SHCTX "Software\Classes\${CHOIMARK_PROGID}"
    DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
    DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"
    DeleteRegKey SHCTX "Software\${PRODUCTNAME}\Capabilities"
    System::Call "shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)"
  ${EndIf}
!macroend
