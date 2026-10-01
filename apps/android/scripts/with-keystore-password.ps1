# Runs a Gradle command with the release keystore password in the environment
# of the child process only. The password is stored DPAPI-encrypted (bound to
# this Windows user) next to the keystore; it is never printed or written.
#
# Usage: ./with-keystore-password.ps1 ./gradlew.bat assembleRelease
param(
    [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
    [string[]] $Command
)

$ErrorActionPreference = 'Stop'
$dir = if ($env:NEOQUIZ_KEYSTORE_DIR) { $env:NEOQUIZ_KEYSTORE_DIR } else { 'C:/Users/Ahmed/Keys/neo-quiz' }

$secure = Get-Content -LiteralPath (Join-Path $dir 'storepass.dpapi') | ConvertTo-SecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $env:NEOQUIZ_KEYSTORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    & $Command[0] @($Command | Select-Object -Skip 1)
    $code = $LASTEXITCODE
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    Remove-Item Env:NEOQUIZ_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
}
exit $code
