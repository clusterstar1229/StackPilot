import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as tar from 'tar';
import yauzl from 'yauzl';
import { uid, checkArchiveEntry } from './policy';
import type { Artifact } from '../shared/model';
export class Artifacts {
  private items = new Map<string,{path: string; info: Artifact}>();
  temporary = fs.mkdtempSync(path.join(os.tmpdir(),'stackpilot-'));
  register(file: string): Artifact {
    const stat=fs.lstatSync(file); if(stat.isSymbolicLink())throw new Error('不能选择符号链接');
    if(!stat.isFile()&&!stat.isDirectory())throw new Error('请选择文件或目录');
    if(stat.isFile()&&stat.size>2*1024**3)throw new Error('单个发布文件不能超过 2GB');
    const info:Artifact={id:uid(),name:path.basename(file),size:stat.size,directory:stat.isDirectory()};
    this.items.set(info.id,{path:file,info});return info;
  }
  get(id: string) {const item=this.items.get(id);if(!item)throw new Error('发布包选择已失效，请重新选择');return item;}
  async prepare(id: string,runtime: string) {
    const item=this.get(id);let file=item.path;
    if(item.info.directory){let total=0,count=0;const walk=(dir:string)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name==='node_modules'||e.name==='.git')continue;const p=path.join(dir,e.name);const s=fs.lstatSync(p);if(s.isSymbolicLink())throw new Error('目录中包含符号链接，请移除后重试');if(s.isDirectory())walk(p);else{total+=s.size;count++;if(total>2*1024**3||count>100000)throw new Error('发布包超过 2GB 或 100000 个文件');}}};walk(file);
      const target=path.join(this.temporary,uid()+'.tar.gz');await tar.c({cwd:file,file:target,gzip:true,portable:true,filter:p=>!p.split(/[\\/]/).some(s=>['node_modules','.git'].includes(s))},['.']);file=target;
    }
    const lower=file.toLowerCase();const archive=/\.(?:zip|tgz|tar\.gz|tar)$/.test(lower)&&!['jar','war'].includes(runtime);
    if(archive){let total=0,count=0;const check=(name:string,type:string,size:number)=>{checkArchiveEntry(name,type);total+=size;count++;if(total>2*1024**3||count>100000)throw new Error('压缩包解压后超过 2GB 或 100000 个条目');};
      if(lower.endsWith('.zip'))await new Promise<void>((resolve,reject)=>yauzl.open(file,{lazyEntries:true},(err,zip)=>{if(err||!zip)return reject(err);zip.on('error',reject);zip.on('entry',entry=>{try{const mode=(entry.externalFileAttributes>>>16)&0xffff;if(mode&0o6000)throw new Error('发布包不允许 SUID/SGID 文件');const type=mode&0xf000;check(entry.fileName,type===0xa000?'symlink':type&&type!==0x8000&&type!==0x4000?'special':'file',entry.uncompressedSize);zip.readEntry();}catch(e){zip.close();reject(e);}});zip.on('end',resolve);zip.readEntry();}));
      else await tar.t({file,onReadEntry:e=>{if((e.mode||0)&0o6000)throw new Error('发布包不允许 SUID/SGID 文件');check(e.path,e.type,e.size);}});
    }
    return {file,size:fs.statSync(file).size,archive,extension:lower.endsWith('.zip')?'zip':archive?'tar':path.extname(lower).slice(1)};
  }
  dispose(){ fs.rmSync(this.temporary,{recursive:true,force:true}); }
}
