# Screenshot a window by title: tools/shot.ps1 <out.png> [-Title "Mochi Garden"]
param([string]$Out = "shot.png", [string]$Title = "Mochi Garden", [int]$ProcId = 0)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
[Win]::SetProcessDPIAware() | Out-Null
# -ProcId: only that process's window with this title (when several copies are open)
$h0 = [IntPtr]::Zero
do {
  $h0 = [Win]::FindWindowEx([IntPtr]::Zero, $h0, [NullString]::Value, $Title)
  $wp = 0; [Win]::GetWindowThreadProcessId($h0, [ref]$wp) | Out-Null
} while ($h0 -ne [IntPtr]::Zero -and $ProcId -ne 0 -and $wp -ne $ProcId)
if ($h0 -eq [IntPtr]::Zero) { throw "no window titled $Title" }
$r = New-Object Win+RECT
[Win]::GetWindowRect($h0, [ref]$r) | Out-Null
$w = $r.R - $r.L; $h = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc()
[Win]::PrintWindow($h0, $dc, 2) | Out-Null
$g.ReleaseHdc($dc)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
"$w x $h -> $Out"
