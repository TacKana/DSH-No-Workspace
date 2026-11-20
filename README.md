# DSH 无工作区对话

在 DSH 侧边栏点击全局「新建会话」，或使用原生新建会话快捷键，就可以直接输入并发送消息。每个新会话都有独立的工作目录。在已有项目中工作时，点击该工作区旁的「新建会话」，也可以在空白对话的工作区选择器中切换项目。

## 会话目录

打开「插件」中的「无工作区对话」，将 `root` 设为主机上的绝对路径，例如 `D:\DSH\Chats`。留空时使用当前 profile 下的 `session-workspaces` 目录。修改设置后，只有新会话使用新位置。

插件在根目录内创建 `dsh-chat-<会话 ID>` 文件夹，将其保存为 DSH 原生会话的工作目录。会话出现在「未分组」中，自动目录不会加入工作区列表。空白对话顶部的目录标签显示「不在工作区中工作」，不会暴露文件夹名。刷新或重新打开会话后可以继续使用原目录。归档会话、停用插件都会保留磁盘上的文件。

在尚未输入内容的空白对话里再次点击「新建会话」，会继续使用当前对话，不会重复创建目录；发送第一条消息后再新建，才会获得新的独立目录。

对话顶部的目录标签可以点开工作区选择器，在各工作区之间切换；当对话属于某个工作区时，选择器底部「添加工作区」的正上方会多出「不使用工作区」（英文 `Use no workspace`）。选中后当前对话切换到新的独立目录，光标直接落在输入框里。这一项只存在于选择器菜单里：它不注册到主机，不写入磁盘上的工作区列表，也不出现在侧边栏或工作区计数中。自动目录本身始终不会出现在工作区列表中。

## 已知限制

「不使用工作区」这一项由插件在原生选择器菜单打开时复制「添加工作区」那一行生成，并换成关闭（✕）图标 `dsw-icon-close-outline-regular`，因此依赖 DSH 菜单的 DOM 结构、`data-icon` 名称和 Esc 关闭行为；DSH 改版后需要重新核对，若失效只是少一个入口，不影响会话本身。想换图标时改 `client/index.js` 里的 `NO_WORKSPACE_ICON` 常量即可，`node test/icon-gallery.mjs 图标.png` 会把 DSH 内置的全部图标渲染成一张带名称的图集供挑选。进入新对话后输入框的焦点来自 `conversation.input.focus()`，同样是内部接口。插件通过包装 `uiWorkspace.startSession` / `openWorkspace` 和读取会话列表工作，这些是内部实现而非公开扩展点，DSH 升级后应重新验证。

## 安装与启动

以下 PowerShell 命令针对开发 profile `dev_DSH-No-Workspace`。在安装包所在目录运行。若使用 Windows 桌面版且 `dsh` 未加入 PATH，可以使用桌面版随附的 CLI。

```powershell
$dsh = (Get-Command dsh -ErrorAction SilentlyContinue).Source
if (-not $dsh) {
  $dsh = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
}
$bundle = (Resolve-Path '.\local-dsh-no-workspace-0.1.0.tgz').Path
& $dsh plugin --profile dev_DSH-No-Workspace add "file:$bundle"
& $dsh --profile dev_DSH-No-Workspace
```

从源码打包时，在项目根目录运行 `npm pack --ignore-scripts` 即可生成上述安装包。插件包含主机和 Web 客户端两个入口，已在 DSH `0.2.2-rc.5` 中验证。客户端接入原生新建导航，并为自动会话的空白输入界面提供目录信息。DSH 的模型选择、权限和显式工作区导航仍由原生服务处理。

本插件必须用 `file:` 安装，不能用 `link:`：主机入口要 `import` DSH 自带的包，而 `link:` 会按真实路径加载、找不到 `node_modules`，接口会 404。升级本插件时若版本号未变，`add` 会说“Already up to date”而保留旧文件，应先 `remove '@local/dsh-no-workspace'` 再 `add`。

## 测试

在 DSH 提供的 Windows Shell 中，运行 `node client/index.test.mjs` 验证导航、目录识别和冷启动竞态。安装到开发 profile 后，`node test/dev-smoke.mjs` 用临时会话存储验证主机端，`--browser` 追加真实浏览器流程：点击全局「新建会话」、刷新后继续输入、发送首条消息、在已有工作区新建对话、使用快捷键，以及切换到项目。测试使用独立的 Chrome 用户目录，会通过开发 profile 的模型发送一条测试消息；可用 `DSH_TEST_CHROME` 指定 Chromium 可执行文件。`--default-root` 单独验证 `root` 留空时回退到 profile 内的 `session-workspaces`，并在结束后删除自己创建的目录，因此要求该目录此前不存在。
