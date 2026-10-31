import fs from'node:fs';import tls from'node:tls';import{X509Certificate}from'node:crypto';
const work='/root/.xiaoman-vault';const cfg=JSON.parse(fs.readFileSync(work+'/config.phone.json'));const result={at:new Date().toISOString(),deviceId:cfg.deviceId,steps:[]};
const publicCert=fs.readFileSync(work+'/phone-certificate.pem');result.phoneCertificateFingerprint=new X509Certificate(publicCert).fingerprint256;
await new Promise(resolve=>{let done=false;const s=tls.connect({host:'192.168.1.78',port:cfg.controlPort,ca:publicCert,rejectUnauthorized:true});
 const finish=value=>{if(done)return;done=true;result.steps.push(value);s.destroy();resolve();};
 s.on('connect',()=>result.steps.push({phase:'tcp-connected'}));s.on('secureConnect',()=>finish({phase:'server-certificate-verified',authorized:s.authorized}));s.on('error',e=>finish({phase:'tls-error',code:e.code}));s.setTimeout(3000,()=>finish({phase:'tls-timeout'}));
});
let serviceProcesses=[];for(const id of fs.readdirSync('/proc').filter(s=>/^\d+$/.test(s))){try{const cmd=fs.readFileSync('/proc/'+id+'/cmdline','utf8');if(cmd.includes(work+'/package/phone/serve.mjs'))serviceProcesses.push(Number(id));}catch{}}
result.serviceProcesses=serviceProcesses;
fs.writeFileSync('/sdcard/dshproject/xiaoman-vault-setup/result/tls-diagnostic.json',JSON.stringify(result,null,2));console.log(JSON.stringify({ok:true,report:'tls-diagnostic.json',privateKeyRead:false}));
