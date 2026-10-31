import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import https from'node:https';
import{spawnSync}from'node:child_process';import{phoneRequest}from'../lib/phone-client.mjs';import{protect}from'../lib/windows-private.mjs';
const ps='C:/Users/xuaner/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
test('DPAPI roundtrip and mutual TLS reject missing client identity',{timeout:30000},async t=>{
 const secret='synthetic-secret-not-production';const sealed=protect(secret);assert.notEqual(sealed,secret);assert.equal(protect(sealed,'unprotect'),secret);
 const result=spawnSync(ps,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('pc/certificates.ps1')],{input:JSON.stringify({deviceId:'xiaoman-synthetic-test',subnet:'192.168.1.0/24'}),encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,'certificate creation failed');const cert=JSON.parse(result.stdout);
 const server=https.createServer({key:cert.phone.privateKey,cert:cert.phone.certificate,ca:cert.pc.certificate,requestCert:true,rejectUnauthorized:true},(req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({deviceId:'xiaoman-synthetic-test'}));});
 server.on('tlsClientError',()=>{});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const port=server.address().port;
 const identity={key:cert.pc.privateKey,cert:cert.pc.certificate,ca:cert.phone.certificate};
 assert.equal((await phoneRequest('127.0.0.1',port,'/probe',identity)).value.deviceId,'xiaoman-synthetic-test');
 await assert.rejects(phoneRequest('127.0.0.1',port,'/probe',{ca:cert.phone.certificate}),/PHONE_CONNECTION_FAILED/);
 await assert.rejects(phoneRequest('127.0.0.1',port,'/probe',{...identity,ca:cert.pc.certificate}),/PHONE_CONNECTION_FAILED/);
});
