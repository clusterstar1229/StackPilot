import { app, BrowserWindow, ipcMain, dialog, safeStorage, protocol, net, shell, Notification } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { channels, serverSchema, deploymentSchema, remotePathSchema, type Channel, type Server } from '../shared/model';
import { Store } from './store';
import { SSH } from './ssh';
import { Artifacts } from './artifacts';
import { Deployer } from './deploy';
import { Databases } from './databases';
import { DatabaseAdmin } from './database-admin';
import { DatabaseLifecycle } from './database-lifecycle';
import { Operations } from './operations';
import { Network } from './network';
import {Terminals} from './terminal';
import {SourceBuilds} from './source-build';
import {inspectPackage} from './inspect-package';
import {parseRecipe,serializeRecipe} from '../shared/recipe';
import { uid, Plans, redact, q } from './policy';

protocol.registerSchemesAsPrivileged([{scheme:'stackpilot',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
app.setName('StackPilot');
const customUserData=app.commandLine.getSwitchValue('user-data-dir');
if(customUserData){if(!path.isAbsolute(customUserData))throw new Error('工作区目录必须使用绝对路径');app.setPath('userData',path.resolve(customUserData));}
const lock=app.requestSingleInstanceLock();if(!lock)app.quit();
let terminals:Terminals;let sources:SourceBuilds;
let window:BrowserWindow;let store:Store;let ssh:SSH;let artifacts:Artifacts;let quitting=false;
const id=z.string().uuid();
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
app.whenReady().then(async()=>{
  const root=path.join(__dirname,'..');const dist=path.join(root,'dist');
  protocol.handle('stackpilot',request=>{const url=new URL(request.url);if(url.hostname!=='app')return new Response('Forbidden',{status:403});let file;try{file=path.resolve(dist,'.'+decodeURIComponent(url.pathname));}catch{return new Response('Bad request',{status:400});}if(!file.startsWith(dist+path.sep))return new Response('Forbidden',{status:403});return net.fetch(pathToFileURL(file).href);});
  window=new BrowserWindow({width:1480,height:940,minWidth:1100,minHeight:740,backgroundColor:'#F5F7FB',title:'栈桥 StackPilot',titleBarStyle:'hidden',show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,spellcheck:false}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());window.webContents.session.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
  let pending:NodeJS.Timeout|undefined;let completed=new Set<string>();
  store=new Store(path.join(app.getPath('userData'),'workspace'),{encrypt:s=>{if(!safeStorage.isEncryptionAvailable())throw new Error('Windows 凭据加密不可用，未保存任何明文凭据');return safeStorage.encryptString(s).toString('base64');},decrypt:s=>safeStorage.decryptString(Buffer.from(s,'base64'))},(data)=>{
    if(data){if(!window.isDestroyed())window.webContents.send('stackpilot:change',data);return;}
    if(!pending)pending=setTimeout(()=>{pending=undefined;if(!window.isDestroyed())window.webContents.send('stackpilot:change',{type:'state'});if(store?.state.settings.notifications){for(const task of store.state.tasks){if(task.finishedAt&&!completed.has(task.id)&&Date.now()-task.finishedAt<3000){completed.add(task.id);if(Notification.isSupported())new Notification({title:task.status==='success'?'任务完成':'任务需要处理',body:task.title+(task.error?'：'+task.error.slice(0,100):'')}).show();}}}},250);
  });
  store.state.version=app.getVersion();store.save();completed=new Set(store.state.tasks.map(t=>t.id));artifacts=new Artifacts();const plans=new Plans(()=>JSON.stringify({sessions:[...ssh.connections.entries()].map(([id,c])=>[id,c.epoch]).sort(),apps:store.state.deployments.map(a=>[a.id,a.release,a.serverId,a.domains,a.configPath]),databases:store.state.databases.map(d=>[d.id,d.serverId,d.type,d.host,d.port,d.username,d.database,d.file,d.socket,d.authDatabase,d.container])}));
  ssh=new SSH(store,async(target,fingerprint)=>{const result=await dialog.showMessageBox(window,{type:'question',title:'确认服务器身份',message:'首次连接，请核验 SSH 主机指纹',detail:`服务器：${target}\n\n${fingerprint}\n\n请与服务器控制台或管理员提供的指纹比较。确认后将记录该指纹；将来发生变化时会拒绝连接。`,buttons:['取消连接','信任并连接'],defaultId:0,cancelId:0,noLink:true});return result.response===1;});
  terminals=new Terminals(ssh,data=>{if(!window.isDestroyed())window.webContents.send('stackpilot:change',data);});sources=new SourceBuilds(store,artifacts);
  const deployer=new Deployer(ssh,store,artifacts);const databases=new Databases(ssh,store,plans);const databaseAdmin=new DatabaseAdmin(databases,artifacts);const lifecycle=new DatabaseLifecycle(databases);const operations=new Operations(ssh,store,plans,artifacts);const network=new Network(store,ssh,plans,artifacts);
  const previews=new Map<string,{serverId:string;epoch:string;targetPort:number;port:number;close:()=>void}>();
  const handlers:Record<Channel,(x:any)=>any>={
    'terminal.open':x=>terminals.open(x),'terminal.list':()=>terminals.list(),'terminal.write':x=>terminals.write(x),'terminal.resize':x=>terminals.resize(x),'terminal.close':x=>terminals.close(id.parse(x.id)),
    'artifact.inspect':x=>inspectPackage(artifacts.get(x.id).path),
    'source.inspect':x=>sources.inspect(x),'source.build':x=>sources.build(x),'source.capability':()=>sources.capability(),
    'recipe.import':async()=>{const file=await dialog.showOpenDialog(window,{title:'导入部署配置',properties:['openFile'],filters:[{name:'部署配置',extensions:['yaml','yml','json']}]});return file.canceled?null:parseRecipe(fs.readFileSync(file.filePaths[0],'utf8'));},
    'recipe.export':async x=>{const content=serializeRecipe(x);const file=await dialog.showSaveDialog(window,{title:'导出部署配置',defaultPath:(x.name||'application')+'.stackpilot.yaml'});if(file.canceled||!file.filePath)return null;fs.writeFileSync(file.filePath,content);return{path:file.filePath};},
    state:()=>store.snapshot(),
    'server.save':(x)=>{const value=serverSchema.parse(x);const serverId=value.id||uid();const old=store.secret(serverId);const merged={...old,...value,password:value.password||old?.password,privateKey:value.privateKey||old?.privateKey,passphrase:value.passphrase||old?.passphrase,jump:value.jump?{...old?.jump,...value.jump,password:value.jump.password||old?.jump?.password}:undefined,proxy:value.proxy?{...old?.proxy,...value.proxy,password:value.proxy.password||old?.proxy?.password}:undefined};store.setSecret(serverId,merged,value.remember);const {password,privateKey,passphrase,jump,proxy,...publicFields}=value;const {password:jp,privateKey:jk,passphrase:js,...publicJump}=jump||{};const {password:pp,...publicProxy}=proxy||{};const server:Server={...publicFields,id:serverId,status:'offline',hasCredential:true,jump:jump?publicJump as any:undefined,proxy:proxy?publicProxy as any:undefined};const existing=store.state.servers.find(s=>s.id===serverId);if(existing&&ssh.connections.has(serverId))ssh.disconnect(serverId);store.state.servers=store.state.servers.filter(s=>s.id!==serverId);store.state.servers.push(server);store.audit('保存服务器配置',server.name,'success');return server;},
    'server.remove':x=>{const serverId=id.parse(x.id);if(store.state.deployments.some(a=>a.serverId===serverId)||store.state.databases.some(d=>d.serverId===serverId))throw new Error('该服务器存在已管理资源，请保留连接配置；系统不提供删除服务器数据的操作');ssh.disconnect(serverId);store.state.servers=store.state.servers.filter(s=>s.id!==serverId);store.forget(serverId);store.save();return{};},
    'server.connect':x=>ssh.connect(id.parse(x.id)),
    'server.disconnect':x=>{const target=id.parse(x.id);terminals.closeServer(target);for(const [key,p]of previews)if(p.serverId===target){p.close();previews.delete(key);}return ssh.disconnect(target);},
    'server.inventory':x=>ssh.inventory(id.parse(x.id)),
    'server.metric':x=>ssh.sample(id.parse(x.id)),
    'server.history':x=>store.history(id.parse(x.id)),
    'artifact.select':async x=>{const selection=await dialog.showOpenDialog(window,{title:x?.directory?'选择发布文件夹':'选择文件',properties:[x?.directory?'openDirectory':'openFile'],...(x?.purpose==='certificate'?{filters:[{name:'PEM 证书与私钥',extensions:['pem','crt','key','cer']},{name:'所有文件',extensions:['*']}]}:{})});return selection.canceled?null:artifacts.register(selection.filePaths[0]);},
    'deploy.preview':x=>deployer.preview(deploymentSchema.parse(x)),
    'deploy.start':x=>deployer.start(deploymentSchema.parse(x)),
    'app.logs':async x=>{const a=store.state.deployments.find(a=>a.id===id.parse(x.id));if(!a)throw new Error('应用不存在');return redact(await deployer.logs(a),store.allSecrets());},
    'app.action':async x=>{const value=z.object({id,action:z.enum(['start','stop','restart'])}).parse(x);const a=store.state.deployments.find(a=>a.id===value.id);if(!a)throw new Error('应用不存在');if(a.runtime==='static'&&a.nginxMode!=='isolated')throw new Error('静态站点由共享 Nginx 托管，请在服务管理中管理 Nginx');const task=store.task(value.action+' '+a.name,a.serverId);void(async()=>{if(a.runtime==='static')await deployer.proxyAction(a,value.action);else{if(value.action!=='start')await deployer.stop(a);if(value.action!=='stop')await deployer.resume(a);}a.status=value.action==='stop'?'stopped':'running';store.finish(task);})().catch(e=>store.finish(task,e));return{taskId:task.id};},
    'app.rollback':x=>{const value=z.object({id,release:z.string().regex(/^[a-z0-9-]+$/)}).parse(x);const a=store.state.deployments.find(a=>a.id===value.id);if(!a)throw new Error('应用不存在');return plans.create('回滚应用',a.name,[`恢复历史版本 ${value.release}`,'恢复运行配置与 Nginx 上游','保留现版本以便再次发布'],'回滚期间可能发生短暂中断。',async()=>{const task=store.task('回滚 '+a.name,a.serverId);void deployer.rollback(a,value.release).then(()=>store.finish(task)).catch(e=>store.finish(task,e));return{taskId:task.id};});},
    'service.plan':x=>operations.servicePlan(x),
    'container.plan':x=>operations.containerPlan(x),
    'files.list':x=>operations.list(id.parse(x.serverId),z.string().parse(x.path)),
    'files.read':x=>operations.read(id.parse(x.serverId),remotePathSchema.parse(x.path)),
    'files.writePlan':x=>operations.writePlan(x),
    'files.upload':x=>operations.uploadPlan(x),
    'files.download':async x=>{const value=z.object({serverId:id,path:remotePathSchema}).parse(x);ssh.get(value.serverId);const file=await dialog.showSaveDialog(window,{title:'下载服务器文件',defaultPath:path.posix.basename(value.path)});if(file.canceled||!file.filePath)return null;await ssh.download(value.serverId,value.path,file.filePath);store.audit('下载文件',value.path,'success');return{path:file.filePath};},
    'diagnostic.run':x=>operations.diagnostic(id.parse(x.serverId),z.string().max(500).parse(x.command)),
    'database.save':x=>databases.save(x),
    'database.query':x=>databases.query(id.parse(x.id),z.string().max(50000).parse(x.query)),
    'database.plan':x=>databases.plan(x),
    'database.managePlan':x=>databaseAdmin.plan(x),
    'database.lifecyclePlan':x=>lifecycle.plan(x),
    'database.backup':x=>databases.backup(id.parse(x.id)),
    'dns.save':x=>network.save(x),
    'dns.plan':x=>network.dnsPlan(x),
    'certificate.plan':x=>network.certificatePlan(x),
    'firewall.plan':x=>operations.firewallPlan(x),
    'backup.plan':x=>operations.backupPlan(x),
    'system.report':x=>operations.report(id.parse(x.serverId),z.string().parse(x.section)),
    'plan.execute':async x=>{const planId=id.parse(x.id);try{const result=await plans.execute(planId);store.audit('执行确认计划',planId,'success');return result;}catch(e){store.audit('执行确认计划',planId,'failed',(e as Error).message);throw e;}},
    'settings.save':x=>{const value=z.object({mode:z.enum(['beginner','expert']).optional(),sampleInterval:z.number().int().min(5).max(300).optional(),retentionDays:z.number().int().min(1).max(30).optional(),launchAtLogin:z.boolean().optional(),notifications:z.boolean().optional()}).parse(x);Object.assign(store.state.settings,value);if(value.launchAtLogin!==undefined)app.setLoginItemSettings({openAtLogin:value.launchAtLogin});store.save();return store.state.settings;},
    'audit.export':async()=>{const result=await dialog.showSaveDialog(window,{title:'导出操作审计',defaultPath:'StackPilot-audit-'+new Date().toISOString().slice(0,10)+'.json',filters:[{name:'JSON',extensions:['json']}]});if(result.canceled||!result.filePath)return null;fs.writeFileSync(result.filePath,JSON.stringify(store.state.audit,null,2));return{path:result.filePath};},
    'app.openPreview':async x=>{const a=store.state.deployments.find(a=>a.id===id.parse(x.id));if(!a)throw new Error('应用不存在');if(a.listenAddress==='127.0.0.1'){if(a.nginx&&a.nginxMode!=='isolated')throw new Error('共享 Nginx 的本机站点请使用域名隧道访问');const epoch=ssh.get(a.serverId).epoch;const targetPort=a.nginx?a.listenPort:a.activePort;let tunnel=previews.get(a.id);if(tunnel&&(tunnel.epoch!==epoch||tunnel.targetPort!==targetPort)){tunnel.close();previews.delete(a.id);tunnel=undefined;}if(!tunnel){const created=await ssh.tunnel(a.serverId,'127.0.0.1',targetPort);tunnel={...created,serverId:a.serverId,epoch,targetPort};previews.set(a.id,tunnel);}const url=`http://127.0.0.1:${tunnel.port}${a.route}`;await shell.openExternal(url);return{url,viaTunnel:true};}const publicUrl=new URL(a.url);if(!['http:','https:'].includes(publicUrl.protocol)||publicUrl.username||publicUrl.password)throw new Error('仅允许 HTTP(S) 预览');await shell.openExternal(publicUrl.href);return{url:publicUrl.href,viaTunnel:false};},
    'app.openUrl':async x=>{const url=new URL(z.string().max(2000).parse(x.url));if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('仅允许打开 HTTP(S) 地址');await shell.openExternal(url.href);return{};},
    'window.minimize':()=>window.minimize(), 'window.maximize':()=>window.isMaximized()?window.unmaximize():window.maximize(), 'window.close':()=>window.close()
  };
  ipcMain.handle('stackpilot:call',async(event,channel:Channel,payload)=>{if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw new Error('不受信任的调用来源');const u=new URL(event.senderFrame.url);if(!(u.protocol==='stackpilot:'&&u.hostname==='app')&&!(process.env.STACKPILOT_DEV==='1'&&u.origin==='http://127.0.0.1:5173'))throw new Error('调用来源不在允许列表');if(!channels.includes(channel)||!handlers[channel])throw new Error('不支持的操作');try{return await handlers[channel](payload);}catch(e){const error=e instanceof z.ZodError?e.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('\n'):(e as Error).message;throw new Error(redact(error,store.allSecrets()));}});
  if(process.env.STACKPILOT_DEV==='1')await window.loadURL('http://127.0.0.1:5173');else await window.loadURL('stackpilot://app/index.html');window.show();
  const busy=new Set<string>();const last=new Map<string,number>();const alerted=new Map<string,number>();
  setInterval(()=>{for(const s of store.state.servers)if(s.status==='online'&&!busy.has(s.id)&&Date.now()-(last.get(s.id)||0)>=store.state.settings.sampleInterval*1000){busy.add(s.id);last.set(s.id,Date.now());void ssh.sample(s.id).then(metric=>{if((metric.cpu>85||metric.memory>90||metric.disk>90)&&Date.now()-(alerted.get(s.id)||0)>1800000){alerted.set(s.id,Date.now());store.audit('资源阈值告警',s.name,'warning',`CPU ${metric.cpu.toFixed(1)}%，内存 ${metric.memory.toFixed(1)}%，磁盘 ${metric.disk}%`);if(store.state.settings.notifications&&Notification.isSupported())new Notification({title:'服务器资源需要关注',body:s.name+'：请检查 CPU、内存和磁盘使用情况'}).show();}}).catch(()=>{}).finally(()=>busy.delete(s.id));}},1000).unref();
  const checking=new Set<string>();setInterval(()=>{for(const a of store.state.deployments){if(!ssh.connections.has(a.serverId)||a.status==='stopped'||checking.has(a.id)||store.state.tasks.some(t=>t.serverId===a.serverId&&t.status==='running')||(a.runtime==='compose'&&!a.nginx))continue;checking.add(a.id);const host=store.state.servers.find(s=>s.id===a.serverId)!.host;const target=a.runtime==='static'?`http://127.0.0.1:${a.listenPort}${a.route}`:`http://127.0.0.1:${a.activePort}${a.healthPath}`;void ssh.exec(a.serverId,`code=$(curl -sS -o /dev/null --max-time 5 -w '%{http_code}' -H ${q('Host: '+(a.domains[0]||host))} ${q(target)})\ncase "$code" in 2??|3??) echo HEALTHY;; *) echo UNHEALTHY;; esac`,{timeout:8000,allowFailure:true}).then(result=>{const status=result.stdout.includes('HEALTHY')&&!result.stdout.includes('UNHEALTHY')?'running':'failed';if(a.status!==status){const was=a.status;a.status=status;store.save();if(status==='failed'&&was==='running'){store.audit('应用健康检查',a.name,'warning','HTTP 健康检查失败，请查看应用日志');if(store.state.settings.notifications&&Notification.isSupported())new Notification({title:'应用健康检查失败',body:a.name+'：请查看日志与运行状态'}).show();}}}).catch(()=>{}).finally(()=>checking.delete(a.id));}},30000).unref();
  window.on('close',e=>{if(!quitting&&store.state.tasks.some(t=>t.status==='running')){e.preventDefault();void dialog.showMessageBox(window,{type:'warning',title:'任务仍在运行',message:'退出会中断本地任务控制，远端进程可能继续运行。',buttons:['继续等待','退出应用'],defaultId:0,cancelId:0}).then(r=>{if(r.response===1){quitting=true;app.quit();}});}});
}).catch(e=>{dialog.showErrorBox('StackPilot 启动失败',(e as Error).stack||String(e));app.quit();});
app.on('before-quit',()=>{if(quitting||!store?.state.tasks.some(t=>t.status==='running')){terminals?.closeAll();sources?.close();ssh?.close();artifacts?.dispose();}});
app.on('window-all-closed',()=>app.quit());
