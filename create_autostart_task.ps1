# Parameters
param (
    [string]$TaskName,
    [string]$BatPath,
    [string]$ResultFilePath
)

# --- Main Logic ---

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")

if (-not $isAdmin) {
    # Not admin, so re-launch with UAC
    $childCommand = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -TaskName `"$TaskName`" -BatPath `"$BatPath`" -ResultFilePath `"$ResultFilePath`""
    $process = Start-Process powershell.exe -ArgumentList $childCommand -Verb RunAs -Wait -PassThru
    
    if (Test-Path $ResultFilePath) {
        $fileContent = Get-Content $ResultFilePath -Raw
        Write-Output $fileContent
        Remove-Item $ResultFilePath
        exit $process.ExitCode
    } else {
        Write-Output "ERROR: Task operation was cancelled or failed to produce a result file."
        exit 1
    }
}

# --- Admin-only code starts here ---

$output = ""
$exitCode = 1

try {
    # バッチファイルの親フォルダ（開始ディレクトリ）を取得
    $workingDir = Split-Path -Parent $BatPath

    # タスクのアクションを作成（開始ディレクトリを指定）
    $action = New-ScheduledTaskAction -Execute $BatPath -WorkingDirectory $workingDir
    
    # トリガーを作成（システム起動時）
    $trigger = New-ScheduledTaskTrigger -AtStartup
    
    # タスクの登録（最上位の特権で実行 / 既存があれば上書き）
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -User "SYSTEM" -RunLevel Highest -Force | Out-Null

    $output = "SUCCESS: Auto-start task created successfully.`nWorking Directory set to: $workingDir"
    $exitCode = 0
} catch {
    $output = "ERROR: An exception occurred: $($_.Exception.Message)"
    $exitCode = 1
}

# Write result to the specified file
Set-Content -Path $ResultFilePath -Value $output

exit $exitCode