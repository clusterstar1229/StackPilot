# 参与开发

使用 Node.js 22.12+，执行 `npm ci`、`npm test`、`npm run build`。Windows 上执行 `npm run dev` 启动桌面开发环境，`npm run dist` 生成安装包。

正式测试放在 `tests`。修改部署、SSH 或数据库功能时，请提交能够复现行为的测试；临时运行产物、真实服务器信息和凭据不提交。集成测试需要 Docker，见 [测试说明](tests/README.md)。

提交问题时请附版本、Windows 版本、目标 Linux 发行版、运行方式、复现步骤和去除凭据的日志。请不要在公开 issue 上传工作区凭据文件或完整业务备份。

本项目采用 MIT 许可证。请注明借鉴项目的设计思路与来源；引入第三方代码须满足其许可证，不把其他项目已有功能描述为本项目首创。修改依赖后运行 `npm run notices` 更新依赖记录。
