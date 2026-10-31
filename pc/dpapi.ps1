param([Parameter(Mandatory=$true)][ValidateSet('protect','unprotect')][string]$Mode)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$inputText=[Console]::In.ReadToEnd().Trim()
$entropy=[Text.Encoding]::UTF8.GetBytes('xiaoman-vault-v1')
try {
  if($Mode -eq 'protect') {
    $raw=[Text.Encoding]::UTF8.GetBytes($inputText)
    $sealed=[Security.Cryptography.ProtectedData]::Protect($raw,$entropy,[Security.Cryptography.DataProtectionScope]::LocalMachine)
    [Console]::Out.Write([Convert]::ToBase64String($sealed))
  } else {
    $raw=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($inputText),$entropy,[Security.Cryptography.DataProtectionScope]::LocalMachine)
    [Console]::Out.Write([Text.Encoding]::UTF8.GetString($raw))
  }
} catch { [Console]::Error.Write('DPAPI_FAILED'); exit 1 }
