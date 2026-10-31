param([Parameter(Mandatory=$true)][string]$Config)
$ErrorActionPreference='Stop'
$who=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $who.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMINISTRATOR_REQUIRED: home-LAN backup receiver rule only.'}
$cfg=Get-Content -LiteralPath (Resolve-Path -LiteralPath $Config).Path -Raw | ConvertFrom-Json
if($cfg.phone.discoverySubnet -notmatch '^(192\.168\.\d+|10\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+)\.0/24$'){throw 'HOME_SUBNET_REQUIRED'}
if($cfg.receiverPort -ne 38443){throw 'UNEXPECTED_RECEIVER_PORT'}
$exe=(Resolve-Path -LiteralPath $cfg.restServer).Path
if(Get-NetFirewallRule -Name 'XiaomanVaultReceiver' -ErrorAction SilentlyContinue){throw 'FIREWALL_RULE_EXISTS: refusing to overwrite.'}
# The actual server binds only the private LAN address selected by an authenticated phone probe.
# Profile Any is necessary here because this PC currently labels its home interfaces Public.
New-NetFirewallRule -Name 'XiaomanVaultReceiver' -DisplayName 'Xiaoman Vault authenticated receiver' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 38443 -RemoteAddress $cfg.phone.discoverySubnet -Program $exe -Profile Any | Select-Object Name,Enabled,Direction
