import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fault, within, verifySnapshot } from './snapshot.mjs';

export function run(program,args,{env={},cwd,timeoutMs=30*60*1000,onSpawn}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(program,args,{cwd,env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='',bytes=0,done=false,errLines=[];
    const timer=setTimeout(()=>{child.kill();finish(fault('COMMAND_TIMEOUT'));},timeoutMs);
    function finish(error,result) { if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(result); }
    child.on('error',()=>finish(fault('COMMAND_START_FAILED')));
    child.stdout.on('data',b=>{bytes+=b.length;if(bytes>64*1024*1024){child.kill();finish(fault('OUTPUT_LIMIT'));}else output+=b;});
    child.stderr.on('data',b=>{
      for(const line of b.toString().split(/\r?\n/)){if(line.trim())errLines.push(line.trim());}
      if(errLines.length>20)errLines=errLines.slice(-20);
    });
    child.on('close',code=>{
      if(code!==0&&errLines.length){
        finish(Object.assign(fault(`RESTIC_EXIT_${code??'UNKNOWN'}`),{details:{stderr:errLines}}));
      } else {
        finish(null,{code,stdout:output});
      }
    });
    onSpawn?.(child);
  });
}
export class Restic {
  constructor({executable,repository,passwordFile,cacheDir=path.join(path.dirname(passwordFile),'restic-cache'),env={}}) {
    this.executable=executable;this.repository=repository;
    const tempDir=path.join(path.dirname(passwordFile),'restic-temp');
    fs.mkdirSync(tempDir,{recursive:true,mode:0o700});
    this.env={RESTIC_REPOSITORY:repository,RESTIC_PASSWORD_FILE:passwordFile,RESTIC_PASSWORD:undefined,RESTIC_CACHE_DIR:cacheDir,
      TEMP:tempDir,TMP:tempDir,TMPDIR:tempDir,...env};
  }
  async call(args,options={}) {
    const result=await run(this.executable,args,{...options,env:{...this.env,...options.env}});
    if(result.code!==0) throw fault(`RESTIC_EXIT_${result.code ?? 'UNKNOWN'}`);
    return result.stdout;
  }
  async init(){await this.call(['init','--repository-version','2']);}
  async backup(stage,deviceId,options={}) {
    const output=await this.call(['backup','.','--json','--host',deviceId,'--tag','xiaoman-vault','--read-concurrency','1'],{cwd:stage,...options});
    const summary=output.trim().split(/\r?\n/).map(s=>JSON.parse(s)).findLast(s=>s.message_type==='summary');
    if(!summary?.snapshot_id)throw fault('SNAPSHOT_ID_MISSING');
    return {snapshotId:summary.snapshot_id,files:summary.total_files_processed,bytes:summary.total_bytes_processed,
      dataAdded:summary.data_added,storedAdded:summary.data_added_packed,durationSeconds:summary.total_duration};
  }
  async list(deviceId){return JSON.parse(await this.call(['snapshots','--json','--host',deviceId,'--tag','xiaoman-vault']));}
  async check(){await this.call(['check','--read-data']);return {allRepositoryDataChecked:true};}
  async restore(snapshotId,target,deviceId) {
    if(!/^[a-f0-9]{8,64}$/.test(snapshotId))throw fault('EXPLICIT_SNAPSHOT_ID_REQUIRED');
    if(fs.existsSync(target))throw fault('RESTORE_TARGET_EXISTS');
    fs.mkdirSync(target,{recursive:true,mode:0o700});
    await this.call(['restore',snapshotId,'--target',target,'--verify']);
    // backup '.' places the staged tree at the snapshot root, on both Linux and Windows.
    return verifySnapshot(target,deviceId);
  }
  async verifiedRetention(verifiedIds,deviceId,{apply=false}={}) {
    const snapshots=await this.list(deviceId);
    // A partial/unverified snapshot blocks cleanup. Never use a global 'forget --prune'.
    if(snapshots.some(s=>!verifiedIds.includes(s.id)))throw fault('UNVERIFIED_SNAPSHOT_BLOCKS_RETENTION');
    const args=['forget','--host',deviceId,'--tag','xiaoman-vault','--keep-daily','7','--keep-weekly','4','--group-by','host,tags','--json'];
    if(!apply)args.push('--dry-run');
    return JSON.parse(await this.call(args));
  }
}
