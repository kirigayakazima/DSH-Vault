// Bootstrap from an authenticated USB transfer. No production Heart/Mnemon writes.
import fs from'node:fs';import path from'node:path';import{spawn}from'node:child_process';
import{privateDecrypt,createDecipheriv,constants,createHash}from'node:crypto';
const work='/root/.xiaoman-vault';const envelope=JSON.parse(fs.readFileSync('/sdcard/dshproject/xiaoman-vault-setup/paired-install.sealed.json'));
const key=privateDecrypt({key:fs.readFileSync(path.join(work,'bootstrap-private.pem')),oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(envelope.key,'base64'));
const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
const payload=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]));
if(!/^xiaoman-redmi-22aa63dc-v1$/.test(payload.config.deviceId))throw Error('PAIRING_IDENTITY_MISMATCH');
if(fs.existsSync(path.join(work,'config.phone.json')))throw Error('ALREADY_INSTALLED_REFUSE_OVERWRITE');
const pkg=path.join(work,'package');fs.mkdirSync(pkg,{recursive:true,mode:0o700});
for(const entry of payload.files){
 if(!/^(lib|phone)\/[a-z-]+\.mjs$|^restic-linux-arm64$|^package\.json$|^cordis\.patch\.yml$/.test(entry.path))throw Error('INVALID_PACKAGE_PATH');
 const file=path.join(pkg,entry.path);const bytes=Buffer.from(entry.data,'base64');
 if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('PACKAGE_HASH_MISMATCH');
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,bytes,{mode:entry.path==='restic-linux-arm64'?0o700:0o600});
}
const secretFiles={'phone-private.pem':payload.phonePrivateKey,'phone-certificate.pem':payload.phoneCertificate,'pc-certificate.pem':payload.pcCertificate,
 'credentials.json':JSON.stringify({restPassword:payload.restPassword}),'repository.password':payload.repositoryPassword};
for(const [name,value]of Object.entries(secretFiles))fs.writeFileSync(path.join(work,name),value,{mode:0o600});
fs.writeFileSync(path.join(work,'config.phone.json'),JSON.stringify(payload.config,null,2)+'\n',{mode:0o600});
fs.writeFileSync(path.join(work,'install-receipt.json'),JSON.stringify({version:'0.1.0',deviceId:payload.config.deviceId,installedAt:new Date().toISOString(),files:payload.files.map(x=>({path:x.path,sha256:x.sha256}))},null,2),{mode:0o600});
if(process.argv.includes('--start-once')){
 const child=spawn(process.execPath,[path.join(pkg,'phone/serve.mjs'),path.join(work,'config.phone.json')],{detached:true,stdio:'ignore'});child.unref();
 console.log(JSON.stringify({installed:true,temporaryServicePid:child.pid,startupRegistered:false}));
}else console.log(JSON.stringify({installed:true,startupRegistered:false}));
