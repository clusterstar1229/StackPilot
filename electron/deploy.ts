import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { Deployment, DeploymentInput, Inventory, Task } from '../shared/model';
import { runtimeNames } from '../shared/model';
import { SSH } from './ssh';
import { Store } from './store';
import { Artifacts } from './artifacts';
import { q, uid, validateDeployment } from './policy';

export const writeRemote = (file: string,content: string,mode='644') => `printf %s ${q(Buffer.from(content).toString('base64'))} | base64 -d > ${q(file)}\nchmod ${mode} ${q(file)}`;
export const proxyRoot=(d:DeploymentInput)=>`${d.root}/${d.name}/proxy`;
export function proxyControl(d:DeploymentInput,start=true){
  if(d.nginxMode!=='isolated')return `nginx -t\n${start?'systemctl enable --now nginx\n':''}systemctl reload nginx`;
  const root=proxyRoot(d);const command=`nginx -p ${q(root+'/')} -c ${q(root+'/nginx.conf')}`;
  return `${command} -t\nif [ -s ${q(root+'/nginx.pid')} ] && kill -0 "$(cat ${q(root+'/nginx.pid')})" 2>/dev/null; then\n  pid=$(cat ${q(root+'/nginx.pid')})\n  tr '\\0' ' ' < "/proc/$pid/cmdline" | grep -F -- ${q(root+'/nginx.conf')} >/dev/null || { echo '隔离 Nginx PID 归属不符，拒绝操作'; exit 1; }\n  ${command} -s reload\n${start?`else\n  ${command}\n`:'else\n  true\n'}fi`;
}
export function privateProxyMain(d:DeploymentInput){const root=proxyRoot(d);return `user ${d.serviceUser};\nworker_processes 1;\npid ${root}/nginx.pid;\nerror_log ${root}/logs/error.log;\nevents { worker_connections 64; }\nhttp {\n  include /etc/nginx/mime.types;\n  default_type application/octet-stream;\n  client_body_temp_path ${root}/tmp/client;\n  proxy_temp_path ${root}/tmp/proxy;\n  fastcgi_temp_path ${root}/tmp/fastcgi;\n  uwsgi_temp_path ${root}/tmp/uwsgi;\n  scgi_temp_path ${root}/tmp/scgi;\n  include ${root}/site.conf;\n}\n`;}
export function nginxConfig(d: DeploymentInput, current: string, ports: number[], fallbackHost = '_', release = '') {
  current+=(d.runtime==='static'&&d.contentDir?'/'+d.contentDir:'');
  const route=d.route==='/'?'/':d.route.replace(/\/$/,'')+'/';
  const upstream=`sp_${d.name.replace(/[^a-zA-Z0-9]/g,'_')}`;
  let conf=`# Managed by StackPilot: ${d.name}\n`;
  if(d.runtime!=='static')conf+=`upstream ${upstream} {\n${ports.map(p=>`  server 127.0.0.1:${p};`).join('\n')}\n}\n`;
  const logRoot=d.nginxMode==='isolated'?proxyRoot(d)+'/logs':'/var/log/nginx';
  conf+=`server {\n  listen ${d.listenAddress==='127.0.0.1'?'127.0.0.1:':''}${d.listenPort};\n  server_name ${d.domains.filter(Boolean).join(' ')||fallbackHost};\n  client_max_body_size 100m;\n  access_log ${logRoot}/stackpilot-${d.name}.access.log;\n  error_log ${logRoot}/stackpilot-${d.name}.error.log;\n  gzip ${d.gzip?'on':'off'};\n  gzip_types text/css application/javascript application/json image/svg+xml;\n${d.nginxMode==='isolated'?'':`  location ^~ /.well-known/acme-challenge/ { root /var/lib/stackpilot/acme; }\n`}  location ~ /\\. { deny all; }\n`;
  for(const p of d.proxies)conf+=`  location ^~ ${p.path} {\n    proxy_pass ${p.target};\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto $scheme;\n${p.websocket?'    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection "upgrade";\n':''}  }\n`;
  if(release)conf+=`  add_header X-StackPilot-Release "${release}" always;\n  location = /__stackpilot_ready_${release} { return 204; }\n`;
  if(d.runtime==='static'){
    conf+=route==='/'?`  root "${current}";\n  index index.html;\n  location / { try_files $uri $uri/ ${d.spa?'/index.html':'=404'}; add_header Cache-Control "no-cache"; }\n`:`  location = ${route.slice(0,-1)} { return 301 ${route}; }\n  location ${route} { alias "${current}/"; index index.html; try_files $uri $uri/ ${d.spa?route+'index.html':'=404'}; }\n`;
    if(d.cache)conf+=`  location ~* ^${route.replace(/[.]/g,'\\.')}(.+\\.(?:css|js|png|jpg|jpeg|gif|svg|woff2?|ico))$ { alias "${current}/$1"; expires 7d; add_header Cache-Control "public, immutable"; }\n`;
  } else conf+=`  location ${route} {\n    proxy_pass http://${upstream};\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto $scheme;\n    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection "upgrade";\n    proxy_read_timeout 60s;\n  }\n`;
  return conf+'}\n';
}
function nativeEntry(d:DeploymentInput,release:string){
  if(d.startCommand)return `exec /bin/bash -lc ${q(d.startCommand)}`;
  const args=d.args.map(q).join(' ');const entry=d.entry||({jar:'app.jar',war:'app.war',binary:'app'} as Record<string,string>)[d.runtime];
  const java=d.javaHome?`JAVA_BIN=${q(d.javaHome+'/bin/java')}\n[ -x "$JAVA_BIN" ] || { echo 'Java 目录中没有可执行的 bin/java'; exit 1; }\n`:`JAVA_BIN=$(find /usr/lib/jvm -maxdepth 4 -type f -path '*/bin/java' 2>/dev/null | grep -E ${q(`(java-${d.javaVersion}|jdk-${d.javaVersion}|jre-${d.javaVersion}|java-1\\.${d.javaVersion})`)} | head -n 1)\n[ -n "$JAVA_BIN" ] || { echo '请求的 Java 版本未安装'; exit 1; }\n`;
  if(d.runtime==='jar'||d.runtime==='war')return java+`exec "$JAVA_BIN" -Xmx${d.memory}m ${d.jvmArgs.map(q).join(' ')} -jar ${q(path.posix.join(release,entry))} ${args}`;
  const commands:Record<string,string>={node:'node',python:'python3',dotnet:'dotnet',binary:''};
  return `exec ${commands[d.runtime]||''} ${q(path.posix.join(release,entry))} ${args}`;
}
export function dockerfile(d:DeploymentInput){
  const entry=d.entry||({jar:'app.jar',war:'app.war',binary:'app'} as Record<string,string>)[d.runtime];let base='',setup='',cmd:string[]=[];
  const appEntry=path.posix.join('/app',d.contentDir,entry);
  switch(d.runtime){
    case 'jar':base=`eclipse-temurin:${d.javaVersion}-jre`;cmd=['java',`-Xmx${d.memory}m`,...d.jvmArgs,'-jar',appEntry,...d.args];break;
    case 'war':base=`tomcat:10.1-jdk${d.javaVersion}-temurin`;setup=`RUN cp ${q(appEntry)} /usr/local/tomcat/webapps/ROOT.war`;cmd=['catalina.sh','run'];break;
    case 'node':base='node:22-bookworm-slim';setup='RUN if [ -f package-lock.json ]; then npm ci --omit=dev; elif [ -f package.json ]; then npm install --omit=dev; fi';cmd=['node',entry,...d.args];break;
    case 'python':base='python:3.12-slim';setup='RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi';cmd=['python3',entry,...d.args];break;
    case 'dotnet':base='mcr.microsoft.com/dotnet/aspnet:8.0';cmd=['dotnet',appEntry,...d.args];break;
    default:base='debian:bookworm-slim';setup=`RUN chmod +x ${q(appEntry)}`;cmd=[appEntry,...d.args];
  }
  if(d.startCommand)cmd=['/bin/sh','-lc',d.startCommand];
  return `FROM ${base}\nWORKDIR /app\nCOPY . /app\n${setup}\nWORKDIR /app${d.contentDir?'/'+d.contentDir:''}\nCMD ${JSON.stringify(cmd)}\n`;
}
export function installScript(pm:string,packages:string[]){
  if(!['apt-get','dnf','yum'].includes(pm))throw new Error('未检测到支持的 apt、dnf 或 yum 包管理器，请先手动安装所需环境');
  if(packages.some(p=>!/^[a-zA-Z0-9+_.:-]+$/.test(p)))throw new Error('软件包名称无效');
  return pm==='apt-get'?`DEBIAN_FRONTEND=noninteractive apt-get update\nDEBIAN_FRONTEND=noninteractive apt-get install -y ${packages.map(q).join(' ')}`:`${pm} install -y ${packages.map(q).join(' ')}`;
}
export function nginxReady(d:DeploymentInput,host:string,release:string){return `for i in $(seq 1 50); do if curl -sS -D - -o /dev/null --max-time 2 -H ${q('Host: '+(d.domains[0]||host))} ${q(`http://127.0.0.1:${d.listenPort}/__stackpilot_ready_${release}`)} | grep -qi ${q('X-StackPilot-Release: '+release)}; then sleep 1; exit 0; fi; sleep 0.2; done; echo 'Nginx 新配置尚未生效'; exit 1`;}
export class Deployer{
  private busy=new Set<string>();
  constructor(readonly ssh:SSH,readonly store:Store,readonly artifacts:Artifacts){}
  async preview(d:DeploymentInput){validateDeployment(d);const inv=await this.ssh.inventory(d.serverId);return{steps:[`检查 ${inv.os} / ${inv.arch}，验证目录和端口`,d.runtime==='image'?`拉取镜像 ${d.image}`:'检查发布包路径和大小，通过 SFTP 上传',`${d.engine==='docker'?'容器':'原生'}部署 ${runtimeNames[d.runtime]}`,d.nginx?'生成独立 Nginx 配置并执行 nginx -t':'直接使用应用监听端口','执行健康检查；失败时恢复原版本','保存发布历史、启动配置和操作记录'],warnings:[...(!this.ssh.get(d.serverId).privileged?['需要 root 或 sudo 免密权限']:[]),...(d.runtime==='war'&&d.engine==='native'?['原生 WAR 仅适用于可执行的 Spring Boot WAR；普通 Servlet WAR 请选择 Docker（Tomcat 10/Jakarta）']:[]),...(d.domains.length?['域名须先正确解析到服务器公网 IP；备案号不能替代域名所有权授权']:[]),...(d.runtime==='compose'?['Compose 会按用户提供的镜像、挂载和网络配置执行，请确认内容来自可信项目']:[])],inventory:inv};}
  start(d:DeploymentInput){validateDeployment(d);const key=d.serverId+':'+d.name;if(this.busy.has(key))throw new Error('该应用已有发布任务正在运行');this.busy.add(key);const task=this.store.task(`部署 ${d.name}`,d.serverId);void this.run(d,task).then(()=>this.store.finish(task)).catch(e=>this.store.finish(task,e)).finally(()=>this.busy.delete(key));return{taskId:task.id};}
  private async run(d:DeploymentInput,task:Task){
    const prior=this.store.state.deployments.find(a=>a.serverId===d.serverId&&a.name===d.name);
    if(d.reuseRelease&&!prior)throw new Error('新应用需要选择发布包；只有已部署应用可以复用当前版本');
    if(prior&&(prior.nginxMode||'system')!==d.nginxMode)throw new Error('已有应用请保持原代理管理模式，迁移时使用新应用名称');
    if(prior&&prior.root!==d.root)throw new Error('已有应用的发布根目录不能直接更改，请使用新应用名称');
    if(prior?.tls&&[...d.domains].sort().join(',')!==[...prior.domains].sort().join(','))throw new Error('修改 HTTPS 网站域名前，请先在域名与证书中关闭本应用 TLS，更新后配置覆盖新域名的证书');
    const host=this.store.state.servers.find(s=>s.id===d.serverId)!.host;
    for(const other of this.store.state.deployments.filter(a=>a.serverId===d.serverId&&a.name!==d.name&&a.nginx&&a.listenPort===d.listenPort))if((!d.domains.length&&!other.domains.length)||d.domains.some(domain=>other.domains.includes(domain)))throw new Error(`域名与监听端口已被应用 ${other.name} 使用，请更换域名/端口，或在原应用配置子路径代理`);
    const savedEnvironment=this.store.secret('env:'+prior?.appId+':'+prior?.release)?.environment||{};
    d={...d,environment:Object.fromEntries(Object.entries(d.environment).map(([key,value])=>{if(value==='••••••（保留已保存值）'){if(!(key in savedEnvironment))throw new Error('加密环境变量已失效，请重新输入 '+key);return[key,savedEnvironment[key]];}return[key,value];}))};
    const release=Date.now().toString(36)+'-'+uid().slice(0,6);const ownerKey='app-owner:'+d.serverId+':'+d.root+':'+d.name;const appId=prior?.appId||this.store.secret(ownerKey)?.id||uid();this.store.setSecret(ownerKey,{id:appId});const base=`${d.root}/${d.name}`;const dir=`${base}/releases/${release}`;const current=`${base}/current`;
    const activePort=d.strategy==='bluegreen'&&prior?.activePort===d.port?d.port+100:d.port;const ports=Array.from({length:d.replicas},(_,i)=>activePort+i);
    const units:string[]=[];let configPath:string|undefined;let configBackup='';let configChanged=false;let switched=false;
    const run=(script:string,timeout=120000)=>this.ssh.exec(d.serverId,script,{elevated:true,timeout,onData:s=>this.store.log(task,s)});
    try{
      this.store.log(task,'检查系统、应用归属和运行环境',5,'环境检查');const inv=await this.ssh.inventory(d.serverId);
      await run(`if [ -e ${q(base)} ]; then [ -f ${q(base+'/.stackpilot-owner')} ] && [ "$(cat ${q(base+'/.stackpilot-owner')})" = ${q(appId)} ] || { echo '目录已存在且不属于该应用，拒绝覆盖'; exit 1; }; fi\nmkdir -p ${q(dir)}\n${writeRemote(base+'/.stackpilot-owner',appId,'600')}`);
      if(d.installMissing){const packages=['curl','tar','unzip'];if(d.nginx&&!inv.nginx)packages.push('nginx');if(d.engine==='native'){
        if(['jar','war'].includes(d.runtime)&&!d.javaHome)packages.push(inv.packageManager==='apt-get'?`openjdk-${d.javaVersion}-jre-headless`:`java-${d.javaVersion}-openjdk-headless`);
        if(d.runtime==='node'&&!inv.node)packages.push('nodejs','npm');if(d.runtime==='python')packages.push('python3',inv.packageManager==='apt-get'?'python3-venv':'python3-pip');if(d.runtime==='dotnet'&&!inv.dotnet)packages.push('dotnet-runtime-8.0','aspnetcore-runtime-8.0');}
        if((d.engine==='docker'||d.runtime==='image'||d.runtime==='compose')&&!inv.docker)packages.push('docker.io');
        if(packages.includes('docker.io')&&inv.packageManager!=='apt-get')throw new Error('此 RHEL/CentOS 环境缺少 Docker，请使用官方 Docker 仓库安装后重新检测；不会自动添加未知软件源');
        await run(installScript(inv.packageManager,packages),900000);
      }
      if(d.nginx){const updated=await this.ssh.inventory(d.serverId);if(!updated.nginx)throw new Error('未检测到 Nginx，请安装后重新检测');if(d.nginxMode==='isolated'){
          const root=proxyRoot(d);configPath=root+'/site.conf';configBackup=`${base}/nginx-before-${release}.conf`;
          if(!prior||prior.listenPort!==d.listenPort){const occupied=await this.ssh.exec(d.serverId,`ss -H -ltn 'sport = :${d.listenPort}'`);if(occupied.stdout.trim())throw new Error('隔离实例的监听端口已被占用');}
          await run(`id ${q(d.serviceUser)} >/dev/null 2>&1 || useradd -r -M -s /sbin/nologin ${q(d.serviceUser)}\nmkdir -p ${q(root+'/logs')} ${q(root+'/tmp/client')} ${q(root+'/tmp/proxy')} ${q(root+'/tmp/fastcgi')} ${q(root+'/tmp/uwsgi')} ${q(root+'/tmp/scgi')}\nchown -R ${q(d.serviceUser+':')} ${q(root+'/tmp')}\n${writeRemote(root+'/nginx.conf',privateProxyMain(d))}\nif [ -f ${q(configPath)} ]; then cp -p ${q(configPath)} ${q(configBackup)}; fi`);
        }else{if(!updated.nginxInclude)throw new Error('未找到 Nginx 的 conf.d 或 sites-enabled include，需管理员添加独立配置入口后重试');configPath=updated.nginxInclude.replace(/\*.*$/,`stackpilot-${d.name}.conf`);configBackup=`${base}/nginx-before-${release}.conf`;
        if(!/^\/[a-zA-Z0-9_./-]+$/.test(configPath))throw new Error('不支持该 Nginx 配置目录格式');
        await run(`if [ -e ${q(configPath)} ]; then grep -q ${q('# Managed by StackPilot: '+d.name)} ${q(configPath)} || { echo '发现同名外部 Nginx 配置，拒绝覆盖'; exit 1; }; cp -p ${q(configPath)} ${q(configBackup)}; fi\nmkdir -p /var/lib/stackpilot/acme`);
        }
      }
      if(d.reuseRelease&&prior&&d.runtime!=='image')await run(`cp -a ${q(base+'/releases/'+prior.release+'/.')} ${q(dir+'/')}`);
      if(d.runtime==='image'&&d.imageArtifactId){
        const artifact=this.artifacts.get(d.imageArtifactId);const remote='/tmp/stackpilot-image-'+uid()+'.tar.gz';
        this.store.log(task,'通过 SSH 上传本机构建的镜像归档',20,'上传镜像');await this.ssh.upload(d.serverId,artifact.path,remote);
        await run(`docker load -i ${q(remote)}\nrm -f ${q(remote)}`,1200000);
      }
      if(d.runtime!=='image'&&!d.reuseRelease){
        this.store.log(task,'正在检查发布包并通过 SSH 加密传输',20,'传输发布包');const artifact=await this.artifacts.prepare(d.artifactId!,d.runtime);
        const remote='/tmp/stackpilot-'+uid()+'.'+artifact.extension;
        await this.ssh.upload(d.serverId,artifact.file,remote);
        if(artifact.archive){await run(`${artifact.extension==='zip'?`unzip -q ${q(remote)} -d ${q(dir)}`:`tar -xf ${q(remote)} -C ${q(dir)} --no-same-owner --no-same-permissions`}\nrm -f ${q(remote)}`);
          await run(`cd ${q(dir)}\nif [ "$(find . -mindepth 1 -maxdepth 1 | wc -l)" -eq 1 ]; then child=$(find . -mindepth 1 -maxdepth 1 -type d | head -n1); if [ -n "$child" ]; then cp -a "$child"/. .; fi; fi`);
        }else{const filename=d.entry||({jar:'app.jar',war:'app.war',binary:'app'} as Record<string,string>)[d.runtime]||this.artifacts.get(d.artifactId!).info.name;await run(`mv ${q(remote)} ${q(dir+'/'+filename)}`);}
      }
      this.store.log(task,'生成环境配置与独立运行单元',45,'配置应用');
      if(d.runtime==='static')await run(`test -f ${q(dir+(d.contentDir?'/'+d.contentDir:'')+'/index.html')} || { echo '未找到 index.html；请上传构建后的 dist 包'; exit 1; }\nfind ${q(dir)} -type d -exec chmod 755 {} +\nfind ${q(dir)} -type f -exec chmod 644 {} +`);
      else if(d.runtime==='compose'){
        const a=d.reuseRelease?undefined:this.artifacts.get(d.artifactId!);if(a&&!a.info.directory&&!/\.ya?ml$/i.test(a.info.name))throw new Error('Compose 请选择 YAML 文件或包含 compose.yaml 的文件夹');
        const composeFile=a?.info.directory?['compose.yaml','compose.yml','docker-compose.yml','docker-compose.yaml'].map(f=>path.join(a.path,f)).find(f=>fs.existsSync(f)):a?.path;if(!composeFile&&!d.reuseRelease)throw new Error('未找到 Compose 配置文件');const content=d.reuseRelease?(await run(`cat ${q(dir+'/compose.yaml')}`)).stdout:fs.readFileSync(composeFile!,'utf8');const document=YAML.parse(content);if(!document?.services)throw new Error('Compose 配置缺少 services');
        // Compose is the operator's executable configuration. Preserve mounts,
        // devices and networking rather than silently rejecting real projects.

        await run(writeRemote(dir+'/compose.yaml',content,'600'));await run(`cd ${q(dir)}\ndocker compose -p ${q('sp-'+d.name)} -f compose.yaml config --quiet`);
      }else if(d.engine==='native'){
        await run(`id ${q(d.serviceUser)} >/dev/null 2>&1 || useradd -r -M -s /sbin/nologin ${q(d.serviceUser)}\n${writeRemote(dir+'/.environment',Object.entries(d.environment).map(([k,v])=>`${k}=${q(v)}`).join('\n'),'600')}\nchown -R ${q(d.serviceUser+':')} ${q(dir)}`);
        if(d.runtime==='node')await run(`cd ${q(dir)}\nif [ -f package-lock.json ]; then runuser -u ${q(d.serviceUser)} -- env npm_config_cache=${q(dir+'/.npm-cache')} npm ci --omit=dev; elif [ -f package.json ]; then runuser -u ${q(d.serviceUser)} -- env npm_config_cache=${q(dir+'/.npm-cache')} npm install --omit=dev; fi`,900000);
        if(d.runtime==='python')await run(`cd ${q(dir)}\nrunuser -u ${q(d.serviceUser)} -- python3 -m venv .venv\nif [ -f requirements.txt ]; then runuser -u ${q(d.serviceUser)} -- .venv/bin/pip install -r requirements.txt; fi`,900000);
        if(d.runtime==='binary')await run(`chmod 750 ${q(dir+'/'+(d.entry||'app'))}`);
      }else if(d.runtime!=='image')await run(`${writeRemote(dir+'/Dockerfile.stackpilot',dockerfile(d))}\ncd ${q(dir)}\ndocker build -t ${q('stackpilot/'+d.name+':'+release)} -f Dockerfile.stackpilot .`,1200000);
      if(prior&&d.strategy==='replace'){await this.stop(prior);this.store.log(task,'已暂停旧版本，新版本失败将自动恢复',50);}
      if(d.runtime==='compose')await run(`cd ${q(dir)}\nif [ -f stackpilot-images.tar.gz ]; then docker load -i stackpilot-images.tar.gz; fi\ndocker compose -p ${q('sp-'+d.name)} -f compose.yaml up -d`,900000);
      else if(d.runtime!=='static')for(let i=0;i<ports.length;i++){
        const unit=`stackpilot-${d.name}-${release}-${i}`;units.push(unit);
        const occupied=await this.ssh.exec(d.serverId,`ss -H -ltn 'sport = :${ports[i]}'`,{elevated:true});if(occupied.stdout.trim())throw new Error(`端口 ${ports[i]} 已被占用，请选择其他端口`);
        const boundPort=d.engine==='docker'||d.runtime==='image'?d.containerPort:ports[i];
        const env={...d.environment,PORT:String(boundPort),SERVER_PORT:String(boundPort)};
        if(d.engine==='docker'||d.runtime==='image'){
          // Credentials stay in a mode-600 environment file, never in argv.
          if(Object.values(env).some(v=>/[\r\n]/.test(v)))throw new Error('Docker 环境变量不能包含换行');
          await run(`${writeRemote(dir+`/.docker-env-${i}`,Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n'),'600')}\ndocker run -d --name ${q(unit)} --label stackpilot.app=${q(appId)} --restart ${d.autoStart?'unless-stopped':'no'} --cap-drop ALL --security-opt no-new-privileges --memory ${d.memory}m ${d.cpuPercent?'--cpus '+(d.cpuPercent/100):''} ${d.systemdSlice?'--cgroup-parent '+q(d.systemdSlice):''} ${d.startCommand?'--entrypoint /bin/sh ':''}--env-file ${q(dir+`/.docker-env-${i}`)} -p 127.0.0.1:${ports[i]}:${d.containerPort} ${q(d.runtime==='image'?d.image:'stackpilot/'+d.name+':'+release)} ${d.startCommand?'-lc '+q(d.startCommand):''}`,600000);
        }else{
          const working=dir+(d.contentDir?'/'+d.contentDir:'');let start=nativeEntry(d,working);if(d.runtime==='python')start=start.replace('exec python3 ',`exec ${q(dir+'/.venv/bin/python')} `);
          const script=`#!/bin/bash\nset -e\ncd ${q(working)}\nset -a\n. ${q(dir+'/.environment')}\nset +a\nexport PATH=${q(dir+'/.venv/bin')}:$PATH\nexport PORT=${ports[i]} SERVER_PORT=${ports[i]}\n${start}\n`;
          const systemd=`[Unit]\nDescription=StackPilot ${d.name}\nAfter=network.target\n[Service]\nType=simple\n${d.systemdSlice?'Slice='+d.systemdSlice+'\n':''}${d.cpuPercent?'CPUQuota='+d.cpuPercent+'%\n':''}User=${d.serviceUser}\nWorkingDirectory=${working}\nExecStart=/bin/bash ${dir}/.start-${i}.sh\nRestart=on-failure\nRestartSec=5\nMemoryMax=${d.memory}M\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=full\nProtectHome=true\n[Install]\nWantedBy=multi-user.target\n`;
          await run(`${writeRemote(dir+`/.start-${i}.sh`,script,'750')}\nchown ${q(d.serviceUser+':')} ${q(dir+`/.start-${i}.sh`)}\n${writeRemote('/etc/systemd/system/'+unit+'.service',systemd)}\nsystemctl daemon-reload\nsystemctl ${d.autoStart?'enable --now':'start'} ${q(unit+'.service')}`);
        }
      }
      this.store.log(task,'正在检查应用健康状态',65,'健康检查');
      if(d.runtime!=='static'&&(d.runtime!=='compose'||d.nginx))for(const p of ports)await run(`for i in $(seq 1 30); do if curl -fsS --max-time 3 ${q(`http://127.0.0.1:${p}${d.healthPath}`)} >/dev/null; then exit 0; fi; sleep 2; done; echo '应用健康检查未通过'; exit 1`,150000);
      await run(`ln -s ${q(dir)} ${q(base+'/next-'+release)}\nmv -Tf ${q(base+'/next-'+release)} ${q(current)}`);switched=true;
      if(d.nginx&&configPath){configChanged=true;let config=nginxConfig(d,current,ports,host,release);if(prior?.tlsConfig){const {cert,key,force}=prior.tlsConfig;config=config.replace('server {\n',`server {\n  listen 443 ssl;\n  ssl_certificate "${cert}";\n  ssl_certificate_key "${key}";\n  ssl_protocols TLSv1.2 TLSv1.3;\n${force?'  if ($scheme = http) { return 301 https://$host$request_uri; }\n':''}`);}await run(`${writeRemote(configPath,config)}\n${proxyControl(d,true)}`);}
      if(d.nginx)await run(nginxReady(d,host,release));
      if(d.runtime==='static'&&d.nginx&&!prior?.tlsConfig?.force)await run(`expected=$(sha256sum ${q(dir+(d.contentDir?'/'+d.contentDir:'')+'/index.html')} | cut -d ' ' -f1)\nactual=$(curl -fsS --max-time 10 -H ${q('Host: '+(d.domains[0]||host))} ${q(`http://127.0.0.1:${d.listenPort}${d.route.replace(/\/?$/,'/')}index.html`)} | sha256sum | cut -d ' ' -f1)\n[ "$expected" = "$actual" ] || { echo 'Nginx 站点内容不匹配，可能存在域名或端口冲突'; exit 1; }`);
      if(prior&&d.strategy==='bluegreen')await this.stop(prior);
      this.store.log(task,'发布成功，保存版本记录。防火墙与云安全组未自动修改。',95,'保存发布记录');
      const publicHost=d.listenAddress==='127.0.0.1'?'127.0.0.1':d.domains[0]||host;
      const publicPort=d.nginx?d.listenPort:activePort;
      this.store.setSecret('env:'+appId+':'+release,{environment:d.environment});const publicInput={...d,environment:Object.fromEntries(Object.keys(d.environment).map(key=>[key,'••••••（保留已保存值）']))};
      const deployment:Deployment={...publicInput,id:prior?.id||uid(),appId,release,activePort,units,createdAt:Date.now(),status:'running',url:prior?.tls?`https://${publicHost}${d.route}`:`http://${publicHost.includes(':')?'['+publicHost+']':publicHost}${publicPort===80?'':':'+publicPort}${d.route}`,previousRelease:prior?.release,history:[...(prior?.history||[]),{release,time:Date.now(),port:activePort,deployment:publicInput}],configPath,tls:prior?.tls,tlsConfig:prior?.tlsConfig};
      this.store.state.deployments=this.store.state.deployments.filter(a=>a.id!==deployment.id);this.store.state.deployments.unshift(deployment);this.store.save();
    }catch(e){
      this.store.log(task,'执行失败，开始恢复旧版本',80,'自动回滚');
      try{
        if(d.runtime==='compose')await run(`cd ${q(dir)}\ndocker compose -p ${q('sp-'+d.name)} -f compose.yaml stop || true`);
        for(const unit of units)await run(d.engine==='docker'||d.runtime==='image'?`docker stop ${q(unit)} || true`:`systemctl stop ${q(unit+'.service')} || true`);
        if(switched&&prior)await run(`ln -s ${q(base+'/releases/'+prior.release)} ${q(base+'/restore-'+release)}\nmv -Tf ${q(base+'/restore-'+release)} ${q(current)}`);
        if(d.nginx&&d.nginxMode==='isolated'&&!prior)await this.proxyAction(d,'stop');
        if(configChanged&&configPath)await run(`if [ -f ${q(configBackup)} ]; then cp -p ${q(configBackup)} ${q(configPath)}; else rm -f ${q(configPath)}; fi\n${d.nginxMode==='isolated'&&!prior?'true':proxyControl(d,false)}`);
        if(prior){await this.resume(prior);this.store.log(task,'旧版本已恢复；失败版本文件保留用于排查');}
      }catch(rollbackError){this.store.log(task,'自动回滚也遇到错误：'+(rollbackError as Error).message);if(prior)prior.status='unknown';}
      throw e;
    }
  }
  async proxyAction(app:DeploymentInput,action:'start'|'stop'|'restart'){
    if(app.nginxMode!=='isolated')throw new Error('共享 Nginx 请使用服务管理入口');
    const root=proxyRoot(app);if(action!=='start')await this.ssh.exec(app.serverId,`if [ -s ${q(root+'/nginx.pid')} ]; then pid=$(cat ${q(root+'/nginx.pid')}); if kill -0 "$pid" 2>/dev/null; then tr '\\0' ' ' < "/proc/$pid/cmdline" | grep -F -- ${q(root+'/nginx.conf')} >/dev/null || { echo '隔离进程归属不符'; exit 1; }; nginx -p ${q(root+'/')} -c ${q(root+'/nginx.conf')} -s quit; for i in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done; fi; fi`,{elevated:true});
    if(action!=='stop')await this.ssh.exec(app.serverId,proxyControl(app,true),{elevated:true});
  }
  async stop(app:Deployment){const cmd=app.runtime==='compose'?`cd ${q(app.root+'/'+app.name+'/releases/'+app.release)} && docker compose -p ${q('sp-'+app.name)} -f compose.yaml stop`:app.units.map(u=>app.engine==='docker'||app.runtime==='image'?`docker stop ${q(u)}`:`systemctl stop ${q(u+'.service')}`).join('\n');if(cmd)await this.ssh.exec(app.serverId,cmd,{elevated:true,timeout:120000});}
  async resume(app:Deployment){const cmd=app.runtime==='compose'?`cd ${q(app.root+'/'+app.name+'/releases/'+app.release)} && docker compose -p ${q('sp-'+app.name)} -f compose.yaml up -d`:app.units.map(u=>app.engine==='docker'||app.runtime==='image'?`docker start ${q(u)}`:`systemctl start ${q(u+'.service')}`).join('\n');if(cmd)await this.ssh.exec(app.serverId,cmd,{elevated:true,timeout:120000});}
  async logs(app:Deployment){if(app.runtime==='static')return(await this.ssh.exec(app.serverId,`tail -n 200 ${q((app.nginxMode==='isolated'?proxyRoot(app)+'/logs':'/var/log/nginx')+'/stackpilot-'+app.name+'.access.log')} ${q((app.nginxMode==='isolated'?proxyRoot(app)+'/logs':'/var/log/nginx')+'/stackpilot-'+app.name+'.error.log')}`,{elevated:true,allowFailure:true})).stdout;
    if(app.runtime==='compose')return(await this.ssh.exec(app.serverId,`cd ${q(app.root+'/'+app.name+'/releases/'+app.release)}\ndocker compose -p ${q('sp-'+app.name)} -f compose.yaml logs --tail 200 --no-color`,{elevated:true,allowFailure:true})).stdout;
    return(await this.ssh.exec(app.serverId,app.units.map(u=>app.engine==='docker'||app.runtime==='image'?`docker logs --tail 200 ${q(u)} 2>&1`:`journalctl -u ${q(u+'.service')} -n 200 --no-pager`).join('\n'),{elevated:true,allowFailure:true})).stdout;
  }
  async rollback(app:Deployment,release:string){
    const historical=app.history.find(h=>h.release===release);if(!historical?.deployment)throw new Error('该历史版本没有完整配置，无法回滚');
    const d=historical.deployment;const base=`${app.root}/${app.name}`;const old={...app};const host=this.store.state.servers.find(s=>s.id===app.serverId)!.host;
    const run=(script:string)=>this.ssh.exec(app.serverId,script,{elevated:true,timeout:120000});
    const oldConfig=app.configPath?(await run(`cat ${q(app.configPath)}`)).stdout:'';
    const switchLink=async(version:string)=>{const temp=base+'/switch-'+uid();await run(`test -d ${q(base+'/releases/'+version)}\nln -s ${q(base+'/releases/'+version)} ${q(temp)}\nmv -Tf ${q(temp)} ${q(base+'/current')}`);};
    const units=d.runtime==='static'||d.runtime==='compose'?[]:Array.from({length:d.replicas},(_,i)=>`stackpilot-${d.name}-${release}-${i}`);const next:Deployment={...app,...d,release,activePort:historical.port,units};
    try{await this.stop(old);await switchLink(release);await this.resume(next);
      if(app.configPath){let config=nginxConfig(d,base+'/current',Array.from({length:d.replicas},(_,i)=>historical.port+i),host,release);if(app.tlsConfig){const {cert,key,force}=app.tlsConfig;config=config.replace('server {\n',`server {\n  listen 443 ssl;\n  ssl_certificate "${cert}";\n  ssl_certificate_key "${key}";\n  ssl_protocols TLSv1.2 TLSv1.3;\n${force?'  if ($scheme = http) { return 301 https://$host$request_uri; }\n':''}`);}await run(`${writeRemote(app.configPath,config)}\n${proxyControl(d,false)}`);}
      if(d.runtime!=='static'&&(d.runtime!=='compose'||d.nginx))await run(`for i in $(seq 1 30); do if curl -fsS --max-time 3 ${q(`http://127.0.0.1:${historical.port}${d.healthPath}`)} >/dev/null; then exit 0; fi; sleep 2; done; echo '历史版本健康检查未通过'; exit 1`);
      if(d.nginx)await run(nginxReady(d,host,release));
      Object.assign(app,next,{status:'running',previousRelease:old.release});this.store.audit('回滚应用',app.name,'success',release);
    }catch(e){await this.stop(next).catch(()=>{});await switchLink(old.release).catch(()=>{});if(app.configPath&&oldConfig)await run(`${writeRemote(app.configPath,oldConfig)}\n${proxyControl(d,false)}`).catch(()=>{});await this.resume(old).catch(()=>{app.status='unknown';});throw e;}
  }
}
