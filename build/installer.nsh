!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "StrFunc.nsh"

!ifndef BUILD_UNINSTALLER
${StrStr}
Var GMCompact
Var GMManifest
Var GMLog
Var GMRoot
Var GMRelative
Var GMFile
Var GMParent
Var GMCount

# Runs in the installer's existing user/elevation context. Compression is best effort.
Function GMCompressApplication
  Push $0
  Push $1
  Push $2
  Push $3
  StrCpy $GMCount 0
  StrCpy $GMLog ""
  GetFullPathName $GMRoot "$INSTDIR"
  # Check these before opening the diagnostic log or manifest through a redirected directory.
  System::Call 'kernel32::GetFileAttributesW(w "$GMRoot") i .r0'
  IntOp $1 $0 & 0x400
  ${If} $0 == -1
  ${OrIf} $1 != 0
    StrCpy $0 "Compression skipped: installation directory is unavailable or redirected."
    Goto gm_done
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "$GMRoot\resources") i .r0'
  IntOp $1 $0 & 0x400
  ${If} $0 == -1
  ${OrIf} $1 != 0
    StrCpy $0 "Compression skipped: resources directory is unavailable or redirected."
    Goto gm_done
  ${EndIf}
  ClearErrors
  FileOpen $GMLog "$INSTDIR\resources\compression.log" w
  IfErrors 0 +2
    StrCpy $GMLog ""

  System::Call 'kernel32::GetVolumePathNameW(w "$GMRoot", w .r0, i ${NSIS_MAX_STRLEN}) i .r1'
  ${If} $1 == 0
    StrCpy $0 "Compression skipped: cannot identify installation volume."
    Goto gm_done
  ${EndIf}
  System::Call 'kernel32::GetDriveTypeW(w r0) i .r1'
  ${If} $1 != 3
    StrCpy $0 "Compression skipped: installation is not on a local fixed volume."
    Goto gm_done
  ${EndIf}
  System::Call 'kernel32::GetVolumeInformationW(w r0, p 0, i 0, p 0, p 0, p 0, w .r2, i ${NSIS_MAX_STRLEN}) i .r1'
  ${If} $1 == 0
  ${OrIf} $2 != "NTFS"
    StrCpy $0 "Compression skipped: NTFS is required."
    Goto gm_done
  ${EndIf}
  StrCpy $GMCompact "$WINDIR\Sysnative\compact.exe"
  ${IfNot} ${FileExists} "$GMCompact"
    StrCpy $GMCompact "$SYSDIR\compact.exe"
  ${EndIf}
  ${IfNot} ${FileExists} "$GMCompact"
    StrCpy $0 "Compression skipped: Windows compact.exe is unavailable."
    Goto gm_done
  ${EndIf}
  ClearErrors
  FileOpen $GMManifest "$INSTDIR\resources\compression-files.txt" r
  ${If} ${Errors}
    StrCpy $0 "Compression skipped: packaged-file manifest is unavailable."
    Goto gm_done
  ${EndIf}

gm_next:
  ClearErrors
  FileReadUTF16LE $GMManifest $GMRelative
  IfErrors gm_close
gm_trim:
  StrCpy $0 $GMRelative 1 -1
  ${If} $0 == "$\r"
  ${OrIf} $0 == "$\n"
    StrCpy $GMRelative $GMRelative -1
    Goto gm_trim
  ${EndIf}
  ${If} $GMRelative == ""
    Goto gm_next
  ${EndIf}
  # Reject rooted paths, streams, wildcards, traversal, and command-line quoting.
  StrCpy $0 $GMRelative 1
  ${If} $0 == "\"
  ${OrIf} $0 == "/"
    Goto gm_invalid
  ${EndIf}
  ${StrStr} $0 $GMRelative ":"
  ${StrStr} $1 $GMRelative '*'
  ${StrStr} $2 $GMRelative '?'
  ${StrStr} $3 $GMRelative '$\"'
  ${If} $0 != ""
  ${OrIf} $1 != ""
  ${OrIf} $2 != ""
  ${OrIf} $3 != ""
    Goto gm_invalid
  ${EndIf}
  ${StrStr} $0 "\$GMRelative\" "\..\"
  ${StrStr} $1 $GMRelative "/"
  ${If} $0 != ""
  ${OrIf} $1 != ""
    Goto gm_invalid
  ${EndIf}
  StrLen $0 $GMRoot
  StrLen $1 $GMRelative
  IntOp $0 $0 + $1
  IntOp $0 $0 + 1
  IntOp $1 ${NSIS_MAX_STRLEN} - 1
  ${If} $0 >= $1
    Goto gm_invalid
  ${EndIf}
  GetFullPathName $GMFile "$GMRoot\$GMRelative"
  StrCpy $0 "$GMRoot\"
  StrLen $1 $0
  StrCpy $2 $GMFile $1
  ${If} $2 != $0
    Goto gm_invalid
  ${EndIf}
  StrLen $0 $GMCompact
  StrLen $1 $GMFile
  IntOp $0 $0 + $1
  IntOp $0 $0 + 64
  IntOp $1 ${NSIS_MAX_STRLEN} - 1
  ${If} $0 >= $1
    Goto gm_invalid
  ${EndIf}
  # Do not follow files or parent directories redirected through junctions/symlinks.
  StrCpy $GMParent $GMFile
gm_parent:
  System::Call 'kernel32::GetFileAttributesW(w "$GMParent") i .r0'
  ${If} $0 == -1
    StrCpy $0 "Compression skipped (missing file): $GMRelative"
    Goto gm_message
  ${EndIf}
  IntOp $1 $0 & 0x400
  ${If} $1 != 0
    Goto gm_invalid
  ${EndIf}
  ${If} $GMParent != $GMRoot
    ${GetParent} "$GMParent" $GMParent
    Goto gm_parent
  ${EndIf}
  nsExec::ExecToStack '$\"$GMCompact$\" /C /EXE:LZX /I /Q $\"$GMFile$\"'
  Pop $0
  Pop $1
  ${If} $GMLog != ""
    # /I can report an individual file error while returning success; retain its output too.
    FileWriteUTF16LE $GMLog "$GMRelative (compact exit $0): $1$\r$\n"
  ${EndIf}
  ${If} $0 == 0
    IntOp $GMCount $GMCount + 1
    Goto gm_next
  ${EndIf}
  StrCpy $0 "Compression failed ($0): $GMRelative $1"
  Goto gm_message
gm_invalid:
  StrCpy $0 "Compression skipped (unsafe path): $GMRelative"
gm_message:
  DetailPrint "$0"
  ${If} $GMLog != ""
    FileWriteUTF16LE $GMLog "$0$\r$\n"
  ${EndIf}
  Goto gm_next
gm_close:
  FileClose $GMManifest
  StrCpy $0 "LZX compression completed: $GMCount packaged files processed."
gm_done:
  DetailPrint "$0"
  ${If} $GMLog != ""
    FileWriteUTF16LE $GMLog "$0$\r$\n"
    FileClose $GMLog
  ${EndIf}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
!endif

!macro customInstall
  Call GMCompressApplication
!macroend
