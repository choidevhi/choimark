# Shows Windows' own "How do you want to open .ext files?" dialog
# (SHOpenWithDialog). Blocks until the dialog closes.
#   powershell -File openwith-dialog.ps1 -Ext .md
param([Parameter(Mandatory = $true)][string]$Ext)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class OpenWith {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct OPENASINFO { public string pcszFile; public string pcszClass; public int oaifInFlags; }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern int SHOpenWithDialog(IntPtr hwnd, ref OPENASINFO info);
}
"@

# OAIF_ALLOW_REGISTRATION | OAIF_REGISTER_EXT
$info = New-Object OpenWith+OPENASINFO
$info.pcszFile = "Markdown$Ext"
$info.pcszClass = $null
$info.oaifInFlags = 0x1 -bor 0x2
[OpenWith]::SHOpenWithDialog([IntPtr]::Zero, [ref]$info)
