import test from 'node:test';
import assert from 'node:assert/strict';
import {compareNativeAudits} from '../lib/native-audit.mjs';
const header='kind\tpath\ttarget\tresolved\tbytes\tsha256\towner_mode\tcontext\tparent_type\tfile_identity\n';
const row={kind:'FILE',path:'/synthetic/control.json',target:'-',resolved:'-',bytes:'66',
  sha256:'a'.repeat(64),owner_mode:'10365:10365:600',
  context:'u:object_r:app_data_file:s0',parent_type:'PLAIN',file_identity:'1:2:1'};
const report=value=>header+Object.values(value).join('\t')+'\n';
test('native source audit accepts identical independent files',()=>{
  assert.deepEqual(compareNativeAudits(report(row),report(row),{expectedCount:1}),
    {nativeSourceUnchanged:true,filesChecked:1});
});
test('native source audit rejects L2S conversion, new hardlinks and content changes',()=>{
  for(const changed of [{...row,kind:'LINK'},{...row,file_identity:'1:2:2'},
    {...row,sha256:'b'.repeat(64)},{...row,owner_mode:'0:0:600'}])
    assert.throws(()=>compareNativeAudits(report(row),report(changed),{expectedCount:1}),
      {code:'NATIVE_SOURCE_CHANGED'});
});
test('empty, partial and already aliased native baselines do not pass acceptance',()=>{
  assert.throws(()=>compareNativeAudits(header,header),{code:'NATIVE_AUDIT_INCOMPLETE'});
  assert.throws(()=>compareNativeAudits(report(row),report(row)),{code:'NATIVE_AUDIT_INCOMPLETE'});
  const aliased={...row,file_identity:'1:2:2'};
  assert.throws(()=>compareNativeAudits(report(aliased),report(aliased),{expectedCount:1}),
    {code:'NATIVE_BASELINE_NOT_INDEPENDENT'});
});
