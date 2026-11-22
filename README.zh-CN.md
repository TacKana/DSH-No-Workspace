# DSH 无工作区对话

<p align="center">
  <strong>一个为 DeepSeek Harness (DSH) 设计的插件：每次新建对话自动分配独立工作目录，无需提前选择工作区。</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> · 简体中文
</p>

---

## 这个软件是做什么的

**DSH 无工作区对话**（`@neoxuxo/dsh-no-workspace`）是一个为 **DeepSeek Harness (DSH)** 开发的插件，用于在每次新建对话时自动分配独立的工作目录，无需提前手动创建或选择工作区：

- **开箱即用的独立目录**：在 DSH 侧边栏点击全局「新建会话」或使用原生快捷键即可直接输入并发送消息。插件会在后台为该对话自动创建 `dsh-chat-<会话 ID>` 文件夹作为工作目录。
- **保持工作区列表整洁**：自动创建的目录会作为 DSH 原生会话的工作目录保存，会话归类在「未分组」中，不会添加到侧边栏的工作区列表或工作区计数里。空白对话顶部的目录标签显示「不在工作区中工作」，不会暴露底层目录名。
- **智能复用与文件保留**：在尚未发送消息的空白对话中再次点击「新建会话」，会继续复用当前对话，不会重复建目录；发送第一条消息后再新建才会获得新目录。归档会话或停用插件后，磁盘上的文件都会保留。
- **随时切出当前工作区**：当对话处于某个工作区中时，点击顶部目录标签打开工作区选择器，会在「添加工作区」正上方多出「不使用工作区」选项，选中后当前对话会切换到新的独立目录并自动聚焦输入框。

## 运行环境与依赖

| 项目 | 说明 |
| :--- | :--- |
| **宿主应用** | DeepSeek Harness (DSH)，已在 **DSH `0.2.2-rc.5`**（Windows 桌面版 / CLI）验证 |
| **插件架构** | 双端插件：主机端（Node.js / Cordis 服务，通过 `cordis.patch.yml` 注入）+ Web 客户端（`@deepseek-ai/dsh-client-ui-workspace`） |
| **构建与开发环境** | Node.js（推荐 v22+）、npm、TypeScript、esbuild |

## 安装方法

### 方式一：在 DSH 界面中安装（推荐）

1. 打开 DSH 的「插件」页面，点击右上角 **+ 添加插件**。
2. 在输入框中填入 npm 包名：
   ```text
   @neoxuxo/dsh-no-workspace
   ```
3. 点击 **安装** 即可。

> 更新版本时，请先在插件页面卸载旧版后再重新安装。

### 方式二：通过命令行 / Release 安装包

也可以使用 DSH CLI 从 npm 安装，或下载 [GitHub Releases](../../releases) 中的 `.tgz` 安装包安装：

```powershell
# 从 npm 安装
dsh plugin add @neoxuxo/dsh-no-workspace

# 或使用下载的 .tgz 安装包（必须使用 file:，不能使用 link:）
dsh plugin add "file:$(Resolve-Path '.\neoxuxo-dsh-no-workspace-<版本号>.tgz')"
```

如需从源码自行构建打包：

```powershell
npm ci
npm run build
npm pack --ignore-scripts
```

## 插件配置

在 DSH 中打开「插件」→「无工作区对话」：

- **`root`**：设置主机上的绝对路径（例如 `D:\DSH\Chats`）作为会话目录的根目录。留空时默认使用当前 profile 下的 `session-workspaces` 目录。修改该设置仅对新创建的会话生效。

## 项目结构

```text
src/host/     主机端（Node.js）：入口、Cordis 服务、目录分配、错误处理
src/client/   浏览器端：入口与各职责模块（locale、identity、sessions、standalone、
              options、workspace-view、picker-menu、navigation）
types/        主机依赖（位于 DSH 安装目录内）的环境类型声明
scripts/      构建脚本（使用 esbuild 打包客户端）
dist/         构建产物：dist/host（tsc）与 dist/client/index.js（esbuild）
test/         测试：test/client/ 单元与集成测试，test/dev-*.mjs 端到端测试
```

## 开发与测试

源码采用严格模式 TypeScript（开启 `strict`、`noUncheckedIndexedAccess`、`noUnusedParameters`、`exactOptionalPropertyTypes` 等）：

```powershell
npm run build      # 编译主机端与客户端
npm run typecheck  # 两套 tsconfig 的严格类型检查
npm test           # 客户端单元测试 + Cordis 集成测试
```

- `test/client/cordis.integration.test.mjs` 会读取 DSH `app.asar` 内的 Cordis，需使用 `ELECTRON_RUN_AS_NODE=1` 配合 DSH 自带的 Node 运行；在未设置 `DSH_INSTALL_DIR` 的环境（如 CI）中会自动跳过。
- 安装到开发 profile 后，可运行 `npm run test:smoke` 验证主机端逻辑，或运行 `npm run test:browser` 进行真实浏览器端到端测试（可通过 `DSH_TEST_CHROME` 指定 Chromium 路径）。`node test/dev-smoke.mjs --default-root` 用于单独验证 `root` 留空时的默认目录回退行为。

## 已知限制

- 「不使用工作区」菜单项通过在原生选择器菜单打开时复制「添加工作区」一行并替换图标为 `dsw-icon-close-outline-regular` 实现；输入框聚焦调用 `conversation.input.focus()`，拦截逻辑包装了 `uiWorkspace.startSession` / `openWorkspace`。这些均属于 DSH 内部实现而非公开扩展点，DSH 升级后需重新验证。
- 如需更换菜单图标，修改 `src/client/options.ts` 中的 `NO_WORKSPACE_ICON` 常量并重新构建即可（运行 `node test/icon-gallery.mjs 图标.png` 可渲染 DSH 内置全部图标供挑选）。

## 许可协议

本项目采用 [Apache License 2.0](LICENSE)（`Apache-2.0`）开源协议。
