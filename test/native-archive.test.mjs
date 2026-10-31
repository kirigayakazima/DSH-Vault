import test from'node:test';import assert from'node:assert/strict';import{Readable}from'node:stream';import{createHash}from'node:crypto';import{inspectNativeStream}from'../lib/native-archive.mjs';
test('native v5 verifies payload/footer without extracting any file',async()=>{
 const data=Buffer.from('synthetic-native-payload');const record=Buffer.from(JSON.stringify({root:'synthetic',path:'note',kind:'FILE',scope:'settings',size:data.length,sha256:createHash('sha256').update(data).digest('hex')}));
 const head=Buffer.alloc(12);head.write('DSHADATA');head.writeInt32BE(5,8);const n=Buffer.alloc(4);n.writeInt32BE(record.length);const size=Buffer.alloc(8);size.writeBigUInt64BE(BigInt(data.length));const end=Buffer.alloc(4);end.writeInt32BE(-1);
 const manifest=Buffer.from(JSON.stringify({formatVersion:5,entries:1,bytes:data.length,integrity:'QUIESCENT'}));const len=Buffer.alloc(4);len.writeInt32BE(manifest.length);
 const body=Buffer.concat([head,n,record,size,data,end,len,manifest]);const raw=Buffer.concat([body,createHash('sha256').update(body).digest()]);
 assert.equal((await inspectNativeStream(Readable.from([raw]))).checksumValidationPassed,true);
 const corrupt=Buffer.from(raw);corrupt[12+4+record.length+8]^=1;await assert.rejects(inspectNativeStream(Readable.from([corrupt])),/NATIVE_RECORD_HASH/);
});
