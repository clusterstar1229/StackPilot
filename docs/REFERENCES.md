# 开源参考与接口依据

检索日期：2026-11-10—11。只借鉴功能组织和公开接口，不导入完整面板源码。本轮比较与真实增量见 [V0.2-REPORT.md](V0.2-REPORT.md)。

| 来源 | 借鉴或使用内容 | 许可证／说明 |
|---|---|---|
| [1Panel](https://github.com/1Panel-dev/1Panel) | 网站、数据库、主机资源和备份的组织方式 | 仓库 GPL-3.0；本项目未复制其代码 |
| [Coolify](https://github.com/coollabsio/coolify) | 将应用、服务器、部署历史与健康检查串联 | 仓库 Apache-2.0；本项目未引入其远程控制面 |
| [Dokploy](https://github.com/Dokploy/dokploy) | 多语言构建、Compose 与应用模板组织 | 只借鉴公开工作流 |
| [Electerm](https://github.com/electerm/electerm) | 桌面交互终端与远端文件工作方式 | 未复制业务代码 |
| [Kamal](https://github.com/basecamp/kamal) | 客户端 SSH/Docker 无 Agent 部署的已有实践 | 不把无 Agent 单独视为原创 |
| [CapRover](https://github.com/caprover/caprover) | 简化容器发布、Nginx 和证书配置 | 只借鉴公开工作流 |
| [xterm.js](https://github.com/xtermjs/xterm.js) | 真实终端渲染、输入和 FitAddon | MIT，作为依赖使用 |
| [isomorphic-git clone](https://isomorphic-git.org/docs/en/clone) | Node 中直接 HTTP(S) 拉取、ref、onAuth、进度 | MIT，作为依赖使用 |
| [ssh2](https://github.com/mscdex/ssh2) | 真正的 SSH、SFTP、forwardOut 隧道和跳板机 | MIT，作为依赖使用 |
| [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security) | 沙箱、contextIsolation、IPC 发送方校验、自定义协议与导航限制 | 官方实现依据 |
| [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) | Windows DPAPI 本地凭据加密 | 45.x 同步接口仍可用；将来升级 46 前需迁移到异步接口 |
| [Nginx core](https://nginx.org/en/docs/http/ngx_http_core_module.html) | server、location、alias、try_files 与静态子路径 | 官方配置文档 |
| [Certbot](https://eff-certbot.readthedocs.io/en/stable/using.html) | webroot HTTP-01、续期、deploy hook | 官方配置文档 |
| [Cloudflare DNS API](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/create/) | Zone 查询、A/AAAA 创建／更新 | API Token 授权 |
| [DNSPod TC3](https://cloud.tencent.com/document/product/1427/56189) | 腾讯云 TC3-HMAC-SHA256 请求签名 | API 2021-03-23 |
| [MongoDB mongodump](https://www.mongodb.com/docs/database-tools/mongodump/) | 私密 YAML config、压缩 archive 备份 | 官方工具文档 |
| [MongoDB $currentOp](https://www.mongodb.com/docs/manual/reference/operator/aggregation/currentop/) | 当前账号的活动操作诊断，固定只读聚合管道 | 官方接口文档 |
| [Docker dockerd](https://docs.docker.com/reference/cli/dockerd/) | 独立 socket、数据目录、cgroup 资源组与网络配置 | 官方守护进程参数 |
| [Docker 静态发行包](https://docs.docker.com/engine/install/binaries/) | 私有目录安装运行工具用于隔离验证 | 运行工具不打包进桌面安装包 |

React、Electron、ssh2、Lucide 等依赖及其传递依赖各自保留许可证。构建生成的 `THIRD_PARTY_NOTICES.json` 记录生产依赖的元数据；这不替代各依赖发行包内的 LICENSE。
