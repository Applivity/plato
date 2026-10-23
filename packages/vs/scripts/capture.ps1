param(
    [int]$ProcessId,
    [string]$Output
)

$ErrorActionPreference = "Stop"

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class PlatoCapture
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    public static bool Shot(IntPtr handle, string path, out string error)
    {
        error = null;
        RECT rect;
        if (!GetWindowRect(handle, out rect))
        {
            error = "GetWindowRect failed";
            return false;
        }

        var width = rect.Right - rect.Left;
        var height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0)
        {
            error = "window has no size";
            return false;
        }

        using (var bitmap = new Bitmap(width, height))
        {
            using (var graphics = Graphics.FromImage(bitmap))
            {
                var hdc = graphics.GetHdc();
                var ok = PrintWindow(handle, hdc, 2);
                graphics.ReleaseHdc(hdc);
                if (!ok)
                {
                    error = "PrintWindow returned false";
                    return false;
                }
            }

            bitmap.Save(path, ImageFormat.Png);
        }

        return true;
    }
}
"@

$process = Get-Process -Id $ProcessId
$handle = $process.MainWindowHandle
if ($handle -eq [IntPtr]::Zero) { throw "no main window handle" }

[void][PlatoCapture]::ShowWindow($handle, 9)
[void][PlatoCapture]::SetForegroundWindow($handle)
Start-Sleep -Milliseconds 800

$error = $null
if (-not [PlatoCapture]::Shot($handle, $Output, [ref]$error)) {
    throw $error
}

Write-Output $Output
