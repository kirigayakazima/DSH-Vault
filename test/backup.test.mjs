import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { createSnapshot, verifySnapshot, sha256 } from '../lib/snapshot.mjs';
import { Restic } from '../lib/restic.mjs';

const project=path.resolve(import.meta.dirname,'..');
const restic=path.join(project,'tools/restic/bin/restic_0.19.1_windows_amd64.exe');
const restServer=path.join(project,'tools/rest-server/bin/rest-server_0.14.0_windows_amd64/rest-server.exe');
const runtime=path.join(project,'runtime'); fs.mkdirSync(runtime,{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function ready(url){for(let i=0;i<100;i++){try{await fetch(url);return;}catch{await wait(50);}}throw Error('SERVER_START_FAILED');}

test('real restic: authenticated append-only upload, incremental, interruption retry, isolated restore', {timeout:120000}, async t=>{
  const root=fs.mkdtempSync(path.join(runtime,'integration-'));
  const source=path.join(root,'phone-source');fs.mkdirSync(source);
  fs.mkdirSync(path.join(source,'heart'));fs.writeFileSync(path.join(source,'heart/notebook.md'),'synthetic principle only');
  fs.writeFileSync(path.join(source,'session.jsonl'),'synthetic session, not a real conversation\n');
  fs.writeFileSync(path.join(source,'attachment.bin'),randomBytes(8*1024*1024));
  const liveDb=new DatabaseSync(path.join(source,'memory.sqlite'));
  liveDb.exec('PRAGMA journal_mode=WAL; CREATE TABLE memories (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO memories VALUES (1,\'synthetic-green\');');
  t.after(()=>liveDb.close());
  const before={file:await sha256(path.join(source,'heart/notebook.md')),db:await sha256(path.join(source,'memory.sqlite')),wal:await sha256(path.join(source,'memory.sqlite-wal'))};
  const cfg={deviceId:'xiaoman-synthetic-test',stageRoot:path.join(root,'stage'),sources:[{id:'dsh',path:source}],minFreeBytes:0};
  const first=await createSnapshot(cfg);
  const firstVerification=await verifySnapshot(first.stage,cfg.deviceId);
  assert.equal(firstVerification.sqlite,1);
  assert.ok(first.manifest.excluded.some(s=>s.reason.startsWith('sqlite-sidecar')));
  const copied=new DatabaseSync(path.join(first.stage,'data/dsh/memory.sqlite'),{readOnly:true});
  assert.equal(copied.prepare('SELECT value FROM memories WHERE id=1').get().value,'synthetic-green');copied.close();
  assert.equal(await sha256(path.join(source,'heart/notebook.md')),before.file);
  assert.equal(await sha256(path.join(source,'memory.sqlite')),before.db);
  assert.equal(await sha256(path.join(source,'memory.sqlite-wal')),before.wal);

  const authPassword=randomBytes(24).toString('hex');
  const repositoryPassword=randomBytes(32).toString('hex');
  const secretFile=path.join(root,'password');fs.writeFileSync(secretFile,repositoryPassword,{mode:0o600});
  const htpasswd=path.join(root,'htpasswd');fs.writeFileSync(htpasswd,`xiaoman:${await bcrypt.hash(authPassword,10)}\n`);
  const serverPort=await freePort();
  const server=spawn(restServer,['--listen',`127.0.0.1:${serverPort}`,'--path',path.join(root,'repositories'),'--htpasswd-file',htpasswd,'--append-only','--private-repos'],{windowsHide:true,stdio:'ignore'});
  t.after(()=>server.kill());await ready(`http://127.0.0.1:${serverPort}/xiaoman/config`);
  const noAuth=await fetch(`http://127.0.0.1:${serverPort}/xiaoman/config`);assert.equal(noAuth.status,401);

  // Fault injection proxy is loopback-only; it records byte counts, never headers or bodies.
  let failAfter=Infinity,receivedBytes=0;
  const proxy=http.createServer((req,res)=>{
    const upstream=http.request({host:'127.0.0.1',port:serverPort,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
    upstream.on('error',()=>res.destroy());req.on('error',()=>upstream.destroy());res.on('error',()=>upstream.destroy());
    req.on('data',b=>{receivedBytes+=b.length;if(receivedBytes>failAfter){req.destroy();upstream.destroy();res.destroy();}});
    req.pipe(upstream);
  });
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(()=>{proxy.closeAllConnections();proxy.close();});
  const port=proxy.address().port;
  const client=new Restic({executable:restic,repository:`rest:http://127.0.0.1:${port}/xiaoman/`,passwordFile:secretFile,
    env:{RESTIC_REST_USERNAME:'xiaoman',RESTIC_REST_PASSWORD:authPassword}});
  const admin=new Restic({executable:restic,repository:path.join(root,'repositories/xiaoman'),passwordFile:secretFile});
  await client.init();
  const a=await client.backup(first.stage,cfg.deviceId);await admin.check();
  const aRestore=await admin.restore(a.snapshotId,path.join(root,'restore-a'),cfg.deviceId);
  assert.equal(aRestore.files,first.manifest.files.length);
  const del=await fetch(`http://127.0.0.1:${serverPort}/xiaoman/snapshots/${a.snapshotId}`,{
    method:'DELETE',headers:{Authorization:'Basic '+Buffer.from('xiaoman:'+authPassword).toString('base64')}});
  assert.equal(del.status,403);

  fs.appendFileSync(path.join(source,'session.jsonl'),'another synthetic event\n');
  liveDb.exec('UPDATE memories SET value=\'synthetic-updated\' WHERE id=1');
  const second=await createSnapshot(cfg);
  const b=await client.backup(second.stage,cfg.deviceId);
  assert.ok(b.dataAdded<a.dataAdded/4,JSON.stringify({first:a.dataAdded,second:b.dataAdded}));
  const bRestore=await admin.restore(b.snapshotId,path.join(root,'restore-b'),cfg.deviceId);
  assert.equal(bRestore.sqlite,1);

  fs.writeFileSync(path.join(source,'new-attachment.bin'),randomBytes(12*1024*1024));
  const third=await createSnapshot(cfg);
  const beforeInterrupt=(await admin.list(cfg.deviceId)).map(s=>s.id);
  receivedBytes=0;failAfter=1024*1024;
  await assert.rejects(client.backup(third.stage,cfg.deviceId,{timeoutMs:4000}));
  assert.ok(receivedBytes>failAfter,'transfer must actually have started before interruption');
  failAfter=Infinity;await wait(200);
  const afterInterrupt=(await admin.list(cfg.deviceId)).map(s=>s.id);
  assert.deepEqual(afterInterrupt,beforeInterrupt);
  await admin.restore(b.snapshotId,path.join(root,'restore-after-interruption'),cfg.deviceId);
  // The killed fixture client can leave a lock. Default unlock removes only stale locks.
  await admin.call(['unlock']);
  const c=await client.backup(third.stage,cfg.deviceId);await admin.check();
  await admin.restore(c.snapshotId,path.join(root,'restore-c'),cfg.deviceId);
  const snapshots=await admin.list(cfg.deviceId);
  await assert.rejects(admin.verifiedRetention([a.snapshotId],cfg.deviceId),/UNVERIFIED_SNAPSHOT/);
  const dryRetention=await admin.verifiedRetention(snapshots.map(s=>s.id),cfg.deviceId);
  assert.ok(Array.isArray(dryRetention));
  const evidence={scope:'Synthetic local Windows fixture only; not Android/proot or real home-network acceptance',
    restic:'0.19.1',restServer:'0.14.0',first:a,incremental:b,retry:c,sourceUnchangedDuringInitialSnapshot:true,
    sqliteWalIncluded:true,unauthenticatedStatus:noAuth.status,appendOnlyDeleteStatus:del.status,
    interruptedTransferBytes:receivedBytes,previousVerifiedSnapshotSurvived:true,isolatedRestorePassed:true,
    finalSnapshotCount:snapshots.length,runtimeRoot:root};
  fs.writeFileSync(path.join(runtime,'synthetic-evidence.json'),JSON.stringify(evidence,null,2));
});

test('snapshot refuses overlap, unaccounted symlinks and unknown database format',async()=>{
  const root=fs.mkdtempSync(path.join(runtime,'guards-'));const source=path.join(root,'source');fs.mkdirSync(source);
  const cfg={deviceId:'xiaoman-synthetic-test',stageRoot:path.join(root,'stage'),sources:[{id:'dsh',path:source}],minFreeBytes:0};
  await assert.rejects(createSnapshot({...cfg,stageRoot:path.join(source,'stage')}),/STAGE_SOURCE_OVERLAP/);
  const elsewhere=path.join(root,'elsewhere');fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere,path.join(source,'external'),'junction');
  await assert.rejects(createSnapshot(cfg),/UNCOVERED_SYMLINK/);
  fs.unlinkSync(path.join(source,'external'));
  fs.writeFileSync(path.join(source,'unknown.sqlite'),'not a recognized SQLite database');
  await assert.rejects(createSnapshot(cfg),/UNRECOGNIZED_DATABASE_FORMAT/);
});

test('restore verifier detects altered data and rejects path escape',async()=>{
  const root=fs.mkdtempSync(path.join(runtime,'integrity-'));const source=path.join(root,'source');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'note'),'synthetic');
  const cfg={deviceId:'xiaoman-synthetic-test',stageRoot:path.join(root,'stage'),sources:[{id:'dsh',path:source}],minFreeBytes:0};
  const snap=await createSnapshot(cfg);fs.writeFileSync(path.join(snap.stage,'data/dsh/note'),'tampered');
  await assert.rejects(verifySnapshot(snap.stage,cfg.deviceId),/RESTORE_HASH_MISMATCH/);
  snap.manifest.files[0].path='../escape';fs.writeFileSync(path.join(snap.stage,'manifest.json'),JSON.stringify(snap.manifest));
  await assert.rejects(verifySnapshot(snap.stage,cfg.deviceId),/INVALID_MANIFEST_PATH/);
});

test('ctime-only reopen requires matching independent bytes; changing bytes never pass',async t=>{
 const root=fs.mkdtempSync(path.join(runtime,'ctime-'));const source=path.join(root,'source');fs.mkdirSync(source);const file=path.join(source,'attachment');fs.writeFileSync(file,'one');
 const cfg={deviceId:'xiaoman-synthetic-test',stageRoot:path.join(root,'stage'),sources:[{id:'dsh',path:source}],minFreeBytes:0};
 const fixed=fs.statSync(file,{bigint:true});const originalFstat=fs.fstatSync;let calls=0;
 const mocked=t.mock.method(fs,'fstatSync',(fd,options)=>{const actual=originalFstat(fd,options);if(!options?.bigint)return actual;const index=calls++;const ctime=fixed.ctimeNs+BigInt(Math.floor(index/4)*2+(index%4>=2?1:0));return new Proxy(actual,{get:(obj,k)=>k==='ctimeNs'?ctime:['ino','dev','size','mtimeNs'].includes(k)?fixed[k]:Reflect.get(obj,k)});});
 const accepted=await createSnapshot(cfg);assert.equal(fs.readFileSync(path.join(accepted.stage,'data/dsh/attachment'),'utf8'),'one');
 calls=0;let opens=0;const originalOpen=fs.openSync;
 const opened=t.mock.method(fs,'openSync',(name,flags,...args)=>{if(name===file&&typeof flags==='number'){if(opens++%2===1)fs.writeFileSync(file,opens%4===2?'two':'one');}return originalOpen(name,flags,...args);});
 await assert.rejects(createSnapshot(cfg),e=>e.code==='SOURCE_CHANGING'&&e.details.sourceId==='dsh');
 opened.mock.restore();mocked.mock.restore();
});

test('incremental snapshot reuses independent unchanged files and hashes via workRoot manifest cache', async () => {
  const root = fs.mkdtempSync(path.join(runtime, 'hardlink-'));
  const source = path.join(root, 'source'); fs.mkdirSync(source);
  const workRoot = path.join(root, 'work'); fs.mkdirSync(workRoot);
  fs.writeFileSync(path.join(source, 'static.bin'), 'static-data-unchanged');
  fs.writeFileSync(path.join(source, 'dynamic.txt'), 'version-1');
  const cfg = { deviceId: 'xiaoman-synthetic-test', stageRoot: path.join(root, 'stage'), sources: [{ id: 'dsh', path: source }], workRoot, minFreeBytes: 0 };
  
  const snap1 = await createSnapshot(cfg);
  assert.ok(fs.existsSync(path.join(workRoot, 'last-manifest.json')));
  const verify1 = await verifySnapshot(snap1.stage, cfg.deviceId);
  assert.equal(verify1.files, 2);

  await new Promise(r => setTimeout(r, 50));
  fs.writeFileSync(path.join(source, 'dynamic.txt'), 'version-2-changed');

  const snap2 = await createSnapshot(cfg);
  const verify2 = await verifySnapshot(snap2.stage, cfg.deviceId);
  assert.equal(verify2.files, 2);

  const staticFile1 = snap1.manifest.files.find(f => f.path === 'data/dsh/static.bin');
  const staticFile2 = snap2.manifest.files.find(f => f.path === 'data/dsh/static.bin');
  assert.equal(staticFile2.sha256, staticFile1.sha256);
  assert.equal(fs.readFileSync(path.join(snap2.stage, 'data/dsh/static.bin'), 'utf8'), 'static-data-unchanged');
  assert.equal(fs.readFileSync(path.join(snap2.stage, 'data/dsh/dynamic.txt'), 'utf8'), 'version-2-changed');
  const dynFile = snap2.manifest.files.find(f => f.path === 'data/dsh/dynamic.txt');
  assert.equal(dynFile.sha256, await sha256(path.join(source, 'dynamic.txt')));
});
