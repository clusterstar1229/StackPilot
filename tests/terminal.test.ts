import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ssh2 from 'ssh2';
import {Store} from '../electron/store';
import {SSH} from '../electron/ssh';
import {Terminals} from '../electron/terminal';
test('SSH terminal carries UTF-8, interactive input, resize and retained output',{timeout:15000},async()=>{
 const key=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({format:'pem',type:'pkcs1'});let shell:any;let size:any;let client:any;
 const server=new ssh2.Server({hostKeys:[key]},connection=>{client=connection;connection.on('error',()=>{});connection.on('authentication',ctx=>ctx.username==='root'&&ctx.method==='password'&&ctx.password==='fixture-password'?ctx.accept():ctx.reject());connection.on('ready',()=>connection.on('session',accept=>{const session=accept();session.on('pty',accept=>accept?.());session.on('window-change',(accept,_reject,info)=>{size=info;accept?.();});session.on('exec',accept=>{const stream=accept();stream.write('0\nfixture\nx86_64\nLinux fixture\nSUDO_OK\n');stream.exit(0);stream.end();});session.on('shell',accept=>{shell=accept();shell.on('data',(data:Buffer)=>shell.write(data));});}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as any).port;const folder=fs.mkdtempSync(path.join(os.tmpdir(),'stackpilot-terminal-'));const store=new Store(folder,{encrypt:s=>Buffer.from(s).toString('base64'),decrypt:s=>Buffer.from(s,'base64').toString()},()=>{});const id=crypto.randomUUID();
 store.state.servers.push({id,name:'fixture',host:'127.0.0.1',port,username:'root',remember:false,hasCredential:true,status:'offline',group:'unit'});store.setSecret(id,{host:'127.0.0.1',port,username:'root',password:'fixture-password'},false);const ssh=new SSH(store,async()=>true);const events:any[]=[];const terminals=new Terminals(ssh,event=>events.push(event));
 try{await ssh.connect(id);const session=await terminals.open({serverId:id,cols:80,rows:24});const utf=Buffer.from('中文终端');shell.write(utf.subarray(0,2));shell.write(utf.subarray(2));terminals.write({id:session.id,data:'interactive\r'});terminals.resize({id:session.id,rows:37,cols:121});
  for(let i=0;i<100;i++){if(events.map(e=>e.data||'').join('').includes('interactive')&&size)break;await new Promise(r=>setTimeout(r,10));}
  const text=events.map(e=>e.data||'').join('');assert.ok(text.includes('中文终端'));assert.ok(text.includes('interactive'));assert.ok(!text.includes('\uFFFD'));assert.equal(size.rows,37);assert.equal(size.cols,121);assert.ok(terminals.list()[0].output.includes('interactive'));
  terminals.close(session.id);assert.equal(terminals.list().length,0);
 }finally{terminals.closeAll();ssh.close();client?.end();await new Promise<void>(r=>server.close(()=>r()));fs.rmSync(folder,{recursive:true,force:true});}
});
