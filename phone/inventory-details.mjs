import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';
const output=process.argv[2];if(!output||!path.isAbsolute(output))throw Error('Absolute output required');
const home=path.resolve(process.env.DSH_HOME||path.join(os.homedir(),'.dsh'));
if(output===home||output.startsWith(home+'/'))throw Error('Output outside source required');
fs.mkdirSync(output,{recursive:true,mode:0o700});
const report={schema:1,collectedAt:new Date().toISOString(),tools:{},homeEntries:[],dshEntries:[],largeFiles:[],externalCandidates:[],pathAccessibility:[],errors:[]};
for(const name of ['sshd','ssh','openssl','bzip2','tar','uv','python3','sqlite3','restic','rsync']){
 try{report.tools[name]=execFileSync('/bin/sh',['-c',`command -v ${name}`],{encoding:'utf8',timeout:3000,stdio:['ignore','pipe','ignore']}).trim();}catch{report.tools[name]=null;}
}
const skip=new Set(['node_modules','.git','.venv','.venv-asr','.venv310','.cache']);
let count=0;
function size(p){const s=fs.lstatSync(p);if(++count>300000)throw Error('SCAN_LIMIT');if(s.isSymbolicLink())return{files:0,bytes:0,link:fs.readlinkSync(p),actual:fs.realpathSync(p)};
 if(s.isFile()){if(s.size>40*1024*1024)report.largeFiles.push({path:p,bytes:s.size});return{files:1,bytes:s.size};}
 if(!s.isDirectory())return{files:0,bytes:0};if(skip.has(path.basename(p)))return{files:0,bytes:0,excluded:true};
 let files=0,bytes=0;for(const name of fs.readdirSync(p)){try{const x=size(path.join(p,name));files+=x.files;bytes+=x.bytes;}catch(e){report.errors.push({path:path.join(p,name),code:e.code||'SCAN_ERROR'});}}
 return{files,bytes};}
for(const name of fs.readdirSync(home)){const p=path.join(home,name);try{report.dshEntries.push({name,...size(p)});}catch(e){report.errors.push({path:p,code:e.code||'SCAN_ERROR'});}}
for(const name of fs.readdirSync(os.homedir())){const p=path.join(os.homedir(),name);try{const s=fs.lstatSync(p);const e={name,kind:s.isSymbolicLink()?'symlink':s.isDirectory()?'directory':'file',bytes:s.size};report.homeEntries.push(e);
 if(s.isDirectory()&&!name.startsWith('.')&&!['.dsh','mnemon-install'].includes(name))report.externalCandidates.push({path:p,...size(p),coverage:'unclassified; review before exclusion'});
 }catch(e){report.errors.push({path:p,code:e.code||'SCAN_ERROR'});}}
for(const p of ['/data/user/0/com.dsh.client/files','/data/data/com.dsh.client/files','/root/.dsh/heart','/root/.dsh/heart/config.json','/sdcard/dshproject','/sdcard/Download/DSH-BK']){
 try{fs.accessSync(p,fs.constants.R_OK);report.pathAccessibility.push({path:p,readable:true,actual:fs.realpathSync(p)});}catch(e){report.pathAccessibility.push({path:p,readable:false,code:e.code});}
}
try{const cfg=JSON.parse(fs.readFileSync(path.join(home,'heart/config.json'),'utf8'));report.heart={memoryMode:cfg.memoryMode??'legacy'};}catch{report.heart={readable:false};}
report.processCapabilities={nodeSqliteBackup:typeof(await import('node:sqlite')).backup==='function'};
const file=path.join(output,'details.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
fs.writeFileSync(path.join(output,'details.sha256'),createHash('sha256').update(fs.readFileSync(file)).digest('hex')+'  details.json\n',{mode:0o600});
console.log(JSON.stringify({ok:true,file,errors:report.errors.length}));
