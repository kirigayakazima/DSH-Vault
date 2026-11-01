// Application orchestration. Importing this module starts no process or network.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fault} from '../../lib/snapshot.mjs';
import {scratch,removeScratch} from '../../lib/windows-private.mjs';
import {createContext,save} from './context.mjs';
import {readVaultStatus} from '../../lib/status.mjs';
import {initialize} from './initialize.mjs';
import {backupNow} from './backup.mjs';
export async function runVaultCli(args, {print = value => console.log(JSON.stringify(value,null,2))} = {}){
 const [command,configPath]=args;
 const commands=['init','status','status-summary','backup-now','verify','list','restore-dry-run','retention-plan'];
 let root;
 try {
 if(!commands.includes(command)||!configPath){print({usage:'node pc/vault.mjs <'+commands.join('|')+'> <config.local.json>'});process.exitCode=2;return;}
 const cfg=JSON.parse(fs.readFileSync(path.resolve(configPath),'utf8'));root=path.resolve(cfg.dataRoot||'');
 if(!cfg.dataRoot||!path.isAbsolute(cfg.dataRoot)||!/^[a-zA-Z0-9-]{8,80}$/.test(cfg.deviceId||''))throw fault('INVALID_CONFIG');
 const context=createContext(cfg,{print,scheduled:args.includes('--scheduled')});
 if(command==='init'){await initialize(cfg,context);return;}
 if(command==='status-summary'){print(readVaultStatus(root,cfg.deviceId));return;}
 const marker=JSON.parse(fs.readFileSync(path.join(root,'.xiaoman-vault'),'utf8'));if(marker.deviceId!==cfg.deviceId)throw fault('VAULT_IDENTITY_MISMATCH');
 let state={};try{state=JSON.parse(fs.readFileSync(path.join(root,'status.json'),'utf8'));}catch{}
 if(command==='status'){print({dataRoot:root,...state});return;}
 // OS-backed SQLite lock is released on process crash/reboot; no unsafe stale-lock deletion.
 const mutex=new DatabaseSync(path.join(root,'coordinator.sqlite'));
 try{mutex.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS mutex (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE');}
 catch{mutex.close();throw fault('VAULT_BUSY');}
 try{
  if(command==='backup-now'){await backupNow(cfg,state,context);return;}
  const work=scratch(root);
  try{
   const restic=context.admin(cfg,context.secret(),work);
   if(command==='list'){const known=JSON.parse(fs.readFileSync(path.join(root,'verified.json'),'utf8'));print((await restic.list(cfg.deviceId)).map(s=>({id:s.id,time:s.time,verified:known.snapshots.some(v=>v.snapshotId===s.id)})));return;}
   if(command==='verify'){await restic.call(['unlock']).catch(()=>{});print(await restic.check());return;}
   if(command==='retention-plan'){const known=JSON.parse(fs.readFileSync(path.join(root,'verified.json'),'utf8'));print(await restic.verifiedRetention(known.snapshots.map(s=>s.snapshotId),cfg.deviceId));return;}
   if(command==='restore-dry-run'){
    const known=JSON.parse(fs.readFileSync(path.join(root,'verified.json'),'utf8'));const last=known.snapshots.at(-1);if(!last)throw fault('NO_VERIFIED_SNAPSHOT');
    print({...await restic.restore(last.snapshotId,path.join(work,'restored'),cfg.deviceId),snapshotId:last.snapshotId,isolated:true,productionRestorePerformed:false});
   }
  }finally{removeScratch(root,work);}
 }finally{mutex.exec('ROLLBACK');mutex.close();}
 }catch(e){const code=typeof e.code==='string'&&/^[A-Z0-9_]+$/.test(e.code)?e.code:'VAULT_OPERATION_FAILED';
 if(command!=='status-summary'&&root&&fs.existsSync(path.join(root,'.xiaoman-vault'))){try{const p=path.join(root,'status.json');let previous={};try{previous=JSON.parse(fs.readFileSync(p,'utf8'));}catch{}save(p,{...previous,lastAttempt:new Date().toISOString(),lastResult:'failed',errorCode:code});}catch{}}
 print({ok:false,errorCode:code});process.exitCode=1;

 }
}
