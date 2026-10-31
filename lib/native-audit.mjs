const fields=['kind','path','target','resolved','bytes','sha256','owner_mode','context','parent_type','file_identity'];
const fault=code=>Object.assign(new Error(code),{code});
function parse(text,expectedCount){
  const rows=text.trimEnd().split(/\r?\n/);
  if(rows.shift()!==fields.join('\t'))throw fault('NATIVE_AUDIT_FORMAT');
  const entries=new Map();
  for(const row of rows){
    const values=row.split('\t');
    if(values.length!==fields.length||values.some(v=>v===''))throw fault('NATIVE_AUDIT_FORMAT');
    const item=Object.fromEntries(fields.map((key,i)=>[key,values[i]]));
    if(entries.has(item.path))throw fault('NATIVE_AUDIT_DUPLICATE');
    entries.set(item.path,item);
  }
  if(entries.size!==expectedCount)throw fault('NATIVE_AUDIT_INCOMPLETE');
  return entries;
}
export function compareNativeAudits(beforeText,afterText,{expectedCount=74}={}){
  const before=parse(beforeText,expectedCount),after=parse(afterText,expectedCount);
  for(const [file,old] of before){
    if(old.kind!=='FILE'||old.parent_type!=='PLAIN'||
       !/^[a-f0-9]{64}$/.test(old.sha256)||!/^\d+:\d+:1$/.test(old.file_identity))
      throw fault('NATIVE_BASELINE_NOT_INDEPENDENT');
    const current=after.get(file);
    if(!current||fields.some(key=>current[key]!==old[key]))throw fault('NATIVE_SOURCE_CHANGED');
  }
  return {nativeSourceUnchanged:true,filesChecked:expectedCount};
}
