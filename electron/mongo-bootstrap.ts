import {MongoClient} from 'mongodb';
import type {SSH} from './ssh';
import {q,uid} from './policy';
import {databaseArguments} from './db-runtime';

// Avoid running mongosh beside mongod on a small host. The temporary server has
// no network interface; only the root SSH session can reach its Unix socket.
export async function bootstrapMongo(ssh:SSH,x:{serverId:string;name:string;memory:number;cpuPercent:number;password:string},folder:string,image:string,volume:string,log:(s:string)=>void){
  const name='stackpilot-mongo-init-'+uid().slice(0,12);const socket=folder+'/bootstrap/mongodb-27017.sock';
  const arguments_=['--dbpath','/data/db','--bind_ip','127.0.0.1','--unixSocketPrefix','/socket','--filePermissions','0700',...databaseArguments('mongodb',x.memory)];
  const command='chown 0:0 /data/db && exec mongod '+arguments_.map(q).join(' ');
  await ssh.exec(x.serverId,`mkdir -p ${q(folder+'/bootstrap')}\nchmod 700 ${q(folder+'/bootstrap')}\ndocker run -d --name ${q(name)} --label stackpilot.bootstrap=${q(x.name)} --network none --user 0 --cap-drop ALL --cap-add CHOWN --security-opt no-new-privileges --memory ${x.memory}m --memory-swap ${x.memory*2}m --cpus ${x.cpuPercent/100} --pids-limit 256 --mount ${q('type=bind,src='+folder+'/bootstrap,dst=/socket')} --tmpfs /data/configdb:rw,noexec,nosuid,size=1m -v ${q(volume+':/data/db')} --entrypoint /bin/sh ${q(image)} -c ${q(command)}`,{elevated:true,timeout:180000,onData:log});
  try{
    let ready=false,lastError='';
    for(let attempt=0;attempt<45;attempt++){
      const state=await ssh.exec(x.serverId,`docker inspect --format '{{.State.Status}} {{.State.OOMKilled}}' ${q(name)}`,{elevated:true,timeout:30000});
      if(!state.stdout.startsWith('running false')){const logs=await ssh.exec(x.serverId,`docker logs --tail 60 ${q(name)} 2>&1`,{elevated:true,allowFailure:true});log(logs.stdout);throw new Error('MongoDB 初始化实例已退出，请检查日志和内存上限');}
      const tunnel=await ssh.tunnel(x.serverId,'127.0.0.1',27017,socket);
      const client=new MongoClient(`mongodb://127.0.0.1:${tunnel.port}/`,{directConnection:true,maxPoolSize:1,serverSelectionTimeoutMS:3000,socketTimeoutMS:15000});
      try{
        await client.connect();const admin=client.db('admin');
        const users=await admin.command({usersInfo:'admin'});
        await admin.command({[users.users?.length?'updateUser':'createUser']:'admin',pwd:x.password,roles:[{role:'root',db:'admin'}],writeConcern:{w:1,j:true}});
        ready=true;break;
      }catch(error){lastError=(error as Error).message;}
      finally{await client.close().catch(()=>{});tunnel.close();}
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
    if(!ready)throw new Error('MongoDB 私有套接字初始化超时：'+lastError);
    log('MongoDB 管理账号已通过私有套接字创建，开始启动认证实例');
  }finally{
    // Remove only this unique temporary container, retaining its named data volume.
    await ssh.exec(x.serverId,`docker stop -t 30 ${q(name)} >/dev/null 2>&1 || true\nif docker inspect ${q(name)} >/dev/null 2>&1; then docker rm -f ${q(name)} >/dev/null; fi`,{elevated:true,timeout:120000,allowFailure:true}).catch(()=>{});
  }
}
