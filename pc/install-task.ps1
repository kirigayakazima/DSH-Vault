param([Parameter(Mandatory=$true)][string]$Config,[Parameter(Mandatory=$true)][string]$NodeExe)
$ErrorActionPreference='Stop'
$who=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $who.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'ADMINISTRATOR_REQUIRED: dedicated XiaomanVault task only.'}
$configPath=(Resolve-Path -LiteralPath $Config).Path
$nodePath=(Resolve-Path -LiteralPath $NodeExe).Path
$controller=Join-Path $PSScriptRoot 'vault.mjs'
$parsed=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if(-not(Test-Path -LiteralPath (Join-Path $parsed.dataRoot '.xiaoman-vault'))){throw 'INITIALIZE_AND_VERIFY_REAL_BACKUP_FIRST'}
$status=Get-Content -LiteralPath (Join-Path $parsed.dataRoot 'status.json') -Raw | ConvertFrom-Json
if($status.lastResult -ne 'verified'){throw 'NO_VERIFIED_RESTORE_POINT: refusing to enable scheduled task.'}
& $nodePath (Join-Path $PSScriptRoot 'check-auto-ready.mjs') $configPath
if($LASTEXITCODE -ne 0){throw 'SAFE_BUILD_BACKUP_REQUIRED: verify a backup and isolated restore with the current phone build first.'}
if(Get-ScheduledTask -TaskName 'XiaomanVault' -ErrorAction SilentlyContinue){throw 'TASK_EXISTS: refusing to overwrite.'}
$action=New-ScheduledTaskAction -Execute $nodePath -Argument ('"'+$controller+'" backup-now "'+$configPath+'" --scheduled') -WorkingDirectory $PSScriptRoot
$poll=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$startup=New-ScheduledTaskTrigger -AtStartup
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3)
$principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName 'XiaomanVault' -Action $action -Trigger @($startup,$poll) -Settings $settings -Principal $principal -Description 'Xiaoman one-way encrypted backup. Startup and 5-minute checks. No LLM or sister data access.' | Select-Object TaskName,State
