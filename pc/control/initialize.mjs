import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fault} from '../../lib/snapshot.mjs';
import {scratch,removeScratch,privateDirectory,protect} from '../../lib/windows-private.mjs';
export async function initialize(cfg, context){
 const {root,secret,admin,save,print}=context;
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
  const made=spawnSync(cfg.powerShell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(import.meta.dirname,'../certificates.ps1')],{input:JSON.stringify({deviceId:cfg.deviceId,subnet:cfg.phone.discoverySubnet}),encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
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
