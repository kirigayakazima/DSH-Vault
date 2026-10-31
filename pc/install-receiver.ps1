param([Parameter(Mandatory=$true)][string]$Config,[Parameter(Mandatory=$true)][string]$NodeExe)
$ErrorActionPreference='Stop'
$who=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $who.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMINISTRATOR_REQUIRED: only the dedicated vault and home-LAN receiver rule will be configured.'}
$cfg=(Resolve-Path -LiteralPath $Config).Path
$node=(Resolve-Path -LiteralPath $NodeExe).Path
& $node (Join-Path $PSScriptRoot 'vault.mjs') init $cfg
if($LASTEXITCODE -ne 0){throw 'REPOSITORY_INIT_FAILED: receiver firewall rule was not added.'}
if(-not(Get-NetFirewallRule -Name 'XiaomanVaultReceiver' -ErrorAction SilentlyContinue)){
  & (Join-Path $PSScriptRoot 'allow-network.ps1') -Config $cfg
}
Write-Output 'Vault and receiver rule ready. No startup task, persistent receiver or sister data changes.'
