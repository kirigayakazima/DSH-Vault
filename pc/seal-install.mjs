import fs from'node:fs';import path from'node:path';import{randomBytes,publicEncrypt,createCipheriv,createHash,constants}from'node:crypto';
import{protect}from'../lib/windows-private.mjs';
import{localPhoneBuild}from'../lib/build-identity.mjs';
const buildIdentity=localPhoneBuild();
const cfg=JSON.parse(fs.readFileSync(process.argv[2]));const phoneConfig=JSON.parse(fs.readFileSync(process.argv[3]));const publicKey=fs.readFileSync(process.argv[4]);
const secrets=JSON.parse(protect(fs.readFileSync(path.join(cfg.dataRoot,'secrets.dpapi'),'utf8'),'unprotect'));
const root=path.resolve(import.meta.dirname,'..');
const files=[];
for(const relative of ['lib/snapshot.mjs','lib/restic.mjs','phone/serve.mjs','phone/job.mjs','phone/plugin.mjs']){
 const bytes=fs.readFileSync(path.join(root,relative));files.push({path:relative,data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')});
}
for(const [name,bytes]of [
 ['restic-linux-arm64',fs.readFileSync(path.join(root,'tools/restic/restic-linux-arm64'))],
 ['package.json',Buffer.from(JSON.stringify({name:'@dsh/xiaoman-vault',version:'0.1.0',private:true,type:'module',main:'phone/plugin.mjs',dsh:{bundle:{patch:'cordis.patch.yml'}}}))],
 ['cordis.patch.yml',Buffer.from('- insert:\n    - id: xiaoman-vault\n      name: "@dsh/xiaoman-vault"\n')]
]) files.push({path:name,data:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')});
const payload=Buffer.from(JSON.stringify({buildIdentity,config:phoneConfig,files,phonePrivateKey:secrets.certificates.phone.privateKey,phoneCertificate:secrets.certificates.phone.certificate,
 pcCertificate:secrets.certificates.pc.certificate,restPassword:secrets.restPassword,repositoryPassword:secrets.repositoryPassword}));
const key=randomBytes(32),iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([cipher.update(payload),cipher.final()]);
const envelope={schema:1,key:publicEncrypt({key:publicKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};
const output=path.join(root,'runtime/paired-install.sealed.json');fs.writeFileSync(output,JSON.stringify(envelope));
console.log(JSON.stringify({file:output,bytes:fs.statSync(output).size,sha256:createHash('sha256').update(fs.readFileSync(output)).digest('hex'),sourceDigest:buildIdentity.sourceDigest,secretValuesPrinted:false}));
