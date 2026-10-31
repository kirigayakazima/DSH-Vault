// Read-only framing/checksum inspection of DSHA v5, based on BackupArchive.java.
// Never extracts native entries or treats checksum validation as an Android restore test.
import{createHash,timingSafeEqual}from'node:crypto';import{fault}from'./snapshot.mjs';
export async function inspectNativeStream(stream){
 const iterator=stream[Symbol.asyncIterator]();let pending=Buffer.alloc(0);const all=createHash('sha256');
 async function read(n,hashed=true){
  while(pending.length<n){const next=await iterator.next();if(next.done)throw fault('NATIVE_ARCHIVE_TRUNCATED');pending=Buffer.concat([pending,next.value]);}
  const out=pending.subarray(0,n);pending=pending.subarray(n);if(hashed)all.update(out);return out;
 }
 const head=await read(12);if(head.subarray(0,8).toString()!=='DSHADATA'||head.readUInt32BE(8)!==5)throw fault('NATIVE_ENCRYPTED_OR_UNSUPPORTED');
 let entries=0,bytes=0,metadataBytes=0;const scopes={},kinds={};
 while(true){
  const n=(await read(4)).readInt32BE();if(n===-1)break;
  if(n<2||n>1024*1024||(metadataBytes+=n)>128*1024*1024||++entries>200000)throw fault('NATIVE_METADATA_LIMIT');
  let record;try{record=JSON.parse((await read(n)).toString('utf8'));}catch{throw fault('NATIVE_METADATA_INVALID');}
  const size=(await read(8)).readBigUInt64BE();
  if(size>64n*1024n*1024n*1024n||Number(size)!==record.size)throw fault('NATIVE_RECORD_SIZE');
  const fileHash=createHash('sha256');let remaining=Number(size);bytes+=remaining;
  while(remaining){const chunk=await read(Math.min(remaining,65536));fileHash.update(chunk);remaining-=chunk.length;}
  if(record.kind==='FILE'&&fileHash.digest('hex')!==record.sha256)throw fault('NATIVE_RECORD_HASH');
  scopes[record.scope]=(scopes[record.scope]||0)+1;kinds[record.kind]=(kinds[record.kind]||0)+1;
 }
 const n=(await read(4)).readInt32BE();if(n<2||n>16*1024*1024)throw fault('NATIVE_MANIFEST_LIMIT');
 const manifest=JSON.parse((await read(n)).toString('utf8'));
 if(manifest.formatVersion!==5||manifest.entries!==entries||manifest.bytes!==bytes)throw fault('NATIVE_MANIFEST_MISMATCH');
 const expected=await read(32,false);if(!timingSafeEqual(all.digest(),expected))throw fault('NATIVE_FOOTER_HASH');
 if(pending.length||(await iterator.next()).done!==true)throw fault('NATIVE_TRAILING_DATA');
 return{formatVersion:5,entries,bytes,scopes,kinds,createdAt:manifest.createdAt,appVersion:manifest.appVersion,integrity:manifest.integrity,sensitivePolicy:manifest.sensitivePolicy,
  checksumValidationPassed:true,androidRestoreTestPerformed:false};
}
