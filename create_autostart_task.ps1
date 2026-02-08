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
    # The non-admin process exits here
}

# --- Admin-only code starts here ---

# If we are here, we are running with admin rights
$output = ""
$exitCode = 1 # Default to error

try {
    $command = "schtasks /create /tn `"$TaskName`" /tr `"$BatPath`" /sc onstart /rl highest /f"
    $schtasksResult = Invoke-Expression $command 2>&1

    if ($LASTEXITCODE -eq 0) {
        $output = "SUCCESS: Auto-start task created successfully." + "`n" + $schtasksResult
        $exitCode = 0
    } else {
        $output = "ERROR: Failed to create task." + "`n" + $schtasksResult
        $exitCode = $LASTEXITCODE
    }
} catch {
    $output = "ERROR: An exception occurred: $($_.Exception.Message)"
    $exitCode = 1
}

# Write result to the specified file
Set-Content -Path $ResultFilePath -Value $output

# Admin process exits here
exit $exitCode
