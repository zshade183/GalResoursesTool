# 视觉小说素材工作室

个人 API Key、服务地址与账户配置保存在本机 `.env`，仓库只保留不含密钥的 `.env.example` 模板。请勿在模板或源码里填写真实密钥，也不要使用 `VITE_` 前缀保存密钥，因为前端环境变量会进入网页构建产物。

`.env` 及其变体、本地配置、数据库、`data`、`release`、`private`、`secrets`、`local-config` 均已加入 Git 忽略规则。便携打包也会过滤这些私人文件。Git 忽略规则不能移除已经提交的历史内容，也不能阻止强制添加文件。

视觉小说图片、视频、音频和 UI 素材的生成、管理与导出工具。

## 本地开发

要求：Node.js 22.13+、pnpm 11+。使用 Node 内置 SQLite，无需安装数据库或 Docker。

```bash
pnpm install
pnpm dev
```

- Web: http://127.0.0.1:5173
- API: http://127.0.0.1:3001
- 健康检查: http://127.0.0.1:3001/health

运行全部检查：

```bash
pnpm check
```

产品设计见《视觉小说素材工作室详细方案.md》，执行路线见《开发步骤.md》。

## 个人使用与分发

生成 Windows 便携包：`pnpm package:portable`。也可直接运行 `node scripts/package-portable.mjs`。

打包会先执行类型检查和构建，再生成独立的 `release/GalResourcesTool-时间戳/`。目录包含 `runtime/node.exe`、运行依赖、网页和空的 `data` 目录；不会复制现有作品或密钥。整个目录可压缩分享，接收者解压后双击 `启动.cmd`，无需安装 Node、pnpm 或数据库。仅支持与打包机器相同的 Windows 架构。

启动后访问 http://127.0.0.1:3001，窗口需保持开启，按 Ctrl+C 停止。退出后备份整个 `data` 目录。升级时先退出旧版本，将旧 `data` 目录复制到新包，保留旧包作为备份。

便携包内的运行环境与系统 Node 相互独立。开发依赖仍安装在项目内 `node_modules`；打包不需要全局安装额外工具。Node 许可随包附带；仓库中的备用许可对应 v22.17.0，其他版本需在 Node 安装目录提供匹配的 LICENSE。

```bash
pnpm install
pnpm build
pnpm start
```

打开 http://127.0.0.1:3001 即可使用，网页与 API 由同一进程提供。无需配置环境变量。作品自动保存至项目根目录的 `data/studio.sqlite`，重启后保留。退出程序后备份整个 `data` 目录即可迁移数据。

开发方向以单人、本地优先为主：SQLite + 本地素材目录 + 单服务。源码开发需要 Node，Windows 便携包已经内置运行环境，用户无需另外安装。

当前尚未加入登录权限，默认仅监听本机，不应直接开放至公网。Node 22 的内置 SQLite 会显示实验性提示。


## 本次功能与验证

模块配置、操作流程、测试结果和仍未完成的详细方案项目见 [实现与验收](实现与验收.md)。真实生成需要对应服务配置；本机版不具备公网团队权限。备份命令：`node scripts/backup.mjs`。
