import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import os from 'node:os';
import{spawn,spawnSync}from'node:child_process';import{randomBytes,randomUUID}from'node:crypto';import bcrypt from'bcryptjs';
import{DatabaseSync}from'node:sqlite';
import{Restic,run}from'../lib/restic.mjs';import{fault,within}from'../lib/snapshot.mjs';
import{protect,privateDirectory,scratch,removeScratch}from'../lib/windows-private.mjs';
import{phoneRequest}from'../lib/phone-client.mjs';
import{auditContents}from'../lib/contents.mjs';
import{localPhoneBuild,assertMatchingPhoneBuild}from'../lib/build-identity.mjs';

const [command,configPath]=process.argv.slice(2);
const commands=['init','status','backup-now','verify','list','restore-dry-run','retention-plan'];
const print=x=>console.log(JSON.stringify(x,null,2));
let root;
function save(file,value){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n');fs.renameSync(tmp,file);}
function secret(){return JSON.parse(protect(fs.readFileSync(path.join(root,'secrets.dpapi'),'utf8'),'unprotect'));}
function admin(cfg,secretValue,work){
 const passwordFile=path.join(work,'repository.password');fs.writeFileSync(passwordFile,secretValue.repositoryPassword,{mode:0o600});
 return new Restic({executable:cfg.restic,repository:path.join(root,'repositories/xiaoman'),passwordFile,cacheDir:path.join(root,'cache')});
}
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function reachable(host,p,timeout=500,localAddress){return new Promise(resolve=>{const s=net.connect({host,port:p,localAddress});let done=false;const finish=x=>{if(done)return;done=true;s.destroy();resolve(x);};s.setTimeout(timeout,()=>finish(false));s.on('connect',()=>finish(true));s.on('error',()=>finish(false));});}
async function findHost(cfg,identity){
 const hosts=[...(cfg.phone.hosts||[])];
 const prefix=cfg.phone.discoverySubnet?.replace(/\.0\/24$/,'')+'.';
 const locals=Object.values(os.networkInterfaces()).flat().filter(s=>s.family==='IPv4'&&!s.internal&&s.address.startsWith(prefix)).map(s=>s.address);
 if(!locals.length)return null;
 async function probe(host,localAddress){try{if(!await reachable(host,cfg.phone.port,350,localAddress))return null;const response=await phoneRequest(host,cfg.phone.port,'/probe',identity,{localAddress});if(response.value.deviceId===cfg.deviceId)return{host,localAddress:response.localAddress,sourceDigest:response.value.sourceDigest};}catch{}return null;}
 for(const host of hosts)for(const local of locals){const found=await probe(host,local);if(found)return found;}
 // Only an explicitly configured private /24 can be discovered. Every candidate is authenticated by mTLS.
 if(cfg.phone.discoverySubnet){const m=cfg.phone.discoverySubnet.match(/^(192\.168\.\d+|10\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+)\.0\/24$/);if(!m)throw fault('INVALID_HOME_SUBNET');
  for(let n=1;n<255;n++){const h=m[1]+'.'+n;if(!hosts.includes(h))hosts.push(h);}}
 for(const local of locals){const open=[];for(let i=0;i<hosts.length;i+=24)await Promise.all(hosts.slice(i,i+24).map(async h=>{if(await reachable(h,cfg.phone.port,250,local))open.push(h);}));
  for(const host of open){const found=await probe(host,local);if(found)return found;}}
 return null;
}
async function initialize(cfg){
 let resumeSecret;
 if(fs.existsSync(root)&&fs.readdirSync(root).length){
  const marker=JSON.parse(fs.readFileSync(path.join(root,'.xiaoman-vault'),'utf8'));
  if(marker.deviceId!==cfg.deviceId||marker.schema!==1)throw fault('INIT_REQUIRES_EMPTY_NEW_DIRECTORY');
  resumeSecret=secret();
  if(fs.existsSync(path.join(root,'repositories/xiaoman/config'))){
   print({initialized:true,alreadyInitialized:true,dataRoot:root});return;
  }
 }
 privateDirectory(root);const work=scratch(root);
 try{
  let secrets=resumeSecret;
  if(!secrets){
  const made=spawnSync(cfg.powerShell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(import.meta.dirname,'certificates.ps1')],{input:JSON.stringify({deviceId:cfg.deviceId,subnet:cfg.phone.discoverySubnet}),encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
  if(made.status!==0)throw fault('CERTIFICATE_CREATION_FAILED');
  const certificates=JSON.parse(made.stdout);
  secrets={repositoryPassword:randomBytes(32).toString('hex'),restPassword:randomBytes(32).toString('hex'),certificates};
  fs.writeFileSync(path.join(root,'secrets.dpapi'),protect(JSON.stringify(secrets)));
  fs.writeFileSync(path.join(root,'pc-certificate.pem'),certificates.pc.certificate);
  fs.writeFileSync(path.join(root,'phone-certificate.pem'),certificates.phone.certificate);
  fs.writeFileSync(path.join(root,'.xiaoman-vault'),JSON.stringify({schema:1,deviceId:cfg.deviceId,createdAt:new Date().toISOString()}));
  }
  fs.mkdirSync(path.join(root,'repositories'),{recursive:true});await admin(cfg,secrets,work).init();
  save(path.join(root,'verified.json'),{schema:1,snapshots:[]});
  print({initialized:true,dataRoot:root,pairingRequired:true,recoveryKeyExportRequired:true,certificateExpires:secrets.certificates.pc.expires});
 }finally{removeScratch(root,work);}
}
async function backupNow(cfg,oldState){
 const work=scratch(root);let server;
 try{
  const secrets=secret();const identity={key:secrets.certificates.pc.privateKey,cert:secrets.certificates.pc.certificate,ca:secrets.certificates.phone.certificate};
  const found=await findHost(cfg,identity);
  if(!found){save(path.join(root,'status.json'),{...oldState,lastAttempt:new Date().toISOString(),lastResult:'phone-offline',phoneOnline:false});print({result:'phone-offline',previousVerifiedSnapshot:oldState.lastVerifiedSnapshot||null});return;}
  // Fail before starting the receiver or sending /backup. Never treat an authenticated
  // but outdated component as offline, and never accept a stale local installation packet.
  assertMatchingPhoneBuild(found.sourceDigest,localPhoneBuild().sourceDigest);
  const bootId=Math.round((Date.now()-os.uptime()*1000)/60000);
  const due=Date.now()-Date.parse(oldState.lastSuccess||'1970-01-01')>=(cfg.intervalMinutes||60)*60000;
  if(process.argv.includes('--scheduled')&&oldState.phoneOnline&&oldState.bootId===bootId&&!due){print({result:'not-due'});return;}
  const p=cfg.receiverPort;const htpasswd=path.join(work,'htpasswd');fs.writeFileSync(htpasswd,`xiaoman:${await bcrypt.hash(secrets.restPassword,12)}\n`);
  const tlsKey=path.join(work,'receiver-private.pem');fs.writeFileSync(tlsKey,secrets.certificates.pc.privateKey);
  if(await reachable(found.localAddress,p))throw fault('RECEIVER_PORT_IN_USE');
  server=spawn(cfg.restServer,['--listen',`${found.localAddress}:${p}`,'--path',path.join(root,'repositories'),'--htpasswd-file',htpasswd,'--append-only','--private-repos',
    '--tls','--tls-cert',path.join(root,'pc-certificate.pem'),'--tls-key',tlsKey,'--tls-min-ver','1.2'],{windowsHide:true,stdio:'ignore'});
  await new Promise((resolve,reject)=>{let timer,deadline;const finish=e=>{clearInterval(timer);clearTimeout(deadline);e?reject(e):resolve();};server.once('error',()=>finish(fault('RECEIVER_START_FAILED')));timer=setInterval(async()=>{if(await reachable(found.localAddress,p))finish();},100);deadline=setTimeout(()=>finish(fault('RECEIVER_START_TIMEOUT')),5000);});
  const started=performance.now();
  const response=await phoneRequest(found.host,cfg.phone.port,'/backup',identity,{body:{receiverPort:p},localAddress:found.localAddress,timeoutMs:(cfg.backupTimeoutMinutes||120)*60000});
  const result=response.value;
  if(result.deviceId!==cfg.deviceId||!/^[a-f0-9]{64}$/.test(result.snapshotId||''))throw fault('PHONE_RESPONSE_IDENTITY_MISMATCH');
  const restic=admin(cfg,secrets,work);await restic.call(['unlock']).catch(()=>{});await restic.check();
  const restored=await restic.restore(result.snapshotId,path.join(work,'restored'),cfg.deviceId);
  const contents=await auditContents(path.join(work,'restored'));
  const verified=JSON.parse(fs.readFileSync(path.join(root,'verified.json')));
  const completed={snapshotId:result.snapshotId,generation:restored.generation,verifiedAt:new Date().toISOString(),files:restored.files,bytes:restored.bytes,sqlite:restored.sqlite};
  verified.snapshots.push(completed);save(path.join(root,'verified.json'),verified);
  const state={schema:1,bootId,phoneOnline:true,lastResult:'verified',lastAttempt:completed.verifiedAt,lastSuccess:completed.verifiedAt,lastVerifiedSnapshot:completed.snapshotId,
    durationMs:Math.round(performance.now()-started),...restored,upload:result.upload,phoneResources:result.resources,contents,phoneSourceDigest:found.sourceDigest};
  save(path.join(root,'status.json'),state);print(state);
 }finally{if(server&&server.exitCode===null){await new Promise(r=>{server.once('close',r);server.kill();});}removeScratch(root,work);}
}
async function main(){
 if(!commands.includes(command)||!configPath){print({usage:'node pc/vault.mjs <'+commands.join('|')+'> <config.local.json>'});process.exitCode=2;return;}
 const cfg=JSON.parse(fs.readFileSync(path.resolve(configPath),'utf8'));root=path.resolve(cfg.dataRoot||'');
 if(!cfg.dataRoot||!path.isAbsolute(cfg.dataRoot)||!/^[a-zA-Z0-9-]{8,80}$/.test(cfg.deviceId||''))throw fault('INVALID_CONFIG');
 if(command==='init'){await initialize(cfg);return;}
 const marker=JSON.parse(fs.readFileSync(path.join(root,'.xiaoman-vault'),'utf8'));if(marker.deviceId!==cfg.deviceId)throw fault('VAULT_IDENTITY_MISMATCH');
 let state={};try{state=JSON.parse(fs.readFileSync(path.join(root,'status.json'),'utf8'));}catch{}
 if(command==='status'){print({dataRoot:root,...state});return;}
 // OS-backed SQLite lock is released on process crash/reboot; no unsafe stale-lock deletion.
 const mutex=new DatabaseSync(path.join(root,'coordinator.sqlite'));
 try{mutex.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS mutex (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE');}
 catch{mutex.close();throw fault('VAULT_BUSY');}
 try{
  if(command==='backup-now'){await backupNow(cfg,state);return;}
  const work=scratch(root);
  try{
   const restic=admin(cfg,secret(),work);
   if(command==='list'){const known=JSON.parse(fs.readFileSync(path.join(root,'verified.json'),'utf8'));print((await restic.list(cfg.deviceId)).map(s=>({id:s.id,time:s.time,verified:known.snapshots.some(v=>v.snapshotId===s.id)})));return;}
   if(command==='verify'){await restic.call(['unlock']).catch(()=>{});print(await restic.check());return;}
   if(command==='retention-plan'){const known=JSON.parse(fs.readFileSync(path.join(root,'verified.json'),'utf8'));print(await restic.verifiedRetention(known.snapshots.map(s=>s.snapshotId),cfg.deviceId));return;}
   if(command==='restore-dry-run'){
    const known=JSON.parse(fs.readFileSync(path.join(root,'verified.json'),'utf8'));const last=known.snapshots.at(-1);if(!last)throw fault('NO_VERIFIED_SNAPSHOT');
    print({...await restic.restore(last.snapshotId,path.join(work,'restored'),cfg.deviceId),snapshotId:last.snapshotId,isolated:true,productionRestorePerformed:false});
   }
  }finally{removeScratch(root,work);}
 }finally{mutex.exec('ROLLBACK');mutex.close();}
}
main().catch(e=>{const code=typeof e.code==='string'&&/^[A-Z0-9_]+$/.test(e.code)?e.code:'VAULT_OPERATION_FAILED';
 if(root&&fs.existsSync(path.join(root,'.xiaoman-vault'))){try{const p=path.join(root,'status.json');let previous={};try{previous=JSON.parse(fs.readFileSync(p,'utf8'));}catch{}save(p,{...previous,lastAttempt:new Date().toISOString(),lastResult:'failed',errorCode:code});}catch{}}
 print({ok:false,errorCode:code});process.exitCode=1;
});
