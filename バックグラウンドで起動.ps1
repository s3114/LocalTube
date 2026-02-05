$OutputEncoding = [System.Text.Encoding]::UTF8

$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $baseDir

Start-Process "cmd.exe" `
    -ArgumentList "/k call `"$baseDir\起動.bat`"" `
    -WindowStyle Hidden
