import {localPhoneBuild} from '../lib/build-identity.mjs';
try{
  const build=localPhoneBuild();
  console.log(JSON.stringify({sourceSafetyCheck:true,...build}));
}catch(e){
  console.error(JSON.stringify({sourceSafetyCheck:false,errorCode:e.code||'BUILD_CHECK_FAILED'}));
  process.exitCode=1;
}
