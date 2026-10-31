import fs from'node:fs';import path from'node:path';import{spawn}from'node:child_process';
export const name='xiaoman-vault';
export function apply(ctx){
 const work='/root/.xiaoman-vault';const stateFile=path.join(work,'service-state.json');
 ctx.effect(()=>{
  let child,timer,stopped=false,retries=0;
  const state=value=>{try{fs.writeFileSync(stateFile,JSON.stringify({at:new Date().toISOString(),...value}));}catch{}};
  const start=()=>{
   if(stopped)return;
   child=spawn(process.execPath,[path.join(import.meta.dirname,'serve.mjs'),path.join(work,'config.phone.json')],{stdio:'ignore'});
   state({state:'starting',pid:child.pid});
   let closed=false;const restart=code=>{if(closed)return;closed=true;state({state:'exited',code});if(!stopped)timer=setTimeout(start,Math.min(300000,10000*2**Math.min(retries++,5)));};
   child.on('error',()=>restart('SPAWN_FAILED'));child.on('close',code=>restart(code));
  };
  start();return()=>{stopped=true;clearTimeout(timer);child?.kill('SIGTERM');state({state:'stopped'});};
 });
}
