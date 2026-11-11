# 安装包下载服务

Ubuntu 下载服务使用独立的 `/etc/stackpilot-download/nginx.conf`、systemd unit、PID、日志和临时目录。

`/srv/stackpilot-download` 保存 Windows 安装包、版本 JSON、SHA256SUMS 和静态首页。服务监听 TCP 18080，使用 GET/HEAD 提供下载；内存上限 64MB、CPU 20%，每连接 2MiB/s，活跃下载连接数为八个。

部署时检查端口和目录，按主机设置 nginx 路径与运行账号。验证配置后启动 `stackpilot-download.service`，由管理员确认公网 TCP 18080 规则。

公网入口为 `http://服务器IP:18080/`，首页提供安装包、校验值和 GitHub 源码链接。该入口使用 HTTP；域名和 HTTPS 可按站点配置流程部署。

每次更新通过 SHA-256 核对安装包，并同步版本 JSON 与首页。仓库源码位于 GitHub。
