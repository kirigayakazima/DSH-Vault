import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { auditContents } from '../lib/contents.mjs';

function sessionFixture(bytes){
  const base=path.resolve(import.meta.dirname,'../runtime');fs.mkdirSync(base,{recursive:true});
  const root=fs.mkdtempSync(path.join(base,'session-audit-'));
  const relative='data/dsh/sessions/synthetic/session.v4.jsonl.zstd';
  fs.mkdirSync(path.dirname(path.join(root,relative)),{recursive:true});fs.writeFileSync(path.join(root,relative),bytes);
  fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({files:[{path:relative,sqlite:false}]}));
  return root;
}
test('nonempty invalid compressed session cannot silently pass content audit',async()=>{
  await assert.rejects(auditContents(sessionFixture(Buffer.from('synthetic invalid archive'))),/RESTORED_SESSION_FORMAT_INVALID/);
});
test('multiple complete JSONL zstd frames remain readable after audit guard',async()=>{
  const bytes=Buffer.concat([zlib.zstdCompressSync('{"synthetic":1}\n'),zlib.zstdCompressSync('{"synthetic":2}\n')]);
  const result=await auditContents(sessionFixture(bytes));
  assert.equal(result.sessions.compressedFiles,1);assert.equal(result.sessions.jsonRecords,2);
});
