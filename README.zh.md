# dsh-npm

[DeepSeek Harness](https://github.com/deepseek-ai/dsh) 的 NPM 包管理插件：查包信息、列版本、搜索 registry、发布包、标记弃用，全部可由 agent 直接完成。

- **查询类工具**直接走 npm registry JSON API（不需要本地 npm，公共包无需认证）。
- **发布 / 弃用**调用本地 `npm` CLI，复用你自己 `~/.npmrc` 的登录凭据——也可以在插件里配置一个 token。

## 工具

| 工具 | 用途 |
|---|---|
| `npm_status` | 插件状态：生效 registry、token 是否配置、本机 npm CLI 是否可用、配置路径 |
| `npm_config` | 配置 registry 基础地址和/或 auth token（存 `~/.dsh/dsh-npm.json`，权限 0600）；`reset: true` 清除 |
| `npm_info` | 包元数据：最新版本、dist-tags、描述、作者、license、主页、仓库、创建/更新时间、依赖摘要 |
| `npm_versions` | 全部已发布版本及发布时间（dist-tags.latest 置顶）——发布前先查 |
| `npm_search` | 按关键词搜索 registry（名称、描述、作者、相关度） |
| `npm_publish` | 真实执行 `npm publish`：支持 `dir`、`tag`、`access`、`otp`、`registry`、`dryRun`、`force` |
| `npm_deprecate` | 标记包/版本弃用（真实写入 registry，请谨慎） |

## 安装

```bash
# 本地开发（link 方式）
dsh plugin --profile web add link:/path/to/dsh-npm

# 发布到 GitHub 后（仓库打上 dsh-plugin topic）
dsh plugin --profile web add github:zhengjy01/dsh-npm
```

安装后需重启 DSH web 服务（无热重载）。

## Web 设置面板

插件自带 Web 设置页「设置 → NPM」面板：可视化配置 registry / token（token 掩码显示，存 0600 文件），
并提供快捷查包（等价 npm_info）与快捷搜索（等价 npm_search），无需命令行。
Host 路由：`/api/dsh-npm/config`、`/api/dsh-npm/info`、`/api/dsh-npm/search`（仅 loopback）。

## 认证模型

- **查询公共包**：无需任何配置。
- **发布**：`npm publish` 子进程读取你正常的 `~/.npmrc`（`npm login` 一次即可）。
- **Token**（可选）：用 `npm_config` 的 `token=…` 配置；存于 `~/.dsh/dsh-npm.json`（0600），发布/弃用通过**临时 userconfig 文件**注入（绝不出现在命令行或日志），查询私有包时作为 Bearer 头使用。任何输出都不回显完整 token（只显示掩码）。
- **Registry**：默认 `https://registry.npmjs.org/`；可在调用时传 `registry` 参数，或全局 `npm_config registry=…` 配置（私有 registry / 镜像场景）。

## 安全说明

- `npm_publish` 会真实上传到 registry。发布前请先用 `npm_info` / `npm_versions` 确认版本号不存在，建议先 `dryRun: true` 预检。
- `force: true` 会覆盖已发布版本（npm 默认拒绝）——危险操作。
- `npm_deprecate` 会写入永久弃用说明，展示给所有安装者。

## 开发

```bash
pnpm install
pnpm build      # tsc 声明 + tsdown 打包 → dist/index.mjs
pnpm test       # 冒烟测试（配置读写、真实 registry 查询、publish --dry-run）
```

## License

MIT
