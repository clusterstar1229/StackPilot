import fs from 'node:fs';
import path from 'node:path';
import type { AppState, Metric, Settings, Task } from '../shared/model';
import { uid, redact } from './policy';
export interface Codec { encrypt(s: string): string; decrypt(s: string): string }
export class Store {
  state: AppState; private secrets: Record<string,string> = {}; private ephemeral = new Map<string, any>(); private metrics: Record<string, Metric[]> = {};
  constructor(readonly directory: string, private codec: Codec, private notify: (data?: any) => void) {
    fs.mkdirSync(directory, { recursive: true });
    this.state = this.read('workspace.json', { servers: [], deployments: [], tasks: [], audit: [], databases: [], settings: { mode: 'beginner', sampleInterval: 15, retentionDays: 7, launchAtLogin: false, notifications: true, dnsProviders: [] }, version: '0.1.0' });
    this.secrets = this.read('vault.json', {}); this.metrics = this.read('metrics.json', {});
    for (const server of this.state.servers) server.status = 'offline';
    for (const task of this.state.tasks) if (task.status === 'running') { task.status = 'interrupted'; task.error = '上次应用退出时任务仍在运行，请检查远端状态后重试'; task.finishedAt = Date.now(); }
    this.save();
  }
  private read<T>(file: string, fallback: T): T { const p = path.join(this.directory,file); if (!fs.existsSync(p)) return fallback; try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { throw new Error(`本地数据文件损坏：${p}。请先备份文件，再恢复历史副本；不会自动覆盖。`); } }
  private write(file: string, data: unknown) { const p = path.join(this.directory,file); fs.writeFileSync(p+'.tmp', JSON.stringify(data,null,2), { mode: 0o600 }); fs.renameSync(p+'.tmp',p); }
  save() { this.state.tasks = this.state.tasks.slice(0,200); this.state.audit = this.state.audit.slice(0,2000); this.write('workspace.json',this.state); this.notify(); }
  snapshot() { return structuredClone(this.state); }
  secret<T = any>(id: string): T | undefined { if (this.ephemeral.has(id)) return this.ephemeral.get(id); return this.secrets[id] ? JSON.parse(this.codec.decrypt(this.secrets[id])) : undefined; }
  setSecret(id: string, value: unknown, remember = true) { if (remember) { this.secrets[id] = this.codec.encrypt(JSON.stringify(value)); this.ephemeral.delete(id); } else { this.ephemeral.set(id,value); delete this.secrets[id]; } this.write('vault.json',this.secrets); }
  forget(id: string) { delete this.secrets[id]; this.ephemeral.delete(id); this.write('vault.json',this.secrets); }
  allSecrets() { return [...Object.keys(this.secrets), ...this.ephemeral.keys()].flatMap(id => { const data = this.secret(id); const walk = (v: any): string[] => Object.entries(v || {}).flatMap(([k,v]): string[] => typeof v === 'object' ? walk(v) : /password|passphrase|privateKey|token|secret/i.test(k) ? [String(v)] : []); return walk(data); }); }
  audit(action: string, target: string, status: string, detail?: string) { this.state.audit.unshift({ id: uid(), time: Date.now(), action, target, status, detail: detail ? redact(detail,this.allSecrets()) : undefined }); this.save(); }
  task(title: string, serverId?: string) { const task: Task = { id: uid(), title, serverId, serverName: this.state.servers.find(s => s.id === serverId)?.name, status: 'running', progress: 0, stage: '准备', logs: [], createdAt: Date.now() }; this.state.tasks.unshift(task); this.save(); return task; }
  log(task: Task, text: string, progress?: number, stage?: string) { task.logs.push(...redact(text,this.allSecrets()).split('\n').filter(Boolean)); task.logs = task.logs.slice(-1500); if (progress !== undefined) task.progress = progress; if (stage) task.stage = stage; this.save(); }
  finish(task: Task, error?: unknown) { task.finishedAt = Date.now(); task.status = error ? 'failed' : 'success'; task.error = error ? redact(error instanceof Error ? error.message : String(error),this.allSecrets()) : undefined; if (!error) task.progress = 100; task.stage = error ? '执行失败' : '已完成'; this.audit(task.title,task.serverName || '本地',task.status,task.error); }
  metric(id: string, metric: Metric) { const cutoff = Date.now()-this.state.settings.retentionDays*86400000; this.metrics[id] = [...(this.metrics[id] || []).filter(m => m.time > cutoff),metric].slice(-40320); this.write('metrics.json',this.metrics); this.notify({ type: 'metric', id, metric }); }
  history(id: string) { return this.metrics[id] || []; }
}
