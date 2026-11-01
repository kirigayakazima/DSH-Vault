// LAN discovery and authenticated transport; no repository access.
import net from 'node:net';
import os from 'node:os';
import {phoneRequest} from '../../lib/phone-client.mjs';
import {fault} from '../../lib/snapshot.mjs';
export async function reachable(host,p,timeout=500,localAddress){return new Promise(resolve=>{const s=net.connect({host,port:p,localAddress});let done=false;const finish=x=>{if(done)return;done=true;s.destroy();resolve(x);};s.setTimeout(timeout,()=>finish(false));s.on('connect',()=>finish(true));s.on('error',()=>finish(false));});}
export async function findHost(cfg,identity){
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
