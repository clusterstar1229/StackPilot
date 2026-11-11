# 安装包静态下载服务

这是 Ubuntu 的参考配置，独立使用 `/etc/stackpilot-download/nginx.conf`、PID、日志和 systemd unit。它不写入系统 Nginx 的 include、不 reload 原 nginx.service，不上传桌面源码或构建环境。

安装包、版本 JSON、SHA256SUMS 和静态下载首页放在 `/srv/stackpilot-download`。仅 GET/HEAD 读取。监听 TCP 18080，64MB 内存/20% CPU，每连接 2MiB/s，最多八个活跃下载连接。

部署前检查端口和目录为空，按目标系统调整 nginx 路径与非特权用户。验证独立配置后，仅启动 `stackpilot-download.service`。云端规则只需允许公网 TCP 18080，必须先得到管理员确认；不修改 22/80/443 或现有站点规则。

公网地址为 `http://你的服务器IP:18080/`。这里使用 HTTP，不承载登录和凭据；以发行渠道提供的 SHA-256 核对安装包。配置域名和 TLS 是后续可独立执行的工作。

GitHub 仓库地址确定后，在静态下载页增加源码链接；源码 zip 不必放在这台服务器。
