import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {localPhoneBuild,PHONE_IDENTITY_FILES,assertNoSourceLinkApis,
  assertMatchingPhoneBuild,assertSafeLastBackup} from '../lib/build-identity.mjs';
import {createSnapshot,sha256} from '../lib/snapshot.mjs';

function fixture(){
  const base=path.resolve(import.meta.dirname,'../runtime');
  fs.mkdirSync(base,{recursive:true});
  return fs.mkdtempSync(path.join(base,'source-contract-'));
}

test('source-link regression guard rejects direct, asynchronous and computed calls',()=>{
  for(const source of ['fs.linkSync(source,dest);','await fs.promises.link(source,dest);',
    'fs["linkSync"](source,dest);'])
    assert.throws(()=>assertNoSourceLinkApis(source),{code:'SOURCE_LINK_API_FORBIDDEN'});
  assert.doesNotThrow(()=>assertNoSourceLinkApis('fs.unlinkSync(part); fs.readlinkSync(source);'));
});

test('a changed phone component invalidates its previous build approval',()=>{
  const root=fixture();
  for(const file of PHONE_IDENTITY_FILES){
    fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});
    fs.writeFileSync(path.join(root,file),'export const syntheticVersion=1;\n');
  }
  const old=localPhoneBuild(root);
  fs.appendFileSync(path.join(root,'lib/snapshot.mjs'),'export const fixed=true;\n');
  assert.notEqual(localPhoneBuild(root).sourceDigest,old.sourceDigest);
  fs.appendFileSync(path.join(root,'lib/snapshot.mjs'),'fs.linkSync(source,dest);\n');
  assert.throws(()=>localPhoneBuild(root),{code:'SOURCE_LINK_API_FORBIDDEN'});
});

test('phone build identity must be present and match before backup dispatch',()=>{
  const expected='a'.repeat(64);
  for(const actual of [undefined,'','b'.repeat(64)])
    assert.throws(()=>assertMatchingPhoneBuild(actual,expected),{code:'PHONE_COMPONENT_VERSION_MISMATCH'});
  assert.doesNotThrow(()=>assertMatchingPhoneBuild(expected,expected));
});

test('old or unrelated verified snapshots cannot authorize automatic backup',()=>{
  const digest='a'.repeat(64),snapshot='b'.repeat(64),device='synthetic-phone-1',at='2026-10-31T00:00:00Z';
  const status={lastResult:'verified',deviceId:device,phoneSourceDigest:digest,
    lastVerifiedSnapshot:snapshot,lastSuccess:at};
  const verified={snapshots:[{snapshotId:snapshot,verifiedAt:at}]};
  assert.doesNotThrow(()=>assertSafeLastBackup(status,verified,digest,device));
  for(const changed of [{...status,phoneSourceDigest:undefined},
    {...status,phoneSourceDigest:'c'.repeat(64)},{...status,deviceId:'another-phone'},
    {...status,lastSuccess:'2020-01-01T00:00:00Z'},{...status,lastResult:'failed'}])
    assert.throws(()=>assertSafeLastBackup(changed,verified,digest,device),{code:'SAFE_BUILD_BACKUP_REQUIRED'});
  assert.throws(()=>assertSafeLastBackup(status,{snapshots:[]},digest,device),{code:'SAFE_BUILD_BACKUP_REQUIRED'});
});

test('backup preserves source inode, type and links when mirror entries disappear',async()=>{
  const root=fixture(),source=path.join(root,'source'),workRoot=path.join(root,'work');
  fs.mkdirSync(source);fs.mkdirSync(workRoot);
  const file=path.join(source,'synthetic-control.json');
  fs.writeFileSync(file,'{"synthetic":true}\n');
  const config={deviceId:'synthetic-source-contract',stageRoot:path.join(root,'stage'),
    workRoot,sources:[{id:'dsh',path:source}],minFreeBytes:0};
  const shape=()=>{const s=fs.lstatSync(file,{bigint:true});return{
    dev:s.dev,ino:s.ino,nlink:s.nlink,mode:s.mode,uid:s.uid,gid:s.gid,symlink:s.isSymbolicLink(),
  };};
  const before=shape(),hash=await sha256(file);
  const original={linkSync:fs.linkSync,link:fs.link,promiseLink:fs.promises.link};
  const forbidden=()=>{throw new Error('BACKUP_ATTEMPTED_TO_CREATE_A_SOURCE_LINK');};
  fs.linkSync=forbidden;fs.link=forbidden;fs.promises.link=forbidden;
  try{
    const first=await createSnapshot(config);
    await createSnapshot(config);
    const dest=path.join(first.stage,'data/dsh/synthetic-control.json');
    fs.unlinkSync(dest);
    await createSnapshot(config);
    assert.deepEqual(shape(),before);
    assert.equal(await sha256(file),hash);
    assert.equal(await sha256(dest),hash);
    assert.notEqual(fs.statSync(dest).ino,fs.statSync(file).ino);
  }finally{
    fs.linkSync=original.linkSync;fs.link=original.link;fs.promises.link=original.promiseLink;
  }
});
