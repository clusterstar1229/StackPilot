import {StringDecoder} from 'node:string_decoder';
import type {ClientChannel} from 'ssh2';
import {z} from 'zod';
import {SSH} from './ssh';
import {uid} from './policy';
type Session={id:string;serverId:string;epoch:string;title:string;stream:ClientChannel;output:string;createdAt:number};
export class Terminals{
  private sessions=new Map<string,Session>();
  constructor(readonly ssh:SSH,private emit:(event:any)=>void){}
  list(){return [...this.sessions.values()].map(({stream,...s})=>s);}
  async open(input:unknown){const x=z.object({serverId:z.string().uuid(),cols:z.number().int().min(2).max(500).default(100),rows:z.number().int().min(1).max(300).default(28)}).parse(input);const connection=this.ssh.get(x.serverId);
    const stream=await new Promise<ClientChannel>((resolve,reject)=>connection.client.shell({term:'xterm-256color',cols:x.cols,rows:x.rows},(e,s)=>e?reject(e):resolve(s)));
    const id=uid();const server=this.ssh.store.state.servers.find(s=>s.id===x.serverId)!;
    const session:Session={id,serverId:x.serverId,epoch:connection.epoch,title:server.name,stream,output:'',createdAt:Date.now()};this.sessions.set(id,session);
    const decoder=new StringDecoder('utf8');const write=(data:Buffer)=>{const text=decoder.write(data);session.output=(session.output+text).slice(-256*1024);this.emit({type:'terminal',id,event:'data',data:text});};
    stream.on('data',write);stream.stderr.on('data',write);stream.on('error',(e:Error)=>this.emit({type:'terminal',id,event:'error',data:e.message}));stream.on('close',()=>{this.sessions.delete(id);this.emit({type:'terminal',id,event:'exit'});});
    this.ssh.store.audit('打开交互终端',server.name,'success');return{id,serverId:x.serverId,title:server.name,output:session.output};
  }
  write(input:unknown){const x=z.object({id:z.string().uuid(),data:z.string().max(65536)}).parse(input);const s=this.get(x.id);s.stream.write(x.data);return{};}
  resize(input:unknown){const x=z.object({id:z.string().uuid(),cols:z.number().int().min(2).max(500),rows:z.number().int().min(1).max(300)}).parse(input);this.get(x.id).stream.setWindow(x.rows,x.cols,0,0);return{};}
  private get(id:string){const s=this.sessions.get(id);if(!s)throw new Error('终端会话已结束，请重新打开');if(this.ssh.get(s.serverId).epoch!==s.epoch){this.close(id);throw new Error('SSH 已重新连接，请打开新终端');}return s;}
  close(id:string){z.string().uuid().parse(id);this.sessions.get(id)?.stream.close();this.sessions.delete(id);return{};}
  closeServer(serverId:string){for(const s of [...this.sessions.values()])if(s.serverId===serverId)this.close(s.id);}
  closeAll(){for(const id of [...this.sessions.keys()])this.close(id);}
}
