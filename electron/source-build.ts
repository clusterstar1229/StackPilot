import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import zlib from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import {z} from 'zod';
import YAML from 'yaml';
import {ident} from '../shared/model';
import {profileById} from '../shared/build-profiles';
import {inspectPackage} from './inspect-package';
import {Artifacts} from './artifacts';
import {Store} from './store';
import {uid,q} from './policy';
const relative=z.string().max(300).refine(s=>!s.startsWith('/')&&!s.includes('..')&&!/[\r\n\0]/.test(s),'请输入项目内的相对路径');
export function sourceDockerfile(profile:string,build:string,start:string,output:string,port:number){
 build=build.split('\n').filter(Boolean).join(' && ');const copied=JSON.stringify;const shell=(s:string)=>JSON.stringify(['/bin/sh','-lc',s.startsWith('exec ')?s:'exec '+s]);
 if(profile==='php')return `FROM php:8.3-apache\nCOPY --from=composer:2 /usr/bin/composer /usr/bin/composer\nRUN docker-php-ext-install pdo_mysql && a2enmod rewrite\nWORKDIR /var/www/html\nCOPY . .\nRUN ${build||'true'}\nRUN sed -ri 's!/var/www/html!${'/var/www/html/'+(output==='.'?'':output)}!g; s/AllowOverride None/AllowOverride All/g' /etc/apache2/sites-available/*.conf /etc/apache2/apache2.conf && chown -R www-data:www-data /var/www/html\nCMD ${shell(start||'apache2-foreground')}\n`;
 let builder='node:22-bookworm-slim',runtime='node:22-bookworm-slim',source='/src/'+(output||'.'),target='/app',prepare='';
 if(profile==='static'){runtime='nginx:stable-alpine';target='/usr/share/nginx/html';prepare=`RUN printf %s ${q(Buffer.from('server { listen 80; root /usr/share/nginx/html; index index.html; location / { try_files $uri $uri/ /index.html; } }').toString('base64'))} | base64 -d > /etc/nginx/conf.d/default.conf\n`;}
 if(profile==='maven'||profile==='gradle'){builder=profile==='maven'?'maven:3.9-eclipse-temurin-21':'gradle:8-jdk21';runtime='eclipse-temurin:21-jre';}
 if(profile==='python'){builder=runtime='python:3.12-slim';}
 if(profile==='go'){builder='golang:1.24-bookworm';runtime='debian:bookworm-slim';source='/out';}
 if(profile==='dotnet'){builder='mcr.microsoft.com/dotnet/sdk:8.0';runtime='mcr.microsoft.com/dotnet/aspnet:8.0';source='/out';}
 let file=`FROM ${builder} AS build\nWORKDIR /src\nCOPY . .\nRUN ${build.split('\n').filter(Boolean).join(' && ')}\n`;
 if(profile==='maven'||profile==='gradle'){file+=`RUN mkdir -p /out && jar=$(find ${q('/src/'+output)} -maxdepth 1 -name '*.jar' ! -name '*-sources.jar' ! -name '*-javadoc.jar' ! -name '*-plain.jar' | head -n 1) && test -n "$jar" && cp "$jar" /out/app.jar\n`;source='/out';}
 file+=`FROM ${runtime}\nWORKDIR /app\n`;
 if(profile==='python')file+='COPY --from=build /usr/local /usr/local\n';
 file+=`COPY --from=build ${copied(source)} ${copied(target)}\n${prepare}ENV NODE_ENV=production HOST=0.0.0.0 NITRO_HOST=0.0.0.0 PORT=${port} SERVER_PORT=${port}\n`;
 if(profile==='dotnet')file+=`ENV ASPNETCORE_URLS=http://+:${port}\n`;
 if(profile!=='static')file+=`CMD ${shell(start)}\n`;
 return file;
}
type Workspace={id:string;directory:string;commit:string;repoUrl:string;analysis:Awaited<ReturnType<typeof inspectPackage>>};
export class SourceBuilds{
 private workspaces=new Map<string,Workspace>();private children=new Set<ChildProcess>();
 constructor(readonly store:Store,readonly artifacts:Artifacts){}
 async inspect(input:unknown){const x=z.object({kind:z.enum(['git','directory']),url:z.string().default(''),ref:z.string().max(200).default(''),token:z.string().max(10000).optional(),username:z.string().max(200).default('x-access-token'),artifactId:z.string().optional()}).parse(input);const id=uid();const dir=path.join(this.artifacts.temporary,'source-'+id);fs.mkdirSync(dir,{recursive:true});let commit='';let repoUrl='';const task=this.store.task(x.kind==='git'?'拉取 Git 仓库':'检测本机源码');
  if(x.token)this.store.setSecret('build:'+id,{token:x.token},false);
  try{
   if(x.kind==='git'){const url=new URL(x.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Git 使用 HTTP(S) 地址，凭据请填写独立 Token 字段');repoUrl=url.href;let last=0;await git.clone({fs,http,dir,url:repoUrl,ref:x.ref||undefined,singleBranch:true,depth:1,onAuth:()=>({username:x.username,password:x.token||''}),onProgress:e=>{if(Date.now()-last>500){last=Date.now();this.store.log(task,e.phase+' '+e.loaded+'/'+e.total,25,'拉取源码');}}});commit=await git.resolveRef({fs,dir,ref:'HEAD'});}
   else{if(!x.artifactId)throw new Error('请选择源码文件夹');const original=this.artifacts.get(x.artifactId);if(!original.info.directory)throw new Error('本机源码请选择文件夹');await fs.promises.cp(original.path,dir,{recursive:true,filter:p=>!['.git','node_modules','.venv'].includes(path.basename(p))});}
   const analysis=await inspectPackage(dir);const workspace={id,directory:dir,commit,repoUrl,analysis};this.workspaces.set(id,workspace);task.result={workspaceId:id,commit,repoUrl,analysis};this.store.finish(task);return{...task.result,taskId:task.id};
  }catch(error){this.store.finish(task,error);throw error;}finally{this.store.forget('build:'+id);}
 }
 private command(args:string[],log:(s:string)=>void=()=>{},cwd?:string):Promise<string>{return new Promise((resolve,reject)=>{const child=spawn('docker',args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});this.children.add(child);let output='',error='';child.stdout!.on('data',b=>{output+=b.toString();if(output.length>1024*1024)output=output.slice(-1024*1024);log(b.toString());});child.stderr!.on('data',b=>{error+=b.toString();if(error.length>20000)error=error.slice(-20000);log(b.toString());});child.on('error',e=>{this.children.delete(child);reject(new Error(e.message.includes('ENOENT')?'未找到本机 Docker，请安装并启动 Docker Desktop':e.message));});child.on('close',code=>{this.children.delete(child);code===0?resolve(output):reject(new Error(error||'Docker 命令失败，退出码 '+code));});});}
 async capability(){try{return{available:true,version:(await this.command(['version','--format','{{.Server.Version}}'])).trim()};}catch(error){return{available:false,error:(error as Error).message};}}
 private async compose(context:string,name:string,file:string,task:ReturnType<Store['task']>,workspace:Workspace){
  const project='spb-'+uid().slice(0,8);const composeFile=path.join(context,file||'compose.yaml');const log=(s:string)=>this.store.log(task,s,55,'本机构建 Compose');const config=JSON.parse(await this.command(['compose','--project-directory',context,'-f',composeFile,'config','--format','json','--no-path-resolution']));const created:string[]=[];
  try{
   for(const [key,service]of Object.entries(config.services) as [string,any][]){if(service.build){service.image='stackpilot-local/'+name+'-'+key+':'+project;created.push(service.image);}}
   const buildFile=path.join(context,'compose.stackpilot-build.yaml');fs.writeFileSync(buildFile,YAML.stringify(config));await this.command(['compose','--project-directory',context,'-p',project,'-f',buildFile,'build'],log);
   const images=[...new Set(Object.values(config.services).map((s:any)=>s.image))] as string[];for(const image of images){try{await this.command(['image','inspect',image]);}catch{await this.command(['pull',image],log);}}
   const bundle=path.join(this.artifacts.temporary,'compose-'+uid());fs.mkdirSync(bundle);const tar=path.join(bundle,'stackpilot-images.tar');await this.command(['save','-o',tar,...images],log);await pipeline(fs.createReadStream(tar),zlib.createGzip({level:1}),fs.createWriteStream(tar+'.gz'));fs.unlinkSync(tar);
   const copyAsset=async(value:string)=>{const absolute=path.resolve(context,value);const relative=path.relative(context,absolute);if(relative.startsWith('..')||path.isAbsolute(relative))return value;if(fs.existsSync(absolute)){await fs.promises.mkdir(path.dirname(path.join(bundle,relative)),{recursive:true});await fs.promises.cp(absolute,path.join(bundle,relative),{recursive:true});return './'+relative.replaceAll('\\','/');}return value;};
   let publishedPort=0;for(const service of Object.values(config.services) as any[]){delete service.build;service.pull_policy='never';delete service.container_name;if(!publishedPort)publishedPort=Number(service.ports?.[0]?.published)||0;for(const mount of service.volumes||[])if(mount.type==='bind')mount.source=await copyAsset(mount.source);}
   for(const entry of Object.values(config.configs||{}) as any[])if(entry.file)entry.file=await copyAsset(entry.file);for(const entry of Object.values(config.secrets||{}) as any[])if(entry.file)entry.file=await copyAsset(entry.file);delete config.name;
   fs.writeFileSync(path.join(bundle,'compose.yaml'),YAML.stringify(config));const artifact=this.artifacts.register(bundle);task.result={runtime:'compose',artifact,publishedPort:publishedPort||8080,containerPort:publishedPort||8080,sourceInfo:{kind:workspace.repoUrl?'git':'directory',repo:workspace.repoUrl,commit:workspace.commit,profile:'compose',images}};this.store.log(task,'多服务镜像和配置已打包，可离线交付到目标服务器',100,'构建完成');this.store.finish(task);
  }finally{for(const image of created)await this.command(['image','rm',image]).catch(()=>{});}
 }
 build(input:unknown){const x=z.object({workspaceId:z.string().uuid(),name:ident,profile:z.string(),subdirectory:relative.default(''),buildCommand:z.string().max(12000).default(''),startCommand:z.string().max(6000).default(''),output:z.string().max(300).refine(s=>!/[\r\n\0]/.test(s)).default(''),port:z.number().int().min(1).max(65535).default(8080)}).parse(input);const workspace=this.workspaces.get(x.workspaceId);if(!workspace)throw new Error('源码工作区已失效，请重新检测');const task=this.store.task('本机 Docker 构建 '+x.name);const image='stackpilot-local/'+x.name+':'+uid().slice(0,12);let created='';
  void(async()=>{const capability=await this.capability();if(!capability.available)throw new Error(capability.error);const profile=profileById(x.profile);const context=path.join(this.artifacts.temporary,'context-'+uid());const source=path.resolve(workspace.directory,x.subdirectory);if(!source.startsWith(workspace.directory))throw new Error('子目录越出工作区');await fs.promises.cp(source,context,{recursive:true,filter:p=>!['.git','node_modules','.venv'].includes(path.basename(p))});
   const build=x.buildCommand||profile.build,start=x.startCommand||profile.start,output=x.output||profile.output;if(x.profile==='compose'){await this.compose(context,x.name,output,task,workspace);return;}let dockerfile='';
   if(x.profile==='dockerfile'){dockerfile=path.join(context,output||'Dockerfile');if(!fs.existsSync(dockerfile))throw new Error('未找到项目 Dockerfile');}
   else{dockerfile=path.join(context,'Dockerfile.stackpilot');fs.writeFileSync(dockerfile,sourceDockerfile(x.profile,build,start,output,x.port));}
   this.store.log(task,'使用 Linux Docker 环境构建；服务器不参与编译',10,'构建镜像');await this.command(['build','--label','stackpilot.build='+task.id,'-t',image,'-f',dockerfile,context],s=>this.store.log(task,s,55,'构建镜像'));
   created=image;const imageId=(await this.command(['image','inspect','--format','{{.Id}}',image])).trim();const archive=path.join(this.artifacts.temporary,x.name+'-'+task.id+'.image.tar');this.store.log(task,'导出镜像归档',75,'准备上传产物');await this.command(['save','-o',archive,image]);await pipeline(fs.createReadStream(archive),zlib.createGzip({level:1}),fs.createWriteStream(archive+'.gz'));
   const artifact=this.artifacts.register(archive+'.gz');const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(archive+'.gz'))hash.update(chunk);const sourceInfo={kind:workspace.repoUrl?'git':'directory',repo:workspace.repoUrl,commit:workspace.commit,profile:x.profile,imageId,sha256:hash.digest('hex'),buildCommand:build,startCommand:start};
   task.result={artifact,image,containerPort:x.port,sourceInfo};this.store.log(task,'构建完成，可选择服务器发布。镜像包在本次应用运行期间保留。',100,'构建完成');this.store.finish(task);
  })().catch(error=>this.store.finish(task,error)).finally(()=>{if(created)void this.command(['image','rm',created]).catch(()=>{});});return{taskId:task.id};
 }
 close(){for(const child of this.children)child.kill();}
}
