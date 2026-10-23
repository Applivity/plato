param([string]$Command)

$log = "C:\src\plato\packages\vs\dte-command.log"
try {
    $dte = [Runtime.InteropServices.Marshal]::GetActiveObject("VisualStudio.DTE.18.0")
    $dte.ExecuteCommand($Command)
    "returned" | Out-File -Encoding utf8 $log
} catch {
    $_.Exception.ToString() | Out-File -Encoding utf8 $log
}
