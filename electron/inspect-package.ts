import fs from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';
import yauzl from 'yauzl';
import {detectPackage} from '../shared/build-profiles';
export async function inspectPackage(file:string){
 const files:string[]=[];const texts:Record<string,string>={};const wanted=(s:string)=>s.split('/').length<=2&&/(^|\/)(package\.json|requirements\.txt|manage\.py)$/.test(s);
 if(fs.statSync(file).isDirectory()){
  const walk=(dir:string,level=0)=>{if(level>5||files.length>20000)return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git','.venv'].includes(e.name)||e.isSymbolicLink())continue;const p=path.join(dir,e.name);if(e.isDirectory())walk(p,level+1);else{const name=path.relative(file,p).replaceAll('\\','/');files.push(name);if(wanted(name)&&fs.statSync(p).size<200000)texts[name]=fs.readFileSync(p,'utf8');}}};walk(file);
 }else if(/\.zip$/i.test(file))await new Promise<void>((resolve,reject)=>yauzl.open(file,{lazyEntries:true},(error,zip)=>{if(error||!zip)return reject(error);zip.on('error',reject);zip.on('entry',entry=>{const name=entry.fileName.replace(/^\.\//,'');if(!name.endsWith('/'))files.push(name);if(wanted(name)&&entry.uncompressedSize<200000)zip.openReadStream(entry,(e,stream)=>{if(e||!stream)return reject(e);const data:Buffer[]=[];stream.on('data',b=>data.push(b));stream.on('error',reject);stream.on('end',()=>{texts[name]=Buffer.concat(data).toString('utf8');zip.readEntry();});});else zip.readEntry();});zip.on('end',resolve);zip.readEntry();}));
 else if(/\.(tgz|tar\.gz|tar)$/i.test(file))await tar.t({file,onReadEntry:e=>{const name=e.path.replace(/^\.\//,'');if(e.type==='File')files.push(name);if(wanted(name)&&e.size<200000){const data:Buffer[]=[];e.on('data',b=>data.push(b));e.on('end',()=>{texts[name]=Buffer.concat(data).toString('utf8');});}}});
 else files.push(path.basename(file));
 const first=files[0]?.split('/')[0];if(first&&files.length&&files.every(s=>s.startsWith(first+'/'))){const unwrapped=files.map(s=>s.slice(first.length+1));for(const [name,text]of Object.entries(texts))texts[name.slice(first.length+1)]=text;return detectPackage(unwrapped,texts);}
 return detectPackage(files,texts);
}
