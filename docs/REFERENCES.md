# 参考项目与接口文档

查阅日期：2026-11-10—11。项目对比和实现路径见 [0.2.0 报告](V0.2-REPORT.md)。

| 来源 | 对应内容 |
|---|---|
| [Electerm](https://github.com/electerm/electerm) | 桌面终端、SSH/SFTP 与远端文件交互 |
| [1Panel](https://github.com/1Panel-dev/1Panel) | 网站、数据库、主机与备份的资源组织 |
| [Coolify](https://github.com/coollabsio/coolify) | Git、应用、服务器、发布历史和健康检查 |
| [Dokploy](https://github.com/Dokploy/dokploy) | 多语言、Compose、多服务与应用模板 |
| [Kamal](https://github.com/basecamp/kamal) | 客户端 SSH 与容器发布流程 |
| [CapRover](https://github.com/caprover/caprover) | 应用入口、Nginx 与证书配置 |
| [ssh2](https://github.com/mscdex/ssh2) | SSH、SFTP、PTY、forwardOut 与跳板连接 |
| [xterm.js](https://github.com/xtermjs/xterm.js) | 终端渲染、输入与窗口尺寸 |
| [isomorphic-git clone](https://isomorphic-git.org/docs/en/clone) | HTTP(S) 拉取、ref、onAuth 和进度 |
| [Electron](https://www.electronjs.org/docs/latest/tutorial/security) | 主进程、渲染沙箱与 IPC |
| [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) | Windows 本地凭据加密 |
| [Nginx core](https://nginx.org/en/docs/http/ngx_http_core_module.html) | server、location、alias 和 try_files |
| [Certbot](https://eff-certbot.readthedocs.io/en/stable/using.html) | webroot HTTP-01、续期和部署 hook |
| [Cloudflare DNS API](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/create/) | Zone 查询与 A/AAAA 记录 |
| [DNSPod TC3](https://cloud.tencent.com/document/product/1427/56189) | 请求签名和解析 API |
| [MongoDB mongodump](https://www.mongodb.com/docs/database-tools/mongodump/) | archive 备份和压缩 |
| [MongoDB currentOp](https://www.mongodb.com/docs/manual/reference/operator/aggregation/currentop/) | 活动操作查询 |
| [Docker Engine](https://docs.docker.com/reference/cli/dockerd/) | Socket、数据目录与容器运行参数 |

StackPilot 业务源码使用 MIT。依赖包的名称、版本和许可证记录在 `THIRD_PARTY_NOTICES.json`，对应 LICENSE 随依赖包提供。
