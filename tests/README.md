# 测试说明

## 源码回归

```powershell
npm ci
npm test
npm run build
```

17 项正式回归使用本机 SSH2 服务与认证 Git HTTP 服务，验证 PTY、Unicode、输入、尺寸、Commit、凭据保存、产物识别、配置和端口。开发测试需要 Git。

GitHub 的 Source checks 在临时 Windows/Ubuntu 测试机执行回归与源码编译。正式安装包由下载站提供。

## SSH 与 Compose 集成

在启动 Docker Desktop 的 Windows 终端执行：

```powershell
docker pull python:3.13-slim
docker pull alpine:3.21
docker build --label stackpilot.fixture=v0.2.0 -t stackpilot-qa-fixture:0.2.0 tests/integration/fixture
$env:STACKPILOT_TEST_REPORT="$PWD/integration-results.json"
npm run test:integration
docker image rm stackpilot-qa-fixture:0.2.0
```

fixture 使用随机 SSH 口令、私有 cgroup namespace 和独立内层数据卷。外层容器分配 privileged 以运行容器引擎。测试完成后删除对应容器、卷和临时文件。

13 项检查覆盖镜像构建、SSH 导入、蓝绿、回滚、失败恢复、Compose 多服务及相对文件、配置复用、嵌套 dist 和 SPA 子路径。

## 构建方案实测

```powershell
$env:STACKPILOT_PROFILE_REPORT="$PWD/profiles-results.json"
npm run test:profiles
```

脚本下载构建环境与依赖，运行 React/Vite、Node.js、Next.js SSR、FastAPI、Go、ASP.NET Core、Spring Boot/Maven、PHP 和内容子目录用例。可用 `STACKPILOT_PROFILES=next,python` 选择项目。生成的标签和容器随测试清理；基础镜像和构建缓存按本次使用记录清理。

## 桌面流程

```powershell
npm run build
npm run test:ui
```

Windows 桌面测试使用独立工作区和本机 Git HTTP 服务，检查模式切换、源码拉取、构建、修改选项再次构建和产物进入发布向导。需要 Git 和 Docker Desktop。

`STACKPILOT_UI_REPORT_DIR` 设置截图与记录位置；传入解包后的 exe 可检查安装载荷；`STACKPILOT_UI_SKIP_BUILD=1` 选择布局和启动检查。
