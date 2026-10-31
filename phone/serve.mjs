// Fixed mTLS API: /probe and /backup only. No file paths, commands, credentials or model tools.
import fs from'node:fs';import path from'node:path';import os from'node:os';import https from'node:https';
import{spawn}from'node:child_process';import{X509Certificate,createHash}from'node:crypto';
const configFile=process.argv[2]||path.join(import.meta.dirname,'../config.phone.json');
const cfg=JSON.parse(fs.readFileSync(configFile));const work=cfg.workRoot;
if(!/^(192\.168\.\d+|10\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+)\.0\/24$/.test(cfg.homeSubnet))throw Error('HOME_SUBNET_REQUIRED');
const prefix=cfg.homeSubnet.replace(/\.0\/24$/,'');const homeAddress=s=>s.startsWith(prefix+'.')&&/^\d+\.\d+\.\d+\.\d+$/.test(s);
const pcCert=fs.readFileSync(path.join(work,'pc-certificate.pem'));const pcPin=new X509Certificate(pcCert).fingerprint256;
const buildHash=createHash('sha256');for(const file of ['phone/serve.mjs','phone/job.mjs','lib/snapshot.mjs','lib/restic.mjs'])buildHash.update(fs.readFileSync(path.join(import.meta.dirname,'..',file)));const sourceDigest=buildHash.digest('hex');
let server,bind,activeJob,stopping=false;
const reply=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
function start(address){
 server=https.createServer({key:fs.readFileSync(path.join(work,'phone-private.pem')),cert:fs.readFileSync(path.join(work,'phone-certificate.pem')),ca:pcCert,requestCert:true,rejectUnauthorized:true,minVersion:'TLSv1.2'},async(req,res)=>{
  const peer=req.socket.getPeerCertificate();const remote=req.socket.remoteAddress;
  if(!req.socket.authorized||peer.fingerprint256!==pcPin||!homeAddress(remote)){reply(res,403,{errorCode:'UNAUTHORIZED'});return;}
  if(req.url==='/probe'&&req.method==='GET'){let lastFailure;try{lastFailure=JSON.parse(fs.readFileSync(path.join(work,'last-job-error.json')));}catch{}reply(res,200,{deviceId:cfg.deviceId,protocol:1,busy:!!activeJob,sourceDigest,lastFailure});return;}
  if(req.url!=='/backup'||req.method!=='POST'){reply(res,404,{errorCode:'NOT_FOUND'});return;}
  if(activeJob){reply(res,409,{errorCode:'BACKUP_BUSY'});return;}
  let body='';for await(const chunk of req){body+=chunk;if(body.length>1024){reply(res,413,{errorCode:'BODY_TOO_LARGE'});return;}}
  let request;try{request=JSON.parse(body);}catch{reply(res,400,{errorCode:'INVALID_REQUEST'});return;}
  if(Object.keys(request).some(k=>k!=='receiverPort')||request.receiverPort!==cfg.receiverPort){reply(res,400,{errorCode:'INVALID_REQUEST'});return;}
  const child=spawn(process.execPath,[path.join(import.meta.dirname,'job.mjs'),configFile,remote,String(cfg.receiverPort)],{detached:true,stdio:['ignore','pipe','ignore']});activeJob=child;
  let output='';child.stdout.on('data',b=>{output+=b;if(output.length>65536)try{process.kill(-child.pid,'SIGTERM');}catch{}});
  res.on('close',()=>{if(!res.writableEnded&&activeJob===child)try{process.kill(-child.pid,'SIGTERM');}catch{}});
  child.once('error',()=>{activeJob=null;reply(res,500,{errorCode:'JOB_START_FAILED'});});
  child.once('close',code=>{activeJob=null;if(res.destroyed)return;try{const result=JSON.parse(output.trim());reply(res,code===0?200:500,result);}catch{reply(res,500,{errorCode:'JOB_FAILED'});}});
 });
 server.requestTimeout=0;server.headersTimeout=15000;server.on('tlsClientError',()=>{});server.on('error',()=>{bind=null;});
 server.listen(cfg.controlPort,address);bind=address;
}
function reconcile(){
 if(stopping||activeJob)return;
 const addresses=Object.values(os.networkInterfaces()).flat().filter(x=>x.family==='IPv4'&&!x.internal&&homeAddress(x.address)).map(x=>x.address);
 const chosen=addresses[0];if(chosen===bind)return;
 if(server){server.closeAllConnections();server.close();server=null;bind=null;}
 if(chosen)start(chosen);
}
const timer=setInterval(reconcile,10000);reconcile();
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;clearInterval(timer);if(activeJob)try{process.kill(-activeJob.pid,'SIGTERM');}catch{}if(server){server.closeAllConnections();server.close();}setTimeout(()=>process.exit(0),200).unref();});
