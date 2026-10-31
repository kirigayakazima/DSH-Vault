// Aggregate-only restore checks. Never returns statement text, user messages or credentials.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import zlib from 'node:zlib';
import { fault } from './snapshot.mjs';

export async function auditContents(directory){
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
 const result={heart:{},sqlite:[],sessions:{compressedFiles:0,jsonRecords:0}};
 const config=path.join(directory,'data/dsh/heart/config.json');
 if(fs.existsSync(config)){try{const c=JSON.parse(fs.readFileSync(config));result.heart.memoryMode=c.memoryMode??'legacy';}catch{throw fault('RESTORED_HEART_CONFIG_INVALID');}}
 const notebook=path.join(directory,'data/dsh/heart/notebook.md');
 if(fs.existsSync(notebook))result.heart.notebookEntries=fs.readFileSync(notebook,'utf8').split('\n').filter(s=>/^\s*-\s/.test(s)).length;
 for(const item of manifest.files){
  const file=path.join(directory,item.path);
  if(item.sqlite){
   const db=new DatabaseSync(file,{readOnly:true});
   try{const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    const counts=tables.map(t=>({table:t.name,rows:db.prepare('SELECT COUNT(*) AS n FROM "'+t.name.replaceAll('"','""')+'"').get().n}));
    result.sqlite.push({root:item.path.split('/')[1],tables:counts});
   }finally{db.close();}
  }
  if(item.path.startsWith('data/dsh/sessions/')&&/\.jsonl\.zst(?:d)?$/.test(item.path)){
   const buf=fs.readFileSync(file);
   const starts=[];
   for(let i=0;i<=buf.length-4;i++){
     if(buf[i]===0x28&&buf[i+1]===0xb5&&buf[i+2]===0x2f&&buf[i+3]===0xfd)starts.push(i);
   }
   starts.push(buf.length);
   if(starts.length>1){
     try{
       for(let i=0;i<starts.length-1;i++){
         const text=zlib.zstdDecompressSync(buf.subarray(starts[i],starts[i+1])).toString('utf8');
         for(const line of text.split('\n')){if(line.trim()){JSON.parse(line);result.sessions.jsonRecords++;}}
       }
       result.sessions.compressedFiles++;
     }catch{throw fault('RESTORED_SESSION_FORMAT_INVALID');}
   }else if(buf.length>0){
     throw fault('RESTORED_SESSION_FORMAT_INVALID');
   }
  }
 }
 return result;
}
