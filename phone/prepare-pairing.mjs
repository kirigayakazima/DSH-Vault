// Creates only the new backup component's private directory and a public pairing key.
import fs from'node:fs';import path from'node:path';import{generateKeyPairSync,createHash}from'node:crypto';
const work='/root/.xiaoman-vault';const out='/sdcard/dshproject/xiaoman-vault-setup/result';
fs.mkdirSync(work,{recursive:true,mode:0o700});fs.mkdirSync(out,{recursive:true});
const keyFile=path.join(work,'bootstrap-private.pem');
if(!fs.existsSync(keyFile)){
 const key=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 fs.writeFileSync(keyFile,key.privateKey,{mode:0o600});fs.writeFileSync(path.join(work,'bootstrap-public.pem'),key.publicKey,{mode:0o600});
}
fs.copyFileSync(path.join(work,'bootstrap-public.pem'),path.join(out,'phone-pairing-public.pem'));
const report={schema:1,workRoot:work,freeBytes:fs.statfsSync(work).bavail*fs.statfsSync(work).bsize,nativeRoots:[],backupChildren:[],privateMetadata:[]};
for(const p of ['/data/user/0/com.dsh.client/files','/data/user/0/com.dsh.client/shared_prefs','/data/user/0/com.dsh.client/no_backup','/root/.agents','/root/.dsh-qqbot','/root/.local','/root/.dsh/backup']){
 try{const children=fs.readdirSync(p).map(name=>{const s=fs.lstatSync(path.join(p,name));return{name,kind:s.isDirectory()?'directory':s.isSymbolicLink()?'symlink':'file',bytes:s.size};});report.nativeRoots.push({path:p,readable:true,children});}
 catch(e){report.nativeRoots.push({path:p,readable:false,code:e.code});}
}
for(const p of ['/root/.dsh/backup/rvc-lib-torch-deprecated']){
 try {for(const name of fs.readdirSync(p).filter(n=>n.endsWith('.dist-info'))){const file=path.join(p,name,'METADATA');if(fs.existsSync(file)){const text=fs.readFileSync(file,'utf8');report.privateMetadata.push({directory:name,name:text.match(/^Name: (.+)$/m)?.[1],version:text.match(/^Version: (.+)$/m)?.[1]});}}}catch{}
}
fs.writeFileSync(path.join(out,'pairing-inventory.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:true,publicKeySha256:createHash('sha256').update(fs.readFileSync(path.join(out,'phone-pairing-public.pem'))).digest('hex'),freeBytes:report.freeBytes}));
