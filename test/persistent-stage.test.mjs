import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSnapshot, sha256, verifySnapshot } from '../lib/snapshot.mjs';

function fixture(){
  const base=path.resolve(import.meta.dirname,'../runtime');fs.mkdirSync(base,{recursive:true});
  const root=fs.mkdtempSync(path.join(base,'stage-safety-'));
  const source=path.join(root,'source'),workRoot=path.join(root,'work');fs.mkdirSync(source);fs.mkdirSync(workRoot);
  return {source,cfg:{deviceId:'xiaoman-stage-safety',stageRoot:path.join(root,'stage'),workRoot,sources:[{id:'dsh',path:source}],minFreeBytes:0}};
}
const sameInode=(a,b)=>{const x=fs.statSync(a,{bigint:true}),y=fs.statSync(b,{bigint:true});return x.ino===y.ino&&x.dev===y.dev;};

test('missing mirror is recopied independently; later updates never truncate the source',async()=>{
  const {source,cfg}=fixture();const file=path.join(source,'note.txt');fs.writeFileSync(file,'synthetic version one');
  const first=await createSnapshot(cfg);const dest=path.join(first.stage,'data/dsh/note.txt');
  fs.unlinkSync(dest);await createSnapshot(cfg);
  assert.equal(sameInode(file,dest),false);
  fs.writeFileSync(file,'synthetic changed version two with different size');const expected=await sha256(file);
  const next=await createSnapshot(cfg);
  assert.equal(await sha256(file),expected);assert.equal(await sha256(dest),expected);
  await verifySnapshot(next.stage,cfg.deviceId);
});

test('legacy source-to-stage hardlinks are detached before any overwrite',async()=>{
  const {source,cfg}=fixture();const file=path.join(source,'note.txt');fs.writeFileSync(file,'synthetic original');
  const first=await createSnapshot(cfg);const dest=path.join(first.stage,'data/dsh/note.txt');
  fs.unlinkSync(dest);fs.linkSync(file,dest);assert.equal(sameInode(file,dest),true);
  fs.writeFileSync(file,'synthetic legitimate edit');const expected=await sha256(file);
  const next=await createSnapshot(cfg);
  assert.equal(await sha256(file),expected);assert.equal(await sha256(dest),expected);assert.equal(sameInode(file,dest),false);
  await verifySnapshot(next.stage,cfg.deviceId);
});

test('same-size source edits with restored mtime invalidate the cached hash',async()=>{
  const {source,cfg}=fixture();const file=path.join(source,'note.txt');fs.writeFileSync(file,'version-A');
  await createSnapshot(cfg);const before=fs.statSync(file);
  await new Promise(r=>setTimeout(r,30));fs.writeFileSync(file,'version-B');fs.utimesSync(file,before.atime,before.mtime);
  const next=await createSnapshot(cfg);
  assert.equal(fs.readFileSync(path.join(next.stage,'data/dsh/note.txt'),'utf8'),'version-B');
  await verifySnapshot(next.stage,cfg.deviceId);
});

test('SQLite stage aliases and redirected sync-stage directories cannot overwrite sources',async()=>{
  const {source,cfg}=fixture();const file=path.join(source,'memory.sqlite');
  let db=new DatabaseSync(file);db.exec('CREATE TABLE test (v TEXT); INSERT INTO test VALUES (\'synthetic-one\')');db.close();
  const first=await createSnapshot(cfg);const dest=path.join(first.stage,'data/dsh/memory.sqlite');
  fs.unlinkSync(dest);fs.linkSync(file,dest);const expected=await sha256(file);
  await createSnapshot(cfg);assert.equal(await sha256(file),expected);assert.equal(sameInode(file,dest),false);
  const other=fixture();fs.writeFileSync(path.join(other.source,'note.txt'),'protected');fs.mkdirSync(other.cfg.stageRoot);
  fs.symlinkSync(other.source,path.join(other.cfg.stageRoot,'sync-stage'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(createSnapshot(other.cfg),/STAGE_SOURCE_OVERLAP/);
  assert.deepEqual(fs.readdirSync(other.source),['note.txt']);
});
