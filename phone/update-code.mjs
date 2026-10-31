// Update only this component's authenticated package; never overwrite its paired secrets or source data.
import fs from'node:fs';import path from'node:path';import{spawn}from'node:child_process';import{DatabaseSync}from'node:sqlite';
import{privateDecrypt,createDecipheriv,constants,createHash}from'node:crypto';
const work='/root/.xiaoman-vault',pkg=path.join(work,'package');
const envelope=JSON.parse(fs.readFileSync('/sdcard/dshproject/xiaoman-vault-setup/paired-install.sealed.json'));
const key=privateDecrypt({key:fs.readFileSync(path.join(work,'bootstrap-private.pem')),oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(envelope.key,'base64'));
const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));cipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
const payload=JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.data,'base64')),cipher.final()]));
const cfg=JSON.parse(fs.readFileSync(path.join(work,'config.phone.json')));
if(cfg.deviceId!==payload.config.deviceId||fs.readFileSync(path.join(work,'pc-certificate.pem'),'utf8')!==payload.pcCertificate)throw Error('EXISTING_PAIRING_MISMATCH');
const lock=new DatabaseSync(path.join(work,'coordinator.sqlite'));lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
const diagnostics={at:new Date().toISOString(),files:[]};
try{
 for(const file of ['/root/.dsh/.anonymous-user-id','/root/.dsh/heart/notebook.md']){
  const fd=fs.openSync(file,'r');try{
   const a=fs.fstatSync(fd,{bigint:true});const b=fs.lstatSync(file,{bigint:true});
   const next=fs.openSync(file,'r');const c=fs.fstatSync(next,{bigint:true});fs.closeSync(next);
   const fields=['dev','ino','size','mtimeNs','ctimeNs'];
   diagnostics.files.push({sourceRef:createHash('sha256').update(file).digest('hex'),fstatVsPathDifferent:fields.filter(k=>a[k]!==b[k]),fstatVsReopenDifferent:fields.filter(k=>a[k]!==c[k])});
  }finally{fs.closeSync(fd);}
 }
 for(const entry of payload.files){
  if(!/^(lib|phone)\/[a-z-]+\.mjs$|^package\.json$|^cordis\.patch\.yml$|^restic-linux-arm64$/.test(entry.path))throw Error('INVALID_PACKAGE_PATH');
  const bytes=Buffer.from(entry.data,'base64');if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('PACKAGE_HASH_MISMATCH');
  const target=path.join(pkg,entry.path);fs.writeFileSync(target+'.update',bytes,{mode:entry.path==='restic-linux-arm64'?0o700:0o600});fs.renameSync(target+'.update',target);
 }
 // Existing paired credentials, configuration and snapshot cache are preserved.
 const serve=path.join(pkg,'phone/serve.mjs'),configFile=path.join(work,'config.phone.json');
 for(const id of fs.readdirSync('/proc').filter(s=>/^\d+$/.test(s))){try{const args=fs.readFileSync('/proc/'+id+'/cmdline','utf8').split('\0');if(args[1]===serve&&args[2]===configFile)process.kill(Number(id),'SIGTERM');}catch{}}
 await new Promise(r=>setTimeout(r,600));
 const child=spawn(process.execPath,[serve,configFile],{detached:true,stdio:'ignore'});child.unref();
 diagnostics.updated=true;diagnostics.temporaryServicePid=child.pid;
}finally{lock.exec('ROLLBACK');lock.close();}
fs.writeFileSync('/sdcard/dshproject/xiaoman-vault-setup/result/file-metadata-diagnostic.json',JSON.stringify(diagnostics,null,2));
console.log(JSON.stringify({updated:true,temporaryServicePid:diagnostics.temporaryServicePid,sourceDataChanged:false,pairedSecretsChanged:false}));
