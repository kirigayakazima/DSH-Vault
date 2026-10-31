import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Keep this order identical to phone/serve.mjs. These bytes identify the running service.
export const PHONE_IDENTITY_FILES=Object.freeze([
  'phone/serve.mjs','phone/job.mjs','lib/snapshot.mjs','lib/restic.mjs',
]);
const fault=code=>Object.assign(new Error(code),{code});

export function assertNoSourceLinkApis(source){
  // A narrow regression guard, not a JavaScript sandbox. Aliases, shell helpers and
  // dynamic code still require review; behavioral source-shape tests also run.
  const direct=/\b(?:linkSync|link)\s*\(/;
  const computed=/\[\s*['"](?:linkSync|link)['"]\s*\]\s*\(/;
  if(direct.test(source)||computed.test(source))throw fault('SOURCE_LINK_API_FORBIDDEN');
}

export function localPhoneBuild(project=path.resolve(import.meta.dirname,'..')){
  const combined=createHash('sha256');
  const files=PHONE_IDENTITY_FILES.map(relative=>{
    const bytes=fs.readFileSync(path.join(project,relative));
    assertNoSourceLinkApis(bytes.toString('utf8'));
    combined.update(bytes);
    return {path:relative,sha256:createHash('sha256').update(bytes).digest('hex')};
  });
  return {sourceDigest:combined.digest('hex'),files};
}

export function assertMatchingPhoneBuild(actual,expected){
  if(!/^[a-f0-9]{64}$/.test(expected||'')||actual!==expected)
    throw fault('PHONE_COMPONENT_VERSION_MISMATCH');
}

export function assertSafeLastBackup(status,verified,expectedDigest,deviceId){
  if(status?.lastResult!=='verified'||status.deviceId!==deviceId||
     status.phoneSourceDigest!==expectedDigest||
     !/^[a-f0-9]{64}$/.test(status.lastVerifiedSnapshot||'')||
     !verified?.snapshots?.some(s=>s.snapshotId===status.lastVerifiedSnapshot&&
       s.verifiedAt===status.lastSuccess))
    throw fault('SAFE_BUILD_BACKUP_REQUIRED');
}
