import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';

export const fault = code => Object.assign(new Error(code), { code });
export const within = (root, file) => {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};
export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function sqliteFile(file) {
  const fd = fs.openSync(file, 'r');
  try { const buf = Buffer.alloc(16); fs.readSync(fd, buf, 0, 16, 0); return buf.toString() === 'SQLite format 3\0'; }
  finally { fs.closeSync(fd); }
}
const same = (a,b) => a.ino === b.ino && a.dev === b.dev && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const sourceStamp = stat => Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs'].map(key=>[key,String(stat[key])]));
const sameStamp = (a,b) => a && b && ['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
async function stableCopy(source, target) {
  let difference;
  for (let attempt = 0; attempt < 3; attempt++) {
    let input, output;
    const part=path.join(path.dirname(target),'.vault-part-'+randomUUID());
    let accepted;
    try {
      input = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const before = fs.fstatSync(input, { bigint: true });
      if (!before.isFile()) throw fault('SOURCE_NOT_REGULAR');
      // Never write through an existing stage inode: older stages may be linked to a source.
      output = fs.openSync(part, 'wx', 0o600);
      const buffer = Buffer.alloc(1024*1024);
      const copyHash=createHash('sha256');
      let n;
      while ((n = fs.readSync(input, buffer)) > 0) {const chunk=buffer.subarray(0,n);copyHash.update(chunk);fs.writeFileSync(output, chunk);}
      fs.fsyncSync(output);
      const copyDigest=copyHash.digest('hex');
      const after = fs.fstatSync(input, { bigint: true });
      // proot can expose different metadata through statx(path) and fstat(fd).
      // Reopen without following a symlink and compare the same fstat API on both handles.
      const check=fs.openSync(source,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      let current;try{
        current=fs.fstatSync(check,{bigint:true});
        if (same(before, after) && same(after, current)) accepted=current;
        const contentFields=['dev','ino','size','mtimeNs'];
        if(!accepted&&same(before,after)&&contentFields.every(k=>after[k]===current[k])){
          // Some live attachment stores refresh ctime on open. Accept only after an
          // independent full content re-read matches and that second read is stable too.
          const freshHash=createHash('sha256');let size;
          while((size=fs.readSync(check,buffer))>0)freshHash.update(buffer.subarray(0,size));
          const verified=fs.fstatSync(check,{bigint:true});
          if(same(current,verified)&&freshHash.digest('hex')===copyDigest)accepted=verified;
        }
      }finally{fs.closeSync(check);}
      if(accepted){
        fs.closeSync(output);output=undefined;
        fs.renameSync(part,target);
        return {sha256:copyDigest,sourceStamp:sourceStamp(accepted)};
      }
      const fields=['dev','ino','size','mtimeNs','ctimeNs'];
      difference={duringCopy:fields.filter(k=>before[k]!==after[k]),onReopen:fields.filter(k=>after[k]!==current[k]),
        before:Object.fromEntries(fields.map(k=>[k,String(before[k])])),after:Object.fromEntries(fields.map(k=>[k,String(after[k])])),reopened:Object.fromEntries(fields.map(k=>[k,String(current[k])]))};
    } finally {
      if (input !== undefined) fs.closeSync(input);
      if (output !== undefined) fs.closeSync(output);
      try{fs.unlinkSync(part);}catch(e){if(e.code!=='ENOENT')throw e;}
    }
  }
  throw Object.assign(fault('SOURCE_CHANGING'),{details:difference});
}
export function sqliteIntegrity(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare('PRAGMA integrity_check').all();
    if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok') throw fault('SQLITE_INTEGRITY_FAILED');
  } finally { db.close(); }
}
export function removeOwnedSnapshot(stageRoot,directory) {
  const root=fs.realpathSync(stageRoot),target=fs.realpathSync(directory);
  if(!within(root,target)||fs.lstatSync(directory).isSymbolicLink()||!path.basename(target).startsWith('snapshot-'))throw fault('SNAPSHOT_CLEANUP_REFUSED');
  const marker=fs.readFileSync(path.join(target,'.xiaoman-snapshot'),'utf8');
  if(!/^[0-9a-f-]{36}$/.test(marker))throw fault('SNAPSHOT_CLEANUP_REFUSED');
  // A resolved absolute target, strictly below the dedicated stage root and bearing our marker.
  fs.rmSync(target,{recursive:true});
}
export async function createSnapshot(config) {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(config.deviceId || '')) throw fault('DEVICE_ID_REQUIRED');
  if (!path.isAbsolute(config.stageRoot || '') || !config.sources?.length) throw fault('SOURCES_REQUIRED');
  // The source list must come from the actual phone inventory, never from PC Heart defaults.
  const sources = config.sources.map(s => {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(s.id || '') || !path.isAbsolute(s.path || '')) throw fault('INVALID_SOURCE');
    return { ...s, actual: fs.realpathSync(s.path) };
  });
  if (new Set(sources.map(s=>s.id)).size !== sources.length) throw fault('DUPLICATE_SOURCE_ID');
  fs.mkdirSync(config.stageRoot, { recursive:true, mode:0o700 });
  const stageRoot = fs.realpathSync(config.stageRoot);
  for (const s of sources) if (s.actual === stageRoot || within(s.actual,stageRoot) || within(stageRoot,s.actual)) throw fault('STAGE_SOURCE_OVERLAP');
  const available = fs.statfsSync(stageRoot);
  if (available.bavail * available.bsize < (config.minFreeBytes ?? 512*1024*1024)) throw fault('STAGE_SPACE_LOW');
  const stage = config.workRoot ? path.join(stageRoot, 'sync-stage') : fs.mkdtempSync(path.join(stageRoot, 'snapshot-'));
  fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
  const actualStage=fs.realpathSync(stage);
  if(fs.lstatSync(stage).isSymbolicLink()||!within(stageRoot,actualStage))throw fault('STAGE_SOURCE_OVERLAP');
  for(const s of sources)if(s.actual===actualStage||within(s.actual,actualStage)||within(actualStage,s.actual))throw fault('STAGE_SOURCE_OVERLAP');
  const stagedFiles = new Set();
  const manifest = { schema:1, deviceId:config.deviceId, generation:randomUUID(), startedAt:new Date().toISOString(),
    consistency:'stable-copy-per-file; SQLite online backup per database; no global cross-plugin transaction',
    roots:sources.map(s=>({id:s.id,source:s.path,actual:s.actual})), files:[], excluded:[], symlinks:[] };
  const cacheFile = config.workRoot ? path.join(config.workRoot, 'last-manifest.json') : null;
  const cache = new Map();
  try {
    if (cacheFile && fs.existsSync(cacheFile)) {
      const prev = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (prev.schema === 1 && prev.deviceId === config.deviceId && Array.isArray(prev.files)) {
        for (const item of prev.files) {
          if (!item.sqlite && typeof item.path === 'string' && item.sha256) {
            cache.set(item.path, item);
          }
        }
      }
    }
  } catch {}
  const start = performance.now();
  fs.writeFileSync(path.join(stage,'.xiaoman-snapshot'),manifest.generation,{mode:0o600});
  async function walk(source, dest, root, relative='') {
    if (root.exclude?.some(pattern=>path.matchesGlob(relative.replaceAll('\\','/'),pattern))) {
      manifest.excluded.push({root:root.id,path:relative,reason:'explicit-policy'}); return;
    }
    let stat;
    try { stat = fs.lstatSync(source); } catch(e) {
      if (e.code === 'ENOENT' && relative !== '') { manifest.excluded.push({root:root.id,path:relative,reason:'disappeared-during-snapshot'}); return; }
      throw e;
    }
    if (stat.isSymbolicLink()) {
      // Preserve the link as metadata; fail unless its contents are explicitly covered or excluded.
      let target;
      try { target = fs.realpathSync(source); } catch(e) {
        if (e.code === 'ENOENT') { manifest.excluded.push({root:root.id,path:relative,reason:'dangling-symlink',link:fs.readlinkSync(source)}); return; }
        throw e;
      }
      const covered = sources.some(s=>target === s.actual || within(s.actual,target));
      if (!covered) throw fault('UNCOVERED_SYMLINK');
      manifest.symlinks.push({root:root.id,path:relative,target:fs.readlinkSync(source),actual:target}); return;
    }
    if (stat.isDirectory()) {
      fs.mkdirSync(dest, {recursive:true,mode:0o700});
      for (const name of fs.readdirSync(source).sort()) await walk(path.join(source,name),path.join(dest,name),root,path.join(relative,name));
      return;
    }
    if (!stat.isFile()) throw fault('UNSUPPORTED_FILE_TYPE');
    if (/-wal$|-shm$|-journal$/.test(source)) {
      const base=source.replace(/-(wal|shm|journal)$/,'');
      if (fs.existsSync(base) && sqliteFile(base)) { manifest.excluded.push({root:root.id,path:relative,reason:'sqlite-sidecar-included-via-online-backup'}); return; }
    }
    fs.mkdirSync(path.dirname(dest), {recursive:true,mode:0o700});
    const relPath = path.relative(stage, dest).replaceAll('\\', '/');
    const cached = cache.get(relPath);
    const stamp=sourceStamp(fs.lstatSync(source,{bigint:true}));
    let fileHash,acceptedStamp,reused=false;
    if(cached&&!cached.sqlite&&sameStamp(cached.sourceStamp,stamp)){
      try{
        const destStat=fs.lstatSync(dest);
        if(destStat.isFile()&&!destStat.isSymbolicLink()&&destStat.nlink===1&&destStat.size===cached.bytes&&!(destStat.dev===stat.dev&&destStat.ino===stat.ino)){
          reused=true;fileHash=cached.sha256;acceptedStamp=cached.sourceStamp;
        }
      }catch(e){if(e.code!=='ENOENT')throw e;}
    }
    const sql = reused ? false : sqliteFile(source);
    if (sql) {
      const part=path.join(path.dirname(dest),'.vault-part-'+randomUUID());
      try{
        const db = new DatabaseSync(source, {readOnly:true});
        try { await backup(db,part); } finally { db.close(); }
        // Normalize only our independent copy; never open an existing stage DB for writing.
        const stagedDb=new DatabaseSync(part);
        try { stagedDb.exec('PRAGMA journal_mode=DELETE'); } finally { stagedDb.close(); }
        sqliteIntegrity(part);
        fileHash = await sha256(part);
        fs.renameSync(part,dest);
      }finally{for(const file of [part,part+'-wal',part+'-shm',part+'-journal'])try{fs.unlinkSync(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
    } else if(!reused) {
      if (/\.(?:sqlite3?|db)$/i.test(source)) throw fault('UNRECOGNIZED_DATABASE_FORMAT');
      try{const copied=await stableCopy(source,dest);fileHash=copied.sha256;acceptedStamp=copied.sourceStamp;try{fs.utimesSync(dest,stat.atime,stat.mtime);}catch{}}
      catch(e){if(e.code==='ENOENT'){manifest.excluded.push({root:root.id,path:relative,reason:'disappeared-during-copy'});return;}e.details={sourceId:root.id,relativePath:relative,...e.details};throw e;}
    }
    stagedFiles.add(dest);
    manifest.files.push({path:path.relative(stage,dest).replaceAll('\\','/'),bytes:fs.statSync(dest).size,
      sha256:fileHash,sqlite:sql,sourceStamp:acceptedStamp,mode:stat.mode,mtime:stat.mtime.toISOString(),uid:stat.uid,gid:stat.gid});
  }
  try {
    for (const root of sources) await walk(root.actual,path.join(stage,'data',root.id),root);
    if (config.workRoot) {
      function prune(dir) {
        if (!fs.existsSync(dir)) return;
        for (const name of fs.readdirSync(dir)) {
          const full = path.join(dir, name);
          try {
            const st = fs.lstatSync(full);
            if (st.isDirectory()) {
              prune(full);
              try { if (fs.readdirSync(full).length === 0) fs.rmdirSync(full); } catch {}
            } else if (!stagedFiles.has(full)) {
              fs.unlinkSync(full);
            }
          } catch {}
        }
      }
      prune(path.join(stage, 'data'));
    }
    manifest.finishedAt=new Date().toISOString();
    manifest.bytes=manifest.files.reduce((n,f)=>n+f.bytes,0);
    manifest.durationMs=Math.round(performance.now()-start);
    fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
    fs.writeFileSync(path.join(stage,'.xiaoman-snapshot'),manifest.generation,{mode:0o600});
    if (cacheFile) {
      try {
        const tmp = cacheFile + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(manifest), { mode: 0o600 });
        fs.renameSync(tmp, cacheFile);
      } catch {}
    }
    return {stage,manifest};
  } catch (e) {
    // Failed scratch is disposable: avoid filling the phone on repeated connection failures.
    try{removeOwnedSnapshot(stageRoot,stage);}catch{}
    throw Object.assign(fault(e.code && /^[A-Z_]+$/.test(e.code) ? e.code : 'SNAPSHOT_FAILED'),{details:e.details||(e.path?{path:e.path}:undefined)});
  }
}
export async function verifySnapshot(directory, expectedDeviceId) {
  const root=fs.realpathSync(directory);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  if (manifest.schema!==1 || manifest.deviceId!==expectedDeviceId || !Array.isArray(manifest.files)) throw fault('MANIFEST_IDENTITY_MISMATCH');
  if (fs.readFileSync(path.join(root,'.xiaoman-snapshot'),'utf8')!==manifest.generation) throw fault('MANIFEST_MARKER_MISMATCH');
  for (const item of manifest.files) {
    if (typeof item.path!=='string' || !item.path.startsWith('data/') || item.path.includes('\\')) throw fault('INVALID_MANIFEST_PATH');
    const file=path.resolve(root,item.path);
    if (!within(root,file) || !within(root,fs.realpathSync(file))) throw fault('RESTORE_PATH_ESCAPE');
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size!==item.bytes || await sha256(file)!==item.sha256) throw fault('RESTORE_HASH_MISMATCH');
    if (item.sqlite) sqliteIntegrity(file);
  }
  return {deviceId:manifest.deviceId,generation:manifest.generation,files:manifest.files.length,bytes:manifest.bytes,sqlite:manifest.files.filter(f=>f.sqlite).length,symlinks:manifest.symlinks.length};
}
