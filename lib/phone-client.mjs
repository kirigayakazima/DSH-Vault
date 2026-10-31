import https from'node:https';import{fault}from'./snapshot.mjs';
export function phoneRequest(host,port,route,identity,{body,timeoutMs=5000,localAddress}={}){
 return new Promise((resolve,reject)=>{
  const req=https.request({host,port,localAddress,path:route,method:body?'POST':'GET',key:identity.key,cert:identity.cert,ca:identity.ca,
    rejectUnauthorized:true,headers:body?{'Content-Type':'application/json'}:{},agent:false},res=>{
    let text='';res.on('data',b=>{text+=b;if(text.length>65536){res.destroy();reject(fault('PHONE_RESPONSE_TOO_LARGE'));}});
    res.on('end',()=>{try{const value=JSON.parse(text);if(res.statusCode!==200)reject(fault(typeof value.errorCode==='string'&&/^[A-Z0-9_]+$/.test(value.errorCode)?'PHONE_'+value.errorCode:'PHONE_REJECTED'));else resolve({value,localAddress:req.socket.localAddress});}catch{reject(fault('PHONE_RESPONSE_INVALID'));}});
    res.on('error',()=>reject(fault('PHONE_CONNECTION_FAILED')));
  });
  const timer=setTimeout(()=>req.destroy(fault('PHONE_TIMEOUT')),timeoutMs);req.on('close',()=>clearTimeout(timer));
  req.on('error',()=>reject(fault('PHONE_CONNECTION_FAILED')));
  if(body)req.write(JSON.stringify(body));req.end();
 });
}
