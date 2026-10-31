// Local metadata comparison; no model tools, phone commands or source writes.
import fs from 'node:fs';
import {compareNativeAudits} from '../lib/native-audit.mjs';
try{
  if(process.argv.length!==4)throw Object.assign(new Error(),{code:'BEFORE_AND_AFTER_REPORT_REQUIRED'});
  console.log(JSON.stringify(compareNativeAudits(
    fs.readFileSync(process.argv[2],'utf8'),fs.readFileSync(process.argv[3],'utf8'))));
}catch(e){
  console.error(JSON.stringify({nativeSourceUnchanged:false,errorCode:e.code||'NATIVE_AUDIT_FAILED'}));
  process.exitCode=1;
}
