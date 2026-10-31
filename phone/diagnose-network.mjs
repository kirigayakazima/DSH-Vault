import fs from'node:fs';import os from'node:os';import net from'node:net';import dgram from'node:dgram';
const result={at:new Date().toISOString(),interfaces:null,interfacesError:null,tcp:[],udpRoute:null};
try{result.interfaces=os.networkInterfaces();}catch(e){result.interfacesError=e.code||'NETWORK_INTERFACE_ERROR';}
await new Promise(resolve=>{const s=dgram.createSocket('udp4');s.on('error',e=>{result.udpRoute={error:e.code};s.close();resolve();});s.connect(9,'192.168.1.1',()=>{result.udpRoute=s.address();s.close();resolve();});});
for(const host of ['127.0.0.1','192.168.1.78'])await new Promise(resolve=>{const s=net.connect({host,port:22224});let done=false;const finish=value=>{if(done)return;done=true;result.tcp.push({host,...value});s.destroy();resolve();};s.on('connect',()=>finish({connected:true}));s.on('error',e=>finish({connected:false,error:e.code}));s.setTimeout(1000,()=>finish({connected:false,error:'TIMEOUT'}));});
try{result.procTcp=fs.readFileSync('/proc/net/tcp','utf8').split('\n').filter(line=>line.includes(':56D0'));}catch(e){result.procError=e.code;}
fs.writeFileSync('/sdcard/dshproject/xiaoman-vault-setup/result/network-diagnostic.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({ok:true,report:'network-diagnostic.json',memoryDataRead:false}));
