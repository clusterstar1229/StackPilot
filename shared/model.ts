import { z } from 'zod';

export const ident = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/, '仅允许英文、数字、点、横线和下划线');
export const portSchema = z.coerce.number().int().min(1).max(65535);
export const hostSchema = z.string().min(1).max(253).regex(/^[a-zA-Z0-9:.\-]+$/, '主机地址格式不正确');
export const remotePathSchema = z.string().min(2).max(500).refine(p => p.startsWith('/') && !p.split('/').some(s => s === '..') && !/[\x00-\x1f]/.test(p), '需要不含 .. 的绝对路径');
export const runtimeSchema = z.enum(['static', 'jar', 'war', 'node', 'python', 'binary', 'dotnet', 'image', 'compose']);
export type Runtime = z.infer<typeof runtimeSchema>;
export const runtimeNames: Record<Runtime, string> = { static: '静态网站', jar: 'Java JAR', war: 'Java WAR', node: 'Node.js', python: 'Python', binary: 'Go / 可执行程序', dotnet: '.NET', image: 'Docker 镜像', compose: 'Docker Compose' };
const sshPortSchema = z.preprocess(value => value === '' || value === null || value === undefined ? 22 : value, portSchema);
const authSchema = z.object({ host: hostSchema, port: sshPortSchema, username: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/), password: z.string().max(4000).optional(), privateKey: z.string().max(40000).optional(), passphrase: z.string().max(4000).optional() });
export const serverSchema = authSchema.extend({
  id: z.string().uuid().optional(), name: z.string().min(1).max(60), group: z.string().max(40).default('默认分组'), remember: z.boolean().default(true),
  toolPath: z.preprocess(v=>v===''?undefined:v,remotePathSchema.optional()),
  dockerHost: z.preprocess(v=>v===''?undefined:v,z.string().regex(/^unix:\/\/\/[a-zA-Z0-9_./-]+$/).refine(v=>!v.split('/').includes('..')).optional()),
  dockerConfig: z.preprocess(v=>v===''?undefined:v,remotePathSchema.optional()),
  jump: authSchema.optional(), proxy: z.object({ type: z.enum(['socks5', 'http']), host: hostSchema, port: portSchema, username: z.string().max(200).optional(), password: z.string().max(200).optional() }).optional()
});
export type ServerInput = z.infer<typeof serverSchema>;
export interface Server extends Omit<ServerInput, 'password' | 'privateKey' | 'passphrase' | 'jump' | 'proxy' | 'id'> {
  id: string; hasCredential: boolean; jump?: Omit<NonNullable<ServerInput['jump']>, 'password' | 'privateKey' | 'passphrase'>; proxy?: Omit<NonNullable<ServerInput['proxy']>, 'password'>;
  status: 'online' | 'offline' | 'connecting' | 'error'; error?: string; os?: string; arch?: string; hostname?: string; privileged?: boolean; fingerprint?: string;
}
export interface Metric { time: number; cpu: number; memory: number; memoryTotal: number; memoryUsed: number; disk: number; diskTotal: number; diskUsed: number; rx: number; tx: number; load: string; uptime: string }
export interface Service { name: string; description: string; active: string; sub: string; managed?: boolean }
export interface Container { ID: string; Names: string; Image: string; Status: string; Ports: string; State?: string }
export interface Inventory { os: string; version: string; arch: string; packageManager: string; services: Service[]; containers: Container[]; ports: string; nginx: boolean; docker: boolean; java: string; node: string; python: string; dotnet: string; nginxConfig: string; nginxInclude?: string; errors: string[] }
export const domainSchema = z.string().max(253).refine(s => s === '' || /^(?:\*\.)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(s), '请输入域名，不要带协议或路径');
export const deploymentSchema = z.object({
  serverId: z.string().uuid(), name: ident, runtime: runtimeSchema, artifactId: z.string().optional(),
  reuseRelease:z.boolean().default(false),imageArtifactId:z.string().optional(),sourceInfo:z.record(z.string(),z.any()).optional(),
  contentDir:z.string().max(300).refine(s=>!s.startsWith('/')&&!s.split('/').includes('..')&&!/[\x00-\x1f]/.test(s)).default(''),startCommand:z.string().max(6000).default(''),
  engine: z.enum(['native', 'docker']).default('native'), root: remotePathSchema.default('/opt/stackpilot/apps'), port: portSchema.default(8080), listenPort: portSchema.default(80),
  domains: z.array(domainSchema).max(30).default([]), route: z.string().regex(/^\/(?:[a-zA-Z0-9_./-]*)$/).refine(s => !s.includes('..')).default('/'),
  spa: z.boolean().default(true), gzip: z.boolean().default(true), cache: z.boolean().default(true),
  proxies: z.array(z.object({ path: z.string().regex(/^\/[a-zA-Z0-9_/-]*$/), target: z.string().url().refine(s => /^https?:\/\/[a-zA-Z0-9.\-:[\]]+(?::\d+)?\/?$/.test(s), '代理仅支持 HTTP(S) 主机和端口'), websocket: z.boolean().default(true) })).max(20).default([]),
  environment: z.record(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/), z.string().max(4000)).default({}),
  entry: z.string().regex(/^[a-zA-Z0-9_./-]*$/).refine(s => !s.includes('..') && !s.startsWith('/')).default(''), args: z.array(z.string().max(1000).refine(s => !/[\x00-\x1f]/.test(s))).max(40).default([]),
  javaVersion: z.enum(['8', '11', '17', '21', '25']).default('21'), memory: z.coerce.number().int().min(64).max(65536).default(512),
  javaHome: z.preprocess(v=>v===''?undefined:v,remotePathSchema.optional()),
  jvmArgs: z.array(z.string().max(1000).refine(v=>!/[\x00-\x1f]/.test(v))).max(40).default([]),
  cpuPercent: z.preprocess(v=>v===''||v===null?undefined:v,z.coerce.number().int().min(1).max(3200).optional()),
  systemdSlice: z.preprocess(v=>v===''?undefined:v,z.string().regex(/^[a-zA-Z0-9_.-]+\.slice$/).optional()),
  image: z.string().max(250).regex(/^[a-zA-Z0-9._/:@-]*$/).default(''), containerPort: portSchema.default(8080),
  healthPath: z.string().regex(/^\/[a-zA-Z0-9_/?.=&%-]*$/).default('/'), strategy: z.enum(['replace', 'bluegreen']).default('replace'), replicas: z.coerce.number().int().min(1).max(8).default(1),
  autoStart: z.boolean().default(true), installMissing: z.boolean().default(true), nginx: z.boolean().default(true),
  nginxMode: z.enum(['system','isolated']).default('system'), listenAddress: z.enum(['0.0.0.0','127.0.0.1']).default('0.0.0.0'),
  serviceUser: z.string().regex(/^[a-z_][a-z0-9_-]{0,30}$/).default('stackpilot'),
});
export type DeploymentInput = z.infer<typeof deploymentSchema>;
export interface Deployment extends DeploymentInput { id: string; appId: string; release: string; activePort: number; units: string[]; createdAt: number; status: 'running' | 'stopped' | 'failed' | 'unknown'; url: string; previousRelease?: string; history: { release: string; time: number; port: number; deployment?: DeploymentInput }[]; configPath?: string; tls?: boolean; tlsConfig?: {cert: string;key: string;force: boolean} }
export interface Task { result?:Record<string,any>; id: string; title: string; serverId?: string; serverName?: string; status: 'running' | 'success' | 'failed' | 'interrupted'; progress: number; stage: string; logs: string[]; createdAt: number; finishedAt?: number; error?: string }
export interface Audit { id: string; time: number; action: string; target: string; status: string; detail?: string }
export interface Plan { id: string; title: string; target: string; risk: 'medium'; steps: string[]; impact: string; expiresAt: number }
export type DatabaseType = 'mysql' | 'mariadb' | 'postgres' | 'redis' | 'mongodb' | 'sqlite';
export const databaseSchema = z.object({ id: z.string().uuid().optional(), serverId: z.string().uuid(), name: ident, type: z.enum(['mysql', 'mariadb', 'postgres', 'redis', 'mongodb', 'sqlite']), host: hostSchema.default('127.0.0.1'), port: portSchema.default(3306), username: z.string().max(100).default('root'), password: z.string().max(4000).optional(), database: z.string().regex(/^[a-zA-Z0-9_.-]*$/).default(''), authDatabase: z.string().regex(/^[a-zA-Z0-9_.-]*$/).optional(), file: remotePathSchema.optional(), socket: remotePathSchema.optional(), container: z.string().regex(/^[a-zA-Z0-9_.-]*$/).optional() });
export type DatabaseProfile = Omit<z.infer<typeof databaseSchema>, 'password' | 'id'> & { id: string; hasCredential: boolean };
export interface Artifact { id: string; name: string; size: number; directory: boolean; files?: number }
export interface FileEntry { name: string; size: number; directory: boolean; modified: number; mode: string; symlink: boolean }
export interface AppState { servers: Server[]; deployments: Deployment[]; tasks: Task[]; audit: Audit[]; databases: DatabaseProfile[]; settings: Settings; version: string }
export interface Settings { mode: 'beginner' | 'expert'; sampleInterval: number; retentionDays: number; launchAtLogin: boolean; notifications: boolean; dnsProviders: { id: string; provider: string; name: string }[] }
export const channels = ['terminal.open','terminal.list','terminal.write','terminal.resize','terminal.close','artifact.inspect','source.inspect','source.build','source.capability','recipe.import','recipe.export','state', 'server.save', 'server.remove', 'server.connect', 'server.disconnect', 'server.inventory', 'server.metric', 'server.history', 'artifact.select', 'deploy.preview', 'deploy.start', 'app.logs', 'app.action', 'app.rollback', 'service.plan', 'container.plan', 'files.list', 'files.read', 'files.writePlan', 'files.upload', 'files.download', 'diagnostic.run', 'database.save', 'database.query', 'database.plan', 'database.managePlan', 'database.lifecyclePlan', 'database.backup', 'dns.save', 'dns.plan', 'certificate.plan', 'firewall.plan', 'backup.plan', 'system.report', 'plan.execute', 'settings.save', 'audit.export', 'app.openUrl', 'app.openPreview', 'window.minimize', 'window.maximize', 'window.close'] as const;
export type Channel = typeof channels[number];
export interface DesktopAPI { invoke<T = any>(channel: Channel, payload?: any): Promise<T>; onChange(callback: (data: any) => void): () => void; desktop: boolean }
declare global { interface Window { stackpilot?: DesktopAPI } }
