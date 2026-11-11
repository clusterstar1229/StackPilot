import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {SourceBuilds} from '../electron/source-build';
import {Store} from '../electron/store';
import {Artifacts} from '../electron/artifacts';

test('real authenticated Git HTTP clone records branch commit without persisting credentials',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'stackpilot-git-test-'));
 const repository=path.join(root,'sample.git');fs.mkdirSync(repository);
 const git=(...args:string[])=>execFileSync('git',args,{cwd:repository,stdio:'pipe',windowsHide:true});
 git('init','-b','release');git('config','user.email','fixture@example.invalid');git('config','user.name','StackPilot fixture');
 fs.writeFileSync(path.join(repository,'package.json'),'{"dependencies":{"next":"16"}}');git('add','.');git('commit','-m','fixture');
 const commit=git('rev-parse','HEAD').toString().trim();const token=crypto.randomBytes(20).toString('hex');let challenges=0;
 const server=http.createServer((request,response)=>{
  if(request.headers.authorization!=='Basic '+Buffer.from('fixture:'+token).toString('base64')){challenges++;response.writeHead(401,{'www-authenticate':'Basic realm="fixture"'});response.end();return;}
  const url=new URL(request.url!,'http://localhost');
  const child=spawn('git',['http-backend'],{windowsHide:true,env:{...process.env,GIT_PROJECT_ROOT:root,GIT_HTTP_EXPORT_ALL:'1',PATH_INFO:url.pathname,QUERY_STRING:url.search.slice(1),REQUEST_METHOD:request.method,CONTENT_TYPE:request.headers['content-type']||'',REMOTE_USER:'fixture'}});
  request.pipe(child.stdin);const chunks:Buffer[]=[];child.stdout.on('data',b=>chunks.push(b));child.on('close',()=>{
   const raw=Buffer.concat(chunks);const at=raw.indexOf('\r\n\r\n');if(at<0){response.writeHead(500);response.end();return;}
   const headers:Record<string,string>={};let status=200;for(const line of raw.subarray(0,at).toString().split('\r\n')){const i=line.indexOf(':');const key=line.slice(0,i);const value=line.slice(i+1).trim();if(key.toLowerCase()==='status')status=parseInt(value);else headers[key]=value;}response.writeHead(status,headers);response.end(raw.subarray(at+4));
  });
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const artifacts=new Artifacts();const stateDir=path.join(root,'state');const store=new Store(stateDir,{encrypt:s=>Buffer.from(s).toString('base64'),decrypt:s=>Buffer.from(s,'base64').toString()},()=>{});const builds=new SourceBuilds(store,artifacts);
 try{
  const result=await builds.inspect({kind:'git',url:`http://127.0.0.1:${(server.address() as any).port}/sample.git`,ref:'release',username:'fixture',token});
  assert.equal(result.commit,commit);assert.equal(result.analysis.profile,'next');assert.ok(challenges>0);
  const serialized=JSON.stringify(store.state)+fs.readdirSync(stateDir).filter(f=>fs.statSync(path.join(stateDir,f)).isFile()).map(f=>fs.readFileSync(path.join(stateDir,f),'utf8')).join('');
  assert.ok(!serialized.includes(token));
 }finally{builds.close();artifacts.dispose();await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(root,{recursive:true,force:true});}
});
