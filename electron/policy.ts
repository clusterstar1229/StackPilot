import crypto from 'node:crypto';
import { z } from 'zod';
import { ident, remotePathSchema, type DeploymentInput, type Plan } from '../shared/model';

export const q = (value: string | number) => "'" + String(value).replace(/'/g, "'\\''") + "'";
export const uid = () => crypto.randomUUID();
export function managedRoot(input: string) {
  remotePathSchema.parse(input);
  if (!/^\/[a-zA-Z0-9_./-]+$/.test(input)) throw new Error('应用目录仅支持英文、数字、下划线、点和横线');
  if (['/', '/etc', '/bin', '/sbin', '/usr', '/var', '/home', '/root', '/opt', '/srv', '/tmp', '/run', '/proc', '/sys', '/dev'].includes(input.replace(/\/$/, ''))) throw new Error('请选择专用应用目录，例如 /opt/stackpilot/apps');
  return input.replace(/\/+$/, '');
}
export const safeId = (v: string) => ident.parse(v);
export function checkArchiveEntry(name: string, type: string) {
  const clean = name.replaceAll('\\', '/');
  if (clean.startsWith('/') || /^[a-zA-Z]:/.test(clean) || clean.split('/').includes('..') || /[\x00-\x1f]/.test(clean)) throw new Error(`压缩包包含越界路径：${name}`);
  if (['SymbolicLink', 'Link', 'symlink', 'hardlink'].includes(type)) throw new Error('发布包不允许包含符号链接或硬链接');
  if (!['File','OldFile','Directory','ContiguousFile','file'].includes(type)) throw new Error('发布包不允许包含设备、管道、套接字或其他特殊文件');
}
export function readOnlySQL(sql: string) {
  if (sql.length > 50000) throw new Error('查询过长');
  const clean = sql.trim().replace(/;\s*$/, '');
  // No comments, stacked statements, system tables, stored functions, file access or writes.
  if (!/^(SELECT|SHOW|DESCRIBE|EXPLAIN\s+SELECT|PRAGMA\s+(table_info|index_list|database_list))\b/i.test(clean) || /;|--|\/\*|\*\//.test(clean) || /\b(INTO|OUTFILE|DUMPFILE|LOAD_FILE|SLEEP|BENCHMARK|PG_SLEEP|PG_READ_FILE|PG_WRITE_FILE|LO_IMPORT|LO_EXPORT|DBLINK|COPY|EXEC|EXECUTE|CALL|DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|CREATE|GRANT|REVOKE|ATTACH|DETACH|VACUUM|INSTALL|LOAD|READFILE|WRITEFILE|LOAD_EXTENSION)\b/i.test(clean)) throw new Error('SQL 工作台仅允许单条只读 SELECT / SHOW / DESCRIBE / EXPLAIN 查询；数据库删除及破坏性操作已禁用');
  return clean;
}
export function diagnosticCommand(value: string) {
  const cmd = value.trim();
  const exact = new Set(['uptime', 'df -h', 'free -m', 'uname -a', 'ss -tulnp', 'ps aux', 'docker ps', 'docker ps -a', 'systemctl --failed', 'nginx -t', 'whoami', 'ls -la /opt/stackpilot', 'cat /etc/os-release']);
  if (exact.has(cmd)) return cmd;
  if (/^systemctl status [a-zA-Z0-9_.@-]+(?: --no-pager)?$/.test(cmd)) return cmd + (cmd.includes('--no-pager') ? '' : ' --no-pager');
  if (/^journalctl -u [a-zA-Z0-9_.@-]+ -n (?:[1-9]\d?|[1-4]\d\d|500)$/.test(cmd)) return cmd + ' --no-pager';
  if (/^docker logs --tail (?:[1-9]\d?|[1-4]\d\d|500) [a-zA-Z0-9_.-]+$/.test(cmd)) return cmd;
  throw new Error('受限诊断终端仅允许界面提示的只读命令；任意 Shell、服务器重启和数据删除已禁用');
}
export function redact(text: string, secrets: string[] = []) {
  let result = text;
  for (const secret of secrets.filter(s => s.length >= 3).sort((a,b) => b.length-a.length)) result = result.split(secret).join('••••••');
  return result.replace(/((?:password|token|secret|authorization)[=:]\s*)[^\s,;]+/ig, '$1••••••');
}
export class Plans {
  private items = new Map<string, { plan: Plan; run: () => any; context: string }>();
  constructor(private context: () => string = () => '') {}
  create(title: string, target: string, steps: string[], impact: string, run: () => any): Plan {
    for (const [id, p] of this.items) if (p.plan.expiresAt < Date.now()) this.items.delete(id);
    const plan: Plan = { id: uid(), title, target, risk: 'medium', steps, impact, expiresAt: Date.now() + 5*60*1000 };
    this.items.set(plan.id, { plan, run, context: this.context() }); return plan;
  }
  async execute(id: string) {
    z.string().uuid().parse(id); const item = this.items.get(id); this.items.delete(id);
    if (!item || item.plan.expiresAt < Date.now()) throw new Error('操作计划已过期或已经使用，请重新预览');
    if (item.context !== this.context()) throw new Error('服务器连接或目标资源已发生变化，请重新预览并确认操作计划');
    return item.run();
  }
}
export function validateDeployment(d: DeploymentInput) {
  managedRoot(d.root);
  if(d.serviceUser==='root')throw new Error('应用运行账号不能使用 root');
  if(d.nginxMode==='isolated'&&d.listenAddress!=='127.0.0.1')throw new Error('隔离 Nginx 实例只允许本机监听，请选择 127.0.0.1');
  if(d.nginxMode==='isolated'&&d.autoStart)throw new Error('临时隔离实例用于按需预览，请关闭服务器开机自动运行');
  if (d.runtime === 'static' && d.engine === 'docker') throw new Error('静态网站使用宿主机 Nginx 托管，请选择原生方式');
  if (d.strategy === 'bluegreen' && !d.nginx) throw new Error('蓝绿发布需要 Nginx 切换上游');
  if (d.nginx && d.runtime !== 'static' && d.runtime !== 'compose' && d.listenPort >= d.port && d.listenPort < d.port+d.replicas) throw new Error('Nginx 对外监听端口不能与应用内部运行端口相同');
  if (d.nginx && d.strategy === 'bluegreen' && d.listenPort >= d.port+100 && d.listenPort < d.port+100+d.replicas) throw new Error('Nginx 监听端口不能占用蓝绿发布预留端口（应用端口 +100）');
  if (d.replicas > 1 && !d.nginx) throw new Error('多实例需要 Nginx 负载均衡');
  if (['static', 'compose'].includes(d.runtime) && (d.replicas > 1 || d.strategy === 'bluegreen')) throw new Error('静态网站以软链接原子切换；Compose 请在编排文件中定义副本，不能使用该蓝绿配置');
  if (d.runtime === 'image' && !d.image) throw new Error('请填写镜像名称');
  if (d.runtime !== 'image' && !d.artifactId && !d.reuseRelease) throw new Error('请选择发布包');
  if (d.port + d.replicas + 100 > 65535) throw new Error('多实例或蓝绿发布需要预留连续端口');
  if (d.runtime !== 'static' && d.engine === 'native' && !d.entry && !['jar','war','binary'].includes(d.runtime) && !d.startCommand) throw new Error('请填写启动入口文件');
}
