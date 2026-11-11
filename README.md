# 栈桥 StackPilot 0.2.0

[源码仓库](https://github.com/clusterstar1229/StackPilot) · [Windows 安装包下载](http://47.109.34.123:18080/) · [版本记录](CHANGELOG.md)

面向个人管理数台服务器的 Windows 桌面运维工作台。安装 exe 后双击运行，通过 SSH 连接 Linux；Electron 内置执行层自动启动，远端不安装管理面板。简体中文、浅色界面。

## 0.2.0 的实际新增

- **两种工作方式**：简洁模式使用部署向导和概览；专业模式使用应用资源表、YAML 配置、日志/版本检查器及完整交互终端。
- **真实 SSH PTY**：多会话、Ctrl+C、方向键、交互程序、窗口尺寸同步、切页保留会话。终端命令由操作者控制。
- **Git / 本机源码 → 本机 Docker 构建 → SSH 交付**：HTTP(S) 分支拉取、临时 Token、提交号追溯；目标服务器接收镜像归档后直接运行，不参与编译。
- **12 个构建方案**：静态前端、Node.js、Next.js、Nuxt、Maven、Gradle、Python、Go、.NET、PHP、Dockerfile、Compose。命令、子目录、输出目录和端口可修改。
- **产物检测**：区分源码和 dist、SSR 和静态站点，识别 JAR/WAR/Compose/.NET 发布包等，提供配置建议。
- **可复用配置**：YAML 导入/导出；修改已部署应用时复用远端产物，不必重新选择本机文件。导出配置不包含本机文件 ID、服务器 ID 或环境变量值。
- **Compose 完整交付**：在本机构建/拉取服务镜像，连同相对挂载配置一起打包，再在服务器导入运行。
- 保留正式回归测试和 GitHub CI，安装包不包含测试、样包或测试数据。

真实增量、开源项目对比与覆盖边界见 [0.2.0 报告](docs/V0.2-REPORT.md)。这些是相对 StackPilot 0.1.2 的工程增量，不宣称 Git 部署、终端或无 Agent 部署为行业首创。

## 界面

以下为显式演示工作区，均非真实业务数据。

**专业模式：应用资源、配置和发布历史。**

![专业工作台](docs/images/professional.png)

**简洁模式：资源概览和引导操作。**

![简洁模式](docs/images/guided.png)

## 开始使用

1. 安装 `StackPilot-Setup-0.2.0-x64.exe`，双击桌面快捷方式。
2. 添加服务器，填写 IP/主机名、用户名及密码或私钥。**SSH 端口可留空**，按标准 22 连接；GPU 平台等端口映射场景填写实际端口。可配置跳板机、HTTP CONNECT / SOCKS5。
3. 核验首次 SSH 主机指纹后连接。首次启动是真实空工作区，演示需单独开启并明确标记。
4. 选择“上传发布包”，或“Git / 源码构建”。成品包部署不要求本机安装 Docker；本机构建源码需要已启动的 Docker Desktop。
5. 按向导设置网站、端口、域名、API 代理和运行参数，检查计划后发布，在任务中心查看结果。
6. 专业模式可直接编辑应用 YAML、查看日志和发布历史，或打开交互终端处理自定义工作。

安装包尚未进行商业代码签名。正式服务由 systemd / Docker 管理，关闭桌面不停止服务；本地监控和终端会在退出桌面后停止。

## 能力与范围

| 模块 | 当前能力 |
|---|---|
| SSH | 多服务器/分组、密码/私钥、跳板机、代理、可选端口、指纹记录、SFTP、隧道 |
| 前端托管 | dist 文件夹、ZIP、tar/tgz、SPA、子路径、缓存、Gzip、多域名、多 API 代理、WebSocket |
| 运行包 | JAR、可执行 WAR、Node.js、Python、Linux 二进制、.NET、Docker 镜像、Compose |
| 源码 | 上述 12 个可修改方案；单服务镜像与 Compose 多服务归档交付 |
| 发布 | systemd / Docker、启动参数/环境/工作目录、资源限制、健康检查、历史、失败恢复、蓝绿/多实例 |
| 数据库 | MySQL/MariaDB、PostgreSQL、Redis、MongoDB、SQLite；连接/查询/浏览、受控编辑、安装、账号与权限、备份及部分恢复/升级/复制模板 |
| 网站网络 | Nginx、Cloudflare/DNSPod/阿里云 DNS API、HTTP-01 证书及续期、上传证书、可选强制 HTTPS |
| 主机 | 发现当前账号可见的 systemd 服务、Docker 容器、端口/进程/文件；启停、日志与配置管理 |
| 监控 | 资源曲线、应用 HTTP 检查、本地通知、应用归档、定时备份、任务与审计 |

“发现现有服务”不等于自动把任意历史项目改造成有发布历史的托管应用。未知项目的构建命令、数据目录、凭据和依赖仍需人工核对。不能承诺所有发行版、所有应用和全部运维问题自动解决。

## 本轮测试

2026-11-11，Windows + Docker Desktop 29.6.2 / Compose 5.3.1：

- 17 项正式回归通过，包含真实 SSH2 PTY、认证 Git HTTP 拉取、秘密不进入导出配置、源码/产物识别和端口处理。
- 隔离 Linux SSH / Docker 集成覆盖镜像构建与上传导入、蓝绿、历史回滚、启动失败恢复、Compose 多服务/配置、复用发布、嵌套 dist 和 SPA 子路径。
- 8 个模板实际构建并通过 HTTP 请求：React/Vite、Node.js、Next.js SSR、FastAPI、Go、ASP.NET Core 8、Spring Boot 3.5.7 / Maven / Java 21、PHP 8.3。
- 原 Ubuntu 24.04.2 低内存主机仅执行轻量隔离回归；纳入检查的原服务进程、重启记录和文件校验值均不变，原业务响应保持一致，测试实例已清理。

0.1.2 的数据库、JAR 与 Docker 71 项历史验证单独保留在 [历史验证记录](docs/V0.1.2-VALIDATION.md)，不能算作本轮重新执行。Gradle、Nuxt、普通 WAR 及未列出的框架/发行版组合不据此宣称已实测。

复现步骤见 [tests/README.md](tests/README.md)。GitHub CI 配置已提供；实际云端运行结果见 [Actions](https://github.com/clusterstar1229/StackPilot/actions)。

## 需要知道的限制

- 桌面目前只交付 Windows x64，自动化主要面向有 systemd 的 Linux。Ubuntu 24.04 已实测；其他 Ubuntu、CentOS/RHEL 的软件源及服务布局需验证。
- 本机构建默认使用当前 Docker 的 Linux 架构；ARM、多架构、GPU/CUDA、特殊系统库需要项目 Dockerfile 与相应构建环境。镜像归档单文件上限 2GB。
- Git 当前为 HTTP(S)，不自动处理 Git LFS 和子模块；可以先在本机检出完整源码再选择文件夹。复杂 monorepo、pnpm/yarn workspace、私有依赖源需调整命令或 Dockerfile。
- SSR 需要后端运行，不能把 Next/Nuxt 直接当普通 dist。Python 复杂 pyproject/Poetry 项目需配置依赖命令；PHP 额外扩展和 Laravel 密钥/迁移需按项目设置。
- 源码 Java 默认 Java 21，.NET 默认 8，Node 默认 22；其他版本可使用项目 Dockerfile。原生 Java 可选择独立 Java Home。
- 普通 WAR 使用 Docker/Tomcat 10（Jakarta）；旧 javax 项目需要兼容容器。原生 WAR 仅适用于可执行 WAR。Windows exe 不能直接作为 Linux 产物运行。
- Docker Compose 需要目标服务器具备 Docker Compose；按可信项目的挂载和网络配置执行。自动回滚恢复程序/配置，不回滚外部数据库或业务卷的数据。
- 数据库自动安装需要已有 Docker。自动升级只处理本系统创建的独立容器及同主版本升级；复制模板在同主机，不能替代跨主机故障容灾。
- 通用恢复入口支持关系型单库 SQL/SQL.GZ 和 SQLite，创建新目标；Redis/MongoDB 二进制恢复使用引擎工具。数据库能力不覆盖所有引擎和所有集群形态。
- 自动 DNS 需要域名解析权限，备案号不能替代授权。自动证书使用 HTTP-01，需要正确解析及公网 80 可达；泛域名可上传已有证书。
- 专业终端是完整 Shell。图形界面保留基础确认、凭据加密和文件备份，不提供服务器重启/删库/删卷按钮。

## 已有业务的隔离方式

需要在已有业务主机验证时，使用全新应用名、专用根目录和空闲端口，选择“临时隔离 Nginx”，关闭“安装缺失环境”。它只监听本机，使用独立配置/PID/日志，通过 SSH 隧道预览，不 reload 系统 Nginx。

工作区默认 `%APPDATA%\StackPilot\workspace`，凭据与保存的环境变量通过当前 Windows 账户 DPAPI 加密。也可用 `StackPilot.exe --user-data-dir=C:\自选绝对路径` 指定独立工作区。

## 源码开发与开源交付

```powershell
npm ci
npm test
npm run dev
```

```powershell
npm run build
npm run notices
npm run dist
```

开发需要 Node.js 22.12+。`npm run dist` 在上一级“安装包”生成 NSIS exe。终端用户不需要安装 Node.js。

`src` 为界面，`electron` 为本地执行层，`shared` 为模型和检测，`tests` 为正式回归与可选 Docker 集成，`.github/workflows` 为 CI。

开源计划为 **GitHub 存源码、独立静态下载服务存安装包**。本源码包已经包含 MIT、贡献说明、依赖许可证记录及 CI；公开仓库为 [clusterstar1229/StackPilot](https://github.com/clusterstar1229/StackPilot)，安装包由上方独立下载站提供。

参考见 [REFERENCES.md](docs/REFERENCES.md)。本项目未复制对比面板的业务源码；依赖遵循各自 LICENSE，记录见 `THIRD_PARTY_NOTICES.json`。
