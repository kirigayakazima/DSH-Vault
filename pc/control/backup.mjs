import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import bcrypt from 'bcryptjs';
import {fault} from '../../lib/snapshot.mjs';
import {scratch,removeScratch} from '../../lib/windows-private.mjs';
import {phoneRequest} from '../../lib/phone-client.mjs';
import {auditContents} from '../../lib/contents.mjs';
import {localPhoneBuild,assertMatchingPhoneBuild} from '../../lib/build-identity.mjs';
import {findHost,reachable} from './discovery.mjs';
import os from 'node:os';
export async function backupNow(cfg,oldState,context){
 const {root,secret,admin,save,print,scheduled}=context;
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
  if(scheduled&&oldState.phoneOnline&&oldState.bootId===bootId&&!due){print({result:'not-due'});return;}
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
