import fs from'node:fs';import path from'node:path';import{DatabaseSync}from'node:sqlite';
import{createSnapshot,fault,removeOwnedSnapshot}from'../lib/snapshot.mjs';import{Restic}from'../lib/restic.mjs';
const print=x=>console.log(JSON.stringify(x));
async function main(){
 const [configFile,pcHost,port]=process.argv.slice(2);const cfg=JSON.parse(fs.readFileSync(configFile));
 if(!/^\d+\.\d+\.\d+\.\d+$/.test(pcHost)||Number(port)!==cfg.receiverPort)throw fault('INVALID_RECEIVER');
 const started=process.cpuUsage();const lock=new DatabaseSync(path.join(cfg.workRoot,'coordinator.sqlite'));
 try{lock.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS mutex (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE');}catch{lock.close();throw fault('PHONE_BACKUP_BUSY');}
 let ownedStage;
 try{
  // An acquired OS lock proves there is no other backup job; discard only marked old scratch.
  if(fs.existsSync(cfg.stageRoot))for(const name of fs.readdirSync(cfg.stageRoot)){
    const dir=path.join(cfg.stageRoot,name);
    if(name.startsWith('snapshot-')&&fs.existsSync(path.join(dir,'.xiaoman-snapshot')))removeOwnedSnapshot(cfg.stageRoot,dir);
  }
  const credentials=JSON.parse(fs.readFileSync(path.join(cfg.workRoot,'credentials.json')));
  const client=new Restic({executable:cfg.restic,repository:`rest:https://${pcHost}:${cfg.receiverPort}/xiaoman/`,passwordFile:path.join(cfg.workRoot,'repository.password'),
    cacheDir:path.join(cfg.workRoot,'cache'),env:{RESTIC_REST_USERNAME:'xiaoman',RESTIC_REST_PASSWORD:credentials.restPassword,RESTIC_CACERT:path.join(cfg.workRoot,'pc-certificate.pem'),GOMAXPROCS:'2',GOMEMLIMIT:'256MiB'}});
  await client.call(['snapshots','--json']);
  const {stage,manifest}=await createSnapshot(cfg);ownedStage=stage;
  const upload=await client.backup(stage,cfg.deviceId);
  const cpu=process.cpuUsage(started);
  print({deviceId:cfg.deviceId,snapshotId:upload.snapshotId,files:manifest.files.length,bytes:manifest.bytes,upload,
    resources:{snapshotMs:manifest.durationMs,nodeCpuUserMs:cpu.user/1000,nodeCpuSystemMs:cpu.system/1000,nodePeakRssKiB:process.resourceUsage().maxRSS},stage});
 }finally{if(ownedStage&&path.basename(ownedStage).startsWith('snapshot-'))removeOwnedSnapshot(cfg.stageRoot,ownedStage);lock.exec('ROLLBACK');lock.close();}
}
main().catch(e=>{const failure={ok:false,errorCode:typeof e.code==='string'&&/^[A-Z0-9_]+$/.test(e.code)?e.code:'PHONE_BACKUP_FAILED',details:e.details};
 try{const cfg=JSON.parse(fs.readFileSync(process.argv[2]));fs.writeFileSync(path.join(cfg.workRoot,'last-job-error.json'),JSON.stringify(failure));}catch{}
 print(failure);process.exitCode=1;});
