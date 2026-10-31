import fs from 'node:fs';import path from 'node:path';import{spawnSync}from'node:child_process';
import{fault,within}from'./snapshot.mjs';
const dpapi=path.resolve(import.meta.dirname,'../pc/dpapi.ps1');
export function protect(text,mode='protect'){
  const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',dpapi,'-Mode',mode],
    {input:text,encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
  if(result.status!==0||result.error)throw fault('DPAPI_FAILED');return result.stdout.trim();
}
export function privateDirectory(dir){
  fs.mkdirSync(dir,{recursive:true});
  const sid=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{encoding:'utf8',windowsHide:true}).stdout.trim();
  if(!/^S-1-[0-9-]+$/.test(sid))throw fault('WINDOWS_IDENTITY_FAILED');
  const r=spawnSync('icacls.exe',[dir,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F'],{encoding:'utf8',windowsHide:true});
  if(r.status!==0)throw fault('PRIVATE_ACL_FAILED');
}
export function scratch(root){
  const base=path.join(root,'scratch');fs.mkdirSync(base,{recursive:true});
  const dir=fs.mkdtempSync(path.join(base,'run-'));fs.writeFileSync(path.join(dir,'.vault-scratch'),'xiaoman-vault-v1');return dir;
}
export function removeScratch(root,dir){
  const base=fs.realpathSync(path.join(root,'scratch'));
  const target=fs.realpathSync(dir);
  if(!within(base,target)||fs.lstatSync(dir).isSymbolicLink()||fs.readFileSync(path.join(target,'.vault-scratch'),'utf8')!=='xiaoman-vault-v1')throw fault('SCRATCH_CLEANUP_REFUSED');
  // Only a checked, marked scratch below this vault is recursively removed. Never a source/repository.
  fs.rmSync(target,{recursive:true});
}
