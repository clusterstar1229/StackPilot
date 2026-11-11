import crypto from 'node:crypto';
import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { SocksClient } from 'socks';
import type { ServerInput, Inventory, Metric, Service } from '../shared/model';
import { q } from './policy';
import { Store } from './store';

export interface ExecResult { stdout: string; stderr: string; code: number }
interface Connection { epoch: string; client: Client; jump?: Client; privileged: boolean; root: boolean; previous?: { total: number; idle: number; rx: number; tx: number; at: number } }
export class SSH {
  connections = new Map<string, Connection>();
  private connecting = new Set<string>();
  constructor(readonly store: Store, private trust: (target: string, fingerprint: string) => Promise<boolean>) {}
  get(id: string) { const c = this.connections.get(id); if (!c) throw new Error('服务器尚未连接，请先连接 SSH'); return c; }
  async connect(id: string) {
    if (this.connections.has(id)) return { connected: true };
    if (this.connecting.has(id)) throw new Error('连接正在建立，请稍候');
    const s = this.store.state.servers.find(s => s.id === id); if (!s) throw new Error('服务器不存在');
    const credentials = this.store.secret<ServerInput>(id); if (!credentials) throw new Error('凭据未保存，请编辑服务器并重新输入密码');
    this.connecting.add(id); s.status = 'connecting'; s.error = undefined; this.store.save();
    let client: Client | undefined; let jump: Client | undefined;
    try {
      let sock: Duplex | undefined;
      if (credentials.proxy) {
        const target = credentials.jump || credentials;
        sock = await this.proxySocket(credentials.proxy, target.host, target.port);
      }
      if (credentials.jump) {
        jump = await this.open(credentials.jump,sock);
        sock = await new Promise<Duplex>((resolve,reject) => jump!.forwardOut('127.0.0.1',0,credentials.host,credentials.port,(err,stream) => err ? reject(err) : resolve(stream)));
      }
      client = await this.open(credentials,sock);
      const c: Connection = { epoch:crypto.randomUUID(), client, jump, root: false, privileged: false }; this.connections.set(id,c);
      client.on('close',() => { if (this.connections.get(id)?.client === client) { this.connections.delete(id); s.status = 'offline'; this.store.save(); } jump?.end(); });
      const info = await this.exec(id, "id -u; hostname; uname -m; . /etc/os-release 2>/dev/null; printf '%s\\n' \"${PRETTY_NAME:-Linux}\"; if sudo -n true 2>/dev/null; then echo SUDO_OK; fi");
      const lines = info.stdout.trim().split('\n'); c.root = lines[0] === '0'; c.privileged = c.root || lines.includes('SUDO_OK');
      s.status = 'online'; s.hostname = lines[1]; s.arch = lines[2]; s.os = lines[3]; s.privileged = c.privileged;
      this.store.audit('连接 SSH',s.name,'success'); return { connected: true, privileged: c.privileged };
    } catch (e) { client?.end(); jump?.end(); this.connections.delete(id); s.status = 'error'; s.error = (e as Error).message; this.store.save(); throw e; }
    finally { this.connecting.delete(id); }
  }
  private async open(auth: Pick<ServerInput,'host'|'port'|'username'|'password'|'privateKey'|'passphrase'>, sock?: Duplex) {
    const client = new Client(); const target = `${auth.host}:${auth.port}`;
    return new Promise<Client>((resolve,reject) => {
      let settled = false; const fail = (e: Error) => { if (!settled) { settled = true; client.end(); reject(e); } };
      client.on('error',fail).once('ready',() => { settled = true; resolve(client); });
      const config: ConnectConfig = { host: auth.host, port: auth.port, username: auth.username, password: auth.password || undefined, privateKey: auth.privateKey || undefined, passphrase: auth.passphrase || undefined, sock: sock as any, readyTimeout: 90000, keepaliveInterval: 15000, keepaliveCountMax: 3, hostHash: 'sha256', hostVerifier: (hash: string | Buffer, cb: (ok: boolean) => void): any => {
        const fingerprint = `SHA256:${Buffer.from(String(hash),'hex').toString('base64').replace(/=+$/,'')}`;
        const key = `host:${target}`; const known = this.store.secret<{ fingerprint: string }>(key);
        if (known) { if (known.fingerprint !== fingerprint) { fail(new Error(`服务器 ${target} 的 SSH 主机指纹已变化，已拒绝连接。请人工核验服务器身份。`)); cb(false); } else cb(true); return; }
        this.trust(target,fingerprint).then(ok => { if (ok) this.store.setSecret(key,{ fingerprint }); cb(ok); }).catch(() => cb(false));
      } };
      try { client.connect(config); } catch (e) { fail(e as Error); }
    });
  }
  private async proxySocket(proxy: NonNullable<ServerInput['proxy']>, host: string, port: number): Promise<Duplex> {
    if (proxy.type === 'socks5') return (await SocksClient.createConnection({ proxy: { host: proxy.host, port: proxy.port, type: 5, userId: proxy.username, password: proxy.password }, command: 'connect', destination: { host, port }, timeout: 20000 })).socket;
    return new Promise((resolve,reject) => {
      const socket = net.connect(proxy.port,proxy.host); let data = Buffer.alloc(0);
      const fail = (e: Error) => { socket.destroy(); reject(e); }; socket.setTimeout(20000,() => fail(new Error('HTTP CONNECT 代理超时'))); socket.once('error',fail);
      socket.once('connect',() => { const authority = host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`; socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${proxy.username ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64')}\r\n` : ''}\r\n`); });
      const onData = (chunk: Buffer) => { data = Buffer.concat([data,chunk]); if (data.length > 32768) return fail(new Error('代理响应过长')); const pos = data.indexOf('\r\n\r\n'); if (pos < 0) return; socket.off('data',onData); if (!/^HTTP\/1\.[01] 200\b/.test(data.toString())) return fail(new Error('HTTP 代理拒绝 CONNECT')); socket.setTimeout(0); socket.off('error',fail); if (data.length > pos+4) socket.unshift(data.subarray(pos+4)); resolve(socket); };
      socket.on('data',onData);
    });
  }
  disconnect(id: string) { const c = this.connections.get(id); this.connections.delete(id); c?.client.end(); c?.jump?.end(); const s = this.store.state.servers.find(s => s.id === id); if (s) s.status = 'offline'; this.store.save(); }
  async exec(id: string, script: string, options: { elevated?: boolean; timeout?: number; onData?: (s: string) => void; allowFailure?: boolean; stdin?: string | Buffer } = {}): Promise<ExecResult> {
    const c = this.get(id);
    if (options.elevated && !c.privileged) throw new Error('该操作需要 root 或 sudo 免密权限。请先由管理员授权，系统不会修改 sudo 策略。');
    const command = (options.elevated && !c.root ? 'sudo -n ' : '') + 'bash -se';
    return new Promise((resolve,reject) => {
      let stdout = '', stderr = '', channel: ClientChannel | undefined; let settled = false;
      const timer = setTimeout(() => { if (settled) return; settled = true; channel?.close(); reject(new Error('远端执行超时；请检查远端状态，任务可能仍在运行')); },options.timeout ?? 60000);
      c.client.exec(command,(err,stream) => {
        if (err) { clearTimeout(timer); settled = true; return reject(err); } channel = stream;
        const collect = (data: Buffer, isError: boolean) => { const value = data.toString('utf8'); if (isError) stderr += value; else stdout += value; if (stdout.length+stderr.length > 8*1024*1024) { stream.close(); if (!settled) { settled=true;clearTimeout(timer);reject(new Error('输出超过 8MB，请缩小查询范围')); } return; } options.onData?.(value); };
        stream.on('data',(d: Buffer) => collect(d,false)); stream.stderr.on('data',(d: Buffer) => collect(d,true));
        stream.on('error',(e: Error) => { if (!settled) { settled=true;clearTimeout(timer);reject(e); } });
        stream.on('close',(code: number) => { if (settled) return; settled = true; clearTimeout(timer); if (code !== 0 && !options.allowFailure) reject(new Error((stderr || stdout || `远端退出码 ${code}`).slice(-5000))); else resolve({stdout,stderr,code:code ?? -1}); });
        const profile=this.store.secret<ServerInput>(id);
        const context=[profile?.toolPath?`export PATH=${q(profile.toolPath)}:$PATH`:'',profile?.dockerHost?`export DOCKER_HOST=${q(profile.dockerHost)}`:'',profile?.dockerConfig?`export DOCKER_CONFIG=${q(profile.dockerConfig)}`:''].filter(Boolean).join('\n');
        stream.end('set -eo pipefail\nexport LC_ALL=C\n' + context+'\n'+script + '\n');
      });
    });
  }
  async sftp(id: string) { return new Promise<SFTPWrapper>((resolve,reject) => this.get(id).client.sftp((e,s) => e ? reject(e) : resolve(s))); }
  async upload(id: string, local: string, remote: string, step?: (transferred: number,total: number) => void) { const sftp = await this.sftp(id); try { await new Promise<void>((resolve,reject) => sftp.fastPut(local,remote,{ mode: 0o600, step: (a,_b,c) => step?.(a,c) },e => e ? reject(e) : resolve())); } finally { sftp.end(); } }
  async download(id: string, remote: string, local: string) { const sftp = await this.sftp(id); try { await new Promise<void>((resolve,reject) => sftp.fastGet(remote,local,e => e ? reject(e) : resolve())); } finally { sftp.end(); } }
  async inventory(id: string): Promise<Inventory> {
    const result = await this.exec(id, `
echo __OS__; cat /etc/os-release 2>/dev/null || true
echo __ARCH__; uname -m
echo __PKG__; for p in apt-get dnf yum; do if command -v "$p" >/dev/null; then echo "$p"; break; fi; done
echo __SERVICES__; systemctl list-units --type=service --all --no-legend --plain --no-pager 2>/dev/null || true
echo __DOCKER__; if command -v docker >/dev/null; then echo AVAILABLE; docker ps -a --format '{{json .}}' 2>&1 || true; fi
echo __PORTS__; ss -tulnp 2>&1 || true
echo __NGINX__; if command -v nginx >/dev/null; then echo AVAILABLE; nginx -T 2>&1 || true; fi
echo __JAVA__; java -version 2>&1 || true
echo __NODE__; node --version 2>/dev/null || true
echo __PYTHON__; python3 --version 2>/dev/null || true
echo __DOTNET__; dotnet --version 2>/dev/null || true
`, { elevated: this.get(id).privileged });
    const parts: Record<string,string> = {}; const re = /__(\w+)__\r?\n([\s\S]*?)(?=__\w+__\r?\n|$)/g; let match;
    while ((match = re.exec(result.stdout))) parts[match[1]] = match[2].trim();
    const os = Object.fromEntries((parts.OS || '').split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,'')]; }));
    const services: Service[] = (parts.SERVICES || '').split('\n').filter(l => /\.service\s/.test(l)).map(l => { const [name,_loaded,active,sub,...desc] = l.trim().split(/\s+/); return {name,active,sub,description:desc.join(' ')}; });
    const containers = (parts.DOCKER || '').split('\n').filter(l => l.startsWith('{')).flatMap(l => { try { return [JSON.parse(l)]; } catch {return [];} });
    const config = parts.NGINX || ''; const includes = [...config.matchAll(/^\s*include\s+([^;]+);/gm)].map(m => m[1].trim());
    const include = includes.find(p => p.endsWith('/conf.d/*.conf')) || includes.find(p => p.endsWith('/sites-enabled/*'));
    return {os:os.PRETTY_NAME || 'Linux',version:os.VERSION_ID || '',arch:parts.ARCH,packageManager:parts.PKG,services,containers,ports:parts.PORTS,nginx:config.startsWith('AVAILABLE'),docker:(parts.DOCKER || '').startsWith('AVAILABLE'),java:parts.JAVA,node:parts.NODE,python:parts.PYTHON,dotnet:parts.DOTNET,nginxConfig:config.slice(0,200000),nginxInclude:include,errors:[]};
  }
  async sample(id: string): Promise<Metric> {
    const r = await this.exec(id, `head -n 1 /proc/stat; echo __MEM__; cat /proc/meminfo; echo __DISK__; df -Pk / | tail -n 1; echo __NET__; cat /proc/net/dev; echo __UP__; cat /proc/uptime; cat /proc/loadavg`,{timeout:15000});
    const [cpu,mem,disk,network,up] = r.stdout.split(/__(?:MEM|DISK|NET|UP)__\r?\n/);
    const nums = cpu.trim().split(/\s+/).slice(1).map(Number); const total = nums.slice(0,8).reduce((a,b)=>a+b,0); const idle = nums[3]+nums[4];
    const memory = Object.fromEntries([...mem.matchAll(/^(\w+):\s+(\d+)/gm)].map(m => [m[1],Number(m[2])*1024]));
    const d = disk.trim().split(/\s+/); let rx=0,tx=0;
    for (const line of network.split('\n')) if (line.includes(':') && !/^\s*lo:/.test(line)) { const n = line.split(':')[1].trim().split(/\s+/).map(Number); rx+=n[0];tx+=n[8]; }
    const c = this.get(id); const previous=c.previous; const now=Date.now(); const elapsed=previous ? Math.max((now-previous.at)/1000,0.1):1;
    const uptime = Number(up.trim().split(/\s+/)[0]); const metric: Metric = { time:now,cpu:previous ? Math.max(0,Math.min(100,100*(1-(idle-previous.idle)/Math.max(total-previous.total,1)))):0,memory:100*(1-(memory.MemAvailable ?? memory.MemFree)/memory.MemTotal),memoryTotal:memory.MemTotal,memoryUsed:memory.MemTotal-(memory.MemAvailable ?? memory.MemFree),disk:Number(d[4]?.replace('%','')) || 0,diskTotal:Number(d[1])*1024,diskUsed:Number(d[2])*1024,rx:previous ? Math.max(0,(rx-previous.rx)/elapsed):0,tx:previous ? Math.max(0,(tx-previous.tx)/elapsed):0,load:up.trim().split('\n')[1]?.split(' ').slice(0,3).join(' / ') || '',uptime:`${Math.floor(uptime/86400)} 天 ${Math.floor(uptime%86400/3600)} 小时` };
    c.previous = {total,idle,rx,tx,at:now}; this.store.metric(id,metric); return metric;
  }
  async tunnel(id: string,host: string,port: number,socketPath?:string) {
    const c=this.get(id); const sockets=new Set<net.Socket>();
    const server=net.createServer(socket => {
      let forwarded:ClientChannel|undefined;sockets.add(socket);
      socket.on('close',()=>{sockets.delete(socket);forwarded?.destroy();});socket.on('error',()=>{});
      const connected=(e:Error|undefined,stream:ClientChannel)=>{
        if(e)return socket.destroy(e);forwarded=stream;stream.on('error',()=>socket.destroy());stream.on('close',()=>socket.destroy());
        if(socket.destroyed){stream.destroy();return;}socket.pipe(stream).pipe(socket);
      };
      try{if(socketPath)c.client.openssh_forwardOutStreamLocal(socketPath,connected);else c.client.forwardOut('127.0.0.1',0,host,port,connected);}catch(error){socket.destroy(error as Error);}
    });
    await new Promise<void>((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
    return {port:(server.address() as net.AddressInfo).port,close:()=>{for(const s of sockets)s.destroy();server.close();}};
  }
  close() { for (const id of [...this.connections.keys()]) this.disconnect(id); }
}
