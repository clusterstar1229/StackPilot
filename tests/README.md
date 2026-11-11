# 回归测试

`npm test` 运行不依赖真实服务器的正式回归，包括真实 SSH2 协议/PTY 和带认证的本机 Git HTTP 服务。开发测试需要 Git；终端用户安装软件后拉取仓库不依赖系统 Git。

`npm run build` 包含 TypeScript 检查、前端及 Electron 主进程构建。GitHub CI 仅在临时 Windows 和 Ubuntu 测试机上执行回归与源码编译；不生成或上传安装包，不构建或推送 Docker/系统镜像。需要安装包时在 Windows 本机手动执行 `npm run dist`；正式下载仍由独立服务器提供。

## SSH / Compose 隔离集成

在已启动 Docker Desktop 的 Windows 终端执行：

```powershell
docker pull python:3.13-slim
docker pull alpine:3.21
docker build --label stackpilot.fixture=v0.2.0 -t stackpilot-qa-fixture:0.2.0 tests/integration/fixture
$env:STACKPILOT_TEST_REPORT="$PWD/integration-results.json"
npm run test:integration
docker image rm stackpilot-qa-fixture:0.2.0
```

测试只连接自己创建的 Linux 容器，使用随机口令、独立内层 Docker 数据卷和私有 cgroup namespace。外层 fixture 使用 privileged 运行 Docker-in-Docker；它是本机测试设施，不上传至业务服务器。测试结束删除自身容器、卷和临时文件。终止测试进程后如需手动清理，仅选择带 `stackpilot.test` 标签的本次测试容器及对应名称卷，不要全局 prune。

覆盖源码镜像经 SSH 导入、蓝绿切换、历史回滚、Compose 多镜像与相对配置、配置复用以及嵌套 dist/子路径 SPA。

## 语言构建模板实测

```powershell
$env:STACKPILOT_PROFILE_REPORT="$PWD/profiles-results.json"
npm run test:profiles
```

这会联网下载官方构建镜像及项目依赖，实际构建并请求 React/Vite、Node.js、Next.js SSR、FastAPI、Go、ASP.NET Core、Spring Boot/Maven 和 PHP。可用 `STACKPILOT_PROFILES=next,python` 选择部分场景。只删除测试自行生成的镜像标签/容器；共用的官方基础镜像保留给操作者按需清理。它不是所有框架、系统与架构的兼容性认证。

另有 `dockerfile` 场景验证运行包的内容子目录与入口一致。桌面检查可在 Windows 上先 `npm run build` 后运行 `npm run test:ui`，需要 Docker 和 Git。它使用独立工作区及本机临时 Git HTTP 服务，验证模式区别、源码拉取/构建、配置修改后重新构建与产物进入发布向导，不连接业务服务器。设置 `STACKPILOT_UI_REPORT_DIR` 可保存演示截图与结果；参数传入解包后的 exe 可检查实际安装载荷，`STACKPILOT_UI_SKIP_BUILD=1` 只检查桌面与布局。
