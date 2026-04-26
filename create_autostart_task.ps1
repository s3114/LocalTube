# Parameters
param (
    [string]$TaskName = "YoutubeDL-AutoStart",
    [string]$BatPath = "",
    [ValidateSet("startup", "logon")]
    [string]$TriggerMode = "startup",
    [string]$ResultFilePath = (Join-Path $env:TEMP ("autostart_result_create_{0}.txt" -f [DateTimeOffset]::Now.ToUnixTimeMilliseconds()))
)

function Resolve-BatPath([string]$candidate) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate)) {
        return (Resolve-Path -LiteralPath $candidate).Path
    }

    $batCandidates = Get-ChildItem -LiteralPath $PSScriptRoot -Filter "*.bat" -File -ErrorAction SilentlyContinue
    $preferred = $batCandidates | Where-Object { $_.Name -eq "起動.bat" } | Select-Object -First 1
    if (-not $preferred) {
        $preferred = $batCandidates | Where-Object { $_.Name -eq "起動最小構成.bat" } | Select-Object -First 1
    }
    if (-not $preferred) {
        $preferred = $batCandidates | Select-Object -First 1
    }
    if ($preferred) {
        return $preferred.FullName
    }

    return ""
}

$BatPath = Resolve-BatPath $BatPath
if ([string]::IsNullOrWhiteSpace($BatPath)) {
    $message = "ERROR: BatPath not found."
    if (-not [string]::IsNullOrWhiteSpace($ResultFilePath)) {
        Set-Content -Path $ResultFilePath -Value $message
    }
    Write-Output $message
    exit 1
}

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $isAdmin) {
    $powerShellExe = Join-Path $PSHOME "powershell.exe"
    $childArgs = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $PSCommandPath,
        "-TaskName", $TaskName,
        "-BatPath", $BatPath,
        "-TriggerMode", $TriggerMode,
        "-ResultFilePath", $ResultFilePath
    )
    try {
        $process = Start-Process -FilePath $powerShellExe -ArgumentList $childArgs -Verb RunAs -Wait -PassThru -ErrorAction Stop
    } catch {
        $message = "ERROR: Failed to launch elevated PowerShell: $($_.Exception.Message)"
        if (-not [string]::IsNullOrWhiteSpace($ResultFilePath)) {
            Set-Content -Path $ResultFilePath -Value $message
        }
        Write-Output $message
        exit 1
    }

    if (-not [string]::IsNullOrWhiteSpace($ResultFilePath) -and (Test-Path -LiteralPath $ResultFilePath)) {
        $fileContent = Get-Content $ResultFilePath -Raw
        Write-Output $fileContent
        Remove-Item $ResultFilePath
        exit $process.ExitCode
    }

    Write-Output "ERROR: Task operation was cancelled or failed to produce a result file."
    exit 1
}

# --- Admin-only code starts here ---
$output = ""
$exitCode = 1

try {
    $resolvedBat = (Resolve-Path -LiteralPath $BatPath -ErrorAction Stop).Path
    $workingDir = Split-Path -Parent $resolvedBat

    $action = New-ScheduledTaskAction -Execute $resolvedBat -WorkingDirectory $workingDir
    if ($TriggerMode -eq "logon") {
        $trigger = New-ScheduledTaskTrigger -AtLogOn
        $principal = New-ScheduledTaskPrincipal -GroupId "BUILTIN\Users" -RunLevel Highest
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Force -ErrorAction Stop | Out-Null
    } else {
        $trigger = New-ScheduledTaskTrigger -AtStartup
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -User "SYSTEM" -RunLevel Highest -Force -ErrorAction Stop | Out-Null
    }
    Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Out-Null

    $modeLabel = if ($TriggerMode -eq "logon") { "logon" } else { "startup" }
    $userLabel = if ($TriggerMode -eq "logon") { "BUILTIN\Users (any user logon)" } else { "SYSTEM" }
    $output = "SUCCESS: Auto-start task created successfully.`nMode: $modeLabel`nUser: $userLabel`nBatPath: $resolvedBat`nWorking Directory set to: $workingDir"
    $exitCode = 0
} catch {
    $output = "ERROR: An exception occurred: $($_.Exception.Message)"
    $exitCode = 1
}

if (-not [string]::IsNullOrWhiteSpace($ResultFilePath)) {
    Set-Content -Path $ResultFilePath -Value $output
}

Write-Output $output
exit $exitCode
