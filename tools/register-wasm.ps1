param(
    [Parameter(Mandatory = $true)][ValidatePattern('^0x[0-9a-fA-F]{40}$')][string]$Account,
    [switch]$Check,
    [switch]$Status
)
$ErrorActionPreference = 'Stop'
if ($Check -and $Status) { throw 'Choose either -Check or -Status.' }
$nodeCommand = (Get-Command node -CommandType Application -ErrorAction Stop).Source
$entryScript = Join-Path $PSScriptRoot 'register-wasm.mjs'

if ($Status) {
    & $nodeCommand $entryScript --status --account $Account
    if ($LASTEXITCODE -ne 0) { throw 'Status check failed; do not resubmit blindly.' }
    return
}

& $nodeCommand $entryScript --check --account $Account
$checkExitCode = $LASTEXITCODE
if ($checkExitCode -eq 10) { return }
if ($checkExitCode -ne 0) { throw 'Read-only preflight failed. No private key requested and no transaction sent.' }
if ($Check) { return }

Write-Host 'This sends ONE WASM registration on Base Sepolia. Miner 4838 is not changed.'
Write-Host 'Node activation remains separate. The comparator has 30 documented overflow exceptions.'
$confirmation = Read-Host 'Type REGISTER_FX_NOW to approve the displayed registration and gas ceiling; anything else cancels'
if ($confirmation -cne 'REGISTER_FX_NOW') { Write-Host 'Cancelled. No private key requested and no transaction sent.'; return }

$privateKeySecure = Read-Host 'Paste the private key here (hidden; NOT a seed phrase; never paste it in chat)' -AsSecureString
$keyPointer = [IntPtr]::Zero
try {
    $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($privateKeySecure)
    # Pass through an anonymous stdin pipe, never command arguments, env vars or files.
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer) | & $nodeCommand $entryScript --send --key-stdin --confirm REGISTER_FX_NOW --account $Account
    $sendExitCode = $LASTEXITCODE
} finally {
    if ($keyPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer) }
    $privateKeySecure.Dispose()
    Remove-Variable privateKeySecure -ErrorAction SilentlyContinue
}
if ($sendExitCode -ne 0) { throw 'The helper stopped or confirmation is pending. Use -Status; do not create another registration.' }
