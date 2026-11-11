import {mysqlSSHAuth} from './mysql-auth';
import mysql from 'mysql2/promise';
import pg from 'pg';
import { createClient } from 'redis';
import { MongoClient } from 'mongodb';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { DatabaseProfile } from '../shared/model';
import { databaseSchema, ident } from '../shared/model';
import { SSH } from './ssh';
import { Store } from './store';
import { Plans, q, readOnlySQL, uid } from './policy';
import { writeRemote } from './deploy';
import {databaseArguments,enginePrefix} from './db-runtime';
import {bootstrapMongo} from './mongo-bootstrap';

export class Databases {
  constructor(readonly ssh:SSH,readonly store:Store,readonly plans:Plans){}
  save(input:unknown){const value=databaseSchema.parse(input);const id=value.id||uid();const old=this.store.secret(id);const {password,...profile}=value;const data:DatabaseProfile={...profile,id,hasCredential:!!(password||old?.password)};this.store.setSecret(id,{password:password||old?.password||''});this.store.state.databases=this.store.state.databases.filter(d=>d.id!==id);this.store.state.databases.push(data);this.store.save();return data;}
  get(id:string){const p=this.store.state.databases.find(d=>d.id===id);if(!p)throw new Error('数据库连接不存在');return p;}
  async query(id:string,query:string){const p=this.get(id);const password=this.store.secret(id)?.password||'';const started=Date.now();
    if(p.type==='sqlite'){if(!p.file)throw new Error('请设置 SQLite 文件路径');const sql=readOnlySQL(query);const result=await this.ssh.exec(p.serverId,`sqlite3 -readonly -json ${q(p.file)} ${q(sql)}`,{timeout:15000});let rows;try{rows=JSON.parse(result.stdout||'[]');}catch{throw new Error(result.stdout||result.stderr);}return{rows:rows.slice(0,500),elapsed:Date.now()-started,truncated:rows.length>500};}
    const tunnel=await this.ssh.tunnel(p.serverId,p.host,p.port,p.socket);
    try{
      let rows:any[]=[];
      if(p.type==='mysql'||p.type==='mariadb'){
        const sql=readOnlySQL(query);const c=await mysql.createConnection({host:'127.0.0.1',port:tunnel.port,user:p.username,password,...mysqlSSHAuth(p.socket,password),database:p.database||undefined,connectTimeout:10000,multipleStatements:false,rowsAsArray:false});
        try{await c.query('SET SESSION MAX_EXECUTION_TIME=8000').catch(()=>{});await c.query('SET TRANSACTION READ ONLY');await c.beginTransaction();const [result]=await c.query({sql:/^SELECT\b/i.test(sql)?`SELECT * FROM (${sql}) AS stackpilot_read LIMIT 501`:sql,timeout:12000});rows=Array.isArray(result)?result:[];await c.rollback();}finally{await c.end();}
      }else if(p.type==='postgres'){
        const sql=readOnlySQL(query);const c=new pg.Client({host:'127.0.0.1',port:tunnel.port,user:p.username,password,database:p.database||'postgres',connectionTimeoutMillis:10000,statement_timeout:10000,query_timeout:12000});await c.connect();try{await c.query('BEGIN READ ONLY');rows=(await c.query(/^SELECT\b/i.test(sql)?`SELECT * FROM (${sql}) AS stackpilot_read LIMIT 501`:sql)).rows;await c.query('ROLLBACK');}finally{await c.end();}
      }else if(p.type==='redis'){
        const parts=query.match(/(?:"(?:[^"\\]|\\.)*"|'[^']*'|\S+)/g)?.map(x=>x.replace(/^['"]|['"]$/g,''))||[];const command=parts[0]?.toUpperCase();const allowed=['PING','INFO','DBSIZE','GET','MGET','TTL','PTTL','TYPE','HGETALL','HGET','HLEN','LLEN','LRANGE','SCARD','SSCAN','ZCARD','ZRANGE','SCAN','SLOWLOG','ROLE'];
        if(!allowed.includes(command)||parts.length>30||(command==='SLOWLOG'&&parts[1]?.toUpperCase()!=='GET'))throw new Error('Redis 仅允许只读查询；建议 INFO、SCAN 0 COUNT 100、GET key 或 SLOWLOG GET 20');
        const c=createClient({socket:{host:'127.0.0.1',port:tunnel.port,connectTimeout:10000,reconnectStrategy:false},username:p.username==='default'||!p.username?undefined:p.username,password:password||undefined});c.on('error',()=>{});await c.connect();try{const result:any=await Promise.race([c.sendCommand(parts),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Redis 查询超时')),10000))]);rows=typeof result==='string'?result.split('\r\n').filter(Boolean).map((line:string,i:number)=>({行:i+1,内容:line})):Array.isArray(result)?result.map((v,i)=>({序号:i+1,值:typeof v==='object'?JSON.stringify(v):v})):[{结果:result}];}finally{c.destroy();}
      }else if(p.type==='mongodb'){
        let request:any;try{request=JSON.parse(query);}catch{throw new Error('MongoDB 使用 JSON 查询，例如 {"collection":"users","filter":{},"limit":100} 或 {"command":"stats"}');}
        const c=new MongoClient(`mongodb://127.0.0.1:${tunnel.port}/`,{auth:p.username?{username:p.username,password}:undefined,authSource:p.authDatabase||'admin',directConnection:true,readPreference:'secondaryPreferred',serverSelectionTimeoutMS:10000});try{await c.connect();const db=c.db(p.database||'admin');if(request.command==='version')rows=[await db.admin().command({buildInfo:1})];else if(request.command==='stats')rows=[await db.command({dbStats:1})];else if(request.command==='activity')rows=await c.db('admin').aggregate([{$currentOp:{allUsers:false,idleConnections:false,idleSessions:false}},{$match:{secs_running:{$gte:1}}},{$project:{type:1,opid:1,secs_running:1,op:1,ns:1,active:1,waitingForLock:1,desc:1}},{$limit:500}],{maxTimeMS:8000}).toArray();else if(request.command==='collections')rows=await db.listCollections({},{nameOnly:true}).toArray();else if(request.command==='replication')rows=[await db.admin().command({replSetGetStatus:1})];else{ident.parse(request.collection);if(request.filter&&typeof request.filter!=='object')throw new Error('filter 必须是对象');const filter=JSON.stringify(request.filter||{});if(/\$where|\$function|\$accumulator/.test(filter))throw new Error('禁用服务器端 JavaScript 查询');rows=await db.collection(request.collection).find(request.filter||{}).limit(Math.min(Number(request.limit)||100,500)).maxTimeMS(8000).toArray();}}finally{await c.close();}
      }
      return {rows:JSON.parse(JSON.stringify(rows.slice(0,500),(_k,v)=>typeof v==='bigint'?v.toString():v)),elapsed:Date.now()-started,truncated:rows.length>500};
    }finally{tunnel.close();}
  }
  plan(input:unknown){const x=z.object({serverId:z.string().uuid(),type:z.enum(['mysql','mariadb','postgres','redis','mongodb']),name:ident,port:z.number().int().min(1024).max(65535),password:z.string().min(12).max(200),version:z.string().regex(/^[0-9]+(?:\.[0-9]+){0,2}(?:-alpine[0-9.]*)?$/),memory:z.coerce.number().int().min(64).max(65536).default(512),cpuPercent:z.coerce.number().int().min(1).max(3200).default(100)}).parse(input);
    const lowMongo=x.type==='mongodb'&&x.memory<512;if(lowMongo&&!this.ssh.get(x.serverId).root)throw new Error('低内存 MongoDB 安装需要 root SSH 和普通 rootful Docker；sudo 账号请选择至少 512MB 的标准初始化');
    const container='stackpilot-db-'+x.name;const images={mysql:'mysql',mariadb:'mariadb',postgres:'postgres',redis:'redis',mongodb:'mongo'};const inside={mysql:3306,mariadb:3306,postgres:5432,redis:6379,mongodb:27017};const volumes={mysql:'/var/lib/mysql',mariadb:'/var/lib/mysql',postgres:Number(x.version.split('.')[0])>=18?'/var/lib/postgresql':'/var/lib/postgresql/data',redis:'/data',mongodb:'/data/db'};
    return this.plans.create('安装数据库',`${x.name} / ${x.type}:${x.version}`,[`检查 Docker 和端口 ${x.port}`,`使用官方镜像 ${images[x.type]}:${x.version}`,`创建持久化命名卷 ${container}-data`,`限制内存 ${x.memory}MB、CPU ${x.cpuPercent}%`,'仅监听 127.0.0.1，通过 SSH 隧道访问',...(lowMongo?['通过不接入网络的临时容器与 SSH 私有套接字初始化 MongoDB 账号']:[]),'健康检查后保存连接'],'创建新数据库实例；不替换现有数据库，不开放公网端口。',async()=>{
      const task=this.store.task('安装数据库 '+x.name,x.serverId);void(async()=>{const folder='/opt/stackpilot/databases/'+x.name;let environment='';let extra='';
        if(x.type==='mysql')environment=`MYSQL_ROOT_PASSWORD=${x.password}`;if(x.type==='mariadb')environment=`MARIADB_ROOT_PASSWORD=${x.password}`;if(x.type==='postgres')environment=`POSTGRES_PASSWORD=${x.password}`;if(x.type==='mongodb')environment=`MONGO_INITDB_ROOT_USERNAME=admin\nMONGO_INITDB_ROOT_PASSWORD=${x.password}`;
        if(/[\r\n]/.test(x.password))throw new Error('密码不能包含换行');
        this.store.setSecret('task-secret:'+task.id,{password:x.password},false);
        if(x.type==='redis')extra=`sh -ec ${q('if [ ! -s /data/users.acl ]; then cp /usr/local/etc/redis/users.seed /data/users.acl; chown redis:redis /data/users.acl; chmod 600 /data/users.acl; fi; exec /usr/local/bin/docker-entrypoint.sh redis-server /usr/local/etc/redis/redis.conf')}`;
        else extra=[...enginePrefix[x.type],...(lowMongo?['--auth']:[]),...databaseArguments(x.type,x.memory)].map(q).join(' ');
        const prepare=`command -v docker >/dev/null\n${lowMongo?`if docker info --format '{{json .SecurityOptions}}' | grep -Eq 'name=(userns|rootless)'; then echo '低内存 MongoDB 初始化需要普通 rootful Docker'; exit 1; fi\n`:''}if docker inspect ${q(container)} >/dev/null 2>&1; then echo '同名容器已存在'; exit 1; fi\nif docker volume inspect ${q(container+'-data')} >/dev/null 2>&1; then echo '同名数据卷已存在，拒绝复用'; exit 1; fi\n[ -z "$(ss -H -ltn 'sport = :${x.port}')" ] || { echo '端口已占用'; exit 1; }\n[ ! -e ${q(folder)} ] || { echo '同名数据库配置目录已存在'; exit 1; }\nmkdir -p ${q(folder)}\nchmod 700 ${q(folder)}\n${writeRemote(folder+'/.env',environment,'600')}\n${x.type==='redis'?writeRemote(folder+'/redis.conf',`bind 0.0.0.0\nprotected-mode yes\nappendonly yes\naclfile /data/users.acl\n`,'644')+'\n'+writeRemote(folder+'/users.seed','user default on #'+crypto.createHash('sha256').update(x.password).digest('hex')+' ~* &* +@all\n','644'):''}\ndocker volume create ${q(container+'-data')}`;
        await this.ssh.exec(x.serverId,prepare,{elevated:true,timeout:900000,onData:s=>this.store.log(task,s,30,'准备数据库')});
        if(lowMongo)await bootstrapMongo(this.ssh,x,folder,images[x.type]+':'+x.version,container+'-data',s=>this.store.log(task,s,50,'私有套接字初始化'));
        const script=`docker run -d --name ${q(container)} --label stackpilot.database=${q(x.name)} --restart unless-stopped --memory ${x.memory}m --memory-swap ${x.memory*2}m --cpus ${x.cpuPercent/100} --pids-limit 256 --security-opt no-new-privileges -p 127.0.0.1:${x.port}:${inside[x.type]} --env-file ${q(folder+'/.env')} -v ${q(container+'-data:'+volumes[x.type])} ${x.type==='redis'?`--mount ${q('type=bind,src='+folder+'/redis.conf,dst=/usr/local/etc/redis/redis.conf,readonly')} --mount ${q('type=bind,src='+folder+'/users.seed,dst=/usr/local/etc/redis/users.seed,readonly')} `:''}${q(images[x.type]+':'+x.version)} ${extra}`;
        await this.ssh.exec(x.serverId,script,{elevated:true,timeout:900000,onData:s=>this.store.log(task,s,70,'启动数据库')});
        const profile=this.save({serverId:x.serverId,name:x.name,type:x.type,host:'127.0.0.1',port:x.port,username:x.type==='postgres'?'postgres':x.type==='mongodb'?'admin':x.type==='redis'?'default':'root',password:x.password,database:x.type==='postgres'?'postgres':'',container});
        let ready=false,lastError='';
        try{for(let attempt=0;attempt<60;attempt++){
          const state=await this.ssh.exec(x.serverId,`docker inspect --format '{{.State.Status}} {{.State.OOMKilled}}' ${q(container)}`,{elevated:true});
          if(/exited|dead|restarting|true/.test(state.stdout))throw new Error('数据库启动失败或达到内存上限，请检查容器日志并调整资源配置');
          try{await this.query(profile.id,x.type==='redis'?'PING':x.type==='mongodb'?'{"command":"stats"}':'SELECT 1 AS connected');ready=true;break;}catch(e){lastError=(e as Error).message;}
          await new Promise(r=>setTimeout(r,2000));
        }if(!ready)throw new Error('数据库健康检查超时：'+lastError);}
        catch(e){await this.ssh.exec(x.serverId,`docker stop ${q(container)}`,{elevated:true,timeout:90000,allowFailure:true}).catch(()=>{});this.store.state.databases=this.store.state.databases.filter(p=>p.id!==profile.id);this.store.forget(profile.id);this.store.save();throw e;}
        this.store.log(task,'数据库健康检查通过，连接已保存');this.store.finish(task);
      })().catch(e=>this.store.finish(task,e));return{taskId:task.id};});
  }
  async backup(id:string){const p=this.get(id);const password=this.store.secret(id)?.password||'';const task=this.store.task('备份数据库 '+p.name,p.serverId);
    void(async()=>{const target='/var/backups/stackpilot/databases/'+p.name;const name=new Date().toISOString().replace(/[:.]/g,'-');const file=target+'/'+name+(p.type==='redis'?'.rdb':p.type==='mongodb'?'.archive.gz':p.type==='sqlite'?'.sqlite':'.sql.gz');const auth='/tmp/stackpilot-db-auth-'+uid();
      let command='';const exec=p.container?`docker exec ${q(p.container)} `:'';
      if(p.type==='sqlite'){if(!p.file)throw new Error('未配置 SQLite 文件');command=`sqlite3 ${q(p.file)} ${q('.backup '+file)}`;}
      else if(p.type==='mysql'||p.type==='mariadb'){const locator=p.socket&&!p.container?`protocol=socket\nsocket=${JSON.stringify(p.socket)}\n`:`host=${p.container?'127.0.0.1':p.host}\nport=${p.container?3306:p.port}\n`;const contents=`[client]\nuser=${JSON.stringify(p.username)}\npassword=${JSON.stringify(password)}\n${locator}`;command=`${writeRemote(auth,contents,'600')}\n${p.container?`docker cp ${q(auth)} ${q(p.container+':/tmp/stackpilot-backup.cnf')}\n`:''}${exec}${p.type==='mariadb'?'mariadb-dump':'mysqldump'} --defaults-extra-file=${q(p.container?'/tmp/stackpilot-backup.cnf':auth)} --single-transaction ${p.type==='mysql'?'--set-gtid-purged=OFF ':''}--routines --events ${p.database?'-- '+q(p.database):'--all-databases'} | gzip > ${q(file)}\n${p.container?`docker exec ${q(p.container)} rm -f /tmp/stackpilot-backup.cnf\n`:''}rm -f ${q(auth)}`;}
      else if(p.type==='postgres'){const content=`${p.container?'127.0.0.1':p.host}:${p.container?5432:p.port}:*:${p.username}:${password.replaceAll('\\','\\\\').replaceAll(':','\\:')}`;command=`${writeRemote(auth,content,'600')}\n${p.container?`docker cp ${q(auth)} ${q(p.container+':/tmp/stackpilot.pgpass')}\n`:''}${exec}env PGPASSFILE=${q(p.container?'/tmp/stackpilot.pgpass':auth)} pg_dump -h ${q(p.container?'127.0.0.1':p.host)} -p ${p.container?5432:p.port} -U ${q(p.username)} --no-owner --no-acl ${q(p.database||'postgres')} | gzip > ${q(file)}\n${p.container?`docker exec ${q(p.container)} rm -f /tmp/stackpilot.pgpass\n`:''}rm -f ${q(auth)}`;}
      else if(p.type==='redis'){if(!p.container)throw new Error('Redis 一致性备份当前支持容器实例；外部实例请使用其原有备份机制');const script=`#!/bin/sh\nexport REDISCLI_AUTH=${q(password)}\nexec redis-cli ${p.username?'--user '+q(p.username)+' ':''}--rdb /data/stackpilot-backup.rdb\n`;command=`${writeRemote(auth,script,'700')}\ndocker cp ${q(auth)} ${q(p.container+':/tmp/stackpilot-backup.sh')}\ndocker exec ${q(p.container)} sh /tmp/stackpilot-backup.sh\ndocker cp ${q(p.container+':/data/stackpilot-backup.rdb')} ${q(file)}\ndocker exec ${q(p.container)} rm -f /tmp/stackpilot-backup.sh\nrm -f ${q(auth)}`;}
      else{const uri=`mongodb://${encodeURIComponent(p.username)}:${encodeURIComponent(password)}@${p.container?'127.0.0.1':p.host}:${p.container?27017:p.port}/${p.database||''}?authSource=${encodeURIComponent(p.authDatabase||'admin')}`;command=`${writeRemote(auth,'uri: '+JSON.stringify(uri)+'\n','600')}\n${p.container?`docker cp ${q(auth)} ${q(p.container+':/tmp/stackpilot-mongodump.yml')}\n`:''}${exec}mongodump --config=${q(p.container?'/tmp/stackpilot-mongodump.yml':auth)} --archive --gzip > ${q(file)}\n${p.container?`docker exec ${q(p.container)} rm -f /tmp/stackpilot-mongodump.yml\n`:''}rm -f ${q(auth)}`;}
      await this.ssh.exec(p.serverId,`umask 077\nmkdir -p ${q(target)}\n${command}\nchmod 600 ${q(file)}\nls -lh ${q(file)}`,{elevated:true,timeout:900000,onData:s=>this.store.log(task,s,85,'生成备份')});this.store.log(task,'备份保留在 '+file+'，可通过文件管理下载');this.store.finish(task);
    })().catch(e=>this.store.finish(task,e));return{taskId:task.id};}
}
