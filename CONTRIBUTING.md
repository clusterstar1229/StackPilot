# 参与开发

使用 Node.js 22.12+ 和 Git，执行 `npm ci`、`npm test`、`npm run build`。Windows 上用 `npm run dev` 启动桌面，`npm run dist` 生成安装包。

正式测试放在 `tests`。SSH、部署和数据库改动附上复现步骤与对应验证记录。测试示例使用演示数据，日志经脱敏后提交。集成步骤见 [测试说明](tests/README.md)。

问题记录包含软件版本、Windows 版本、目标 Linux、运行方式、操作步骤和日志。功能修改说明具体触发条件、最终行为和验证结果。

项目采用 MIT。提交第三方依赖时补充许可证记录，执行 `npm run notices` 更新依赖清单。项目参考资料放在 `docs/REFERENCES.md`。
