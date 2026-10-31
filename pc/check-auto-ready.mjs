// Read-only prerequisite. Never creates an acceptance record or alters status.json.
import fs from 'node:fs';
import path from 'node:path';
import {localPhoneBuild,assertSafeLastBackup} from '../lib/build-identity.mjs';
try{
  const cfg=JSON.parse(fs.readFileSync(process.argv[2]));
  const status=JSON.parse(fs.readFileSync(path.join(cfg.dataRoot,'status.json')));
  const verified=JSON.parse(fs.readFileSync(path.join(cfg.dataRoot,'verified.json')));
  assertSafeLastBackup(status,verified,localPhoneBuild().sourceDigest,cfg.deviceId);
  console.log(JSON.stringify({safeBuildBackupVerified:true,snapshotId:status.lastVerifiedSnapshot}));
}catch(e){
  console.error(JSON.stringify({safeBuildBackupVerified:false,errorCode:e.code||'SAFE_BUILD_BACKUP_REQUIRED'}));
  process.exitCode=1;
}
