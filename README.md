# dsh-mdvault

DSH Web UI 的工作区文档库插件：在会话区新增一个 **📄 文档** 标签页，把当前工作区变成一个可浏览、可跳转、可编辑的"轻量 Obsidian"。

> **v1.1.0 起**：文件预览能力对齐 `dsh-better-sidebar`（Markdown 全语法 / Mermaid / PDF / 图片 / HTML / 代码），并且全部在主界面窗口内打开。两个插件可以共存。
>
> **v1.2.0**：修复文档内链接打不开 PDF / 图片的问题（改为按当前文档目录解析）、文件树默认全部折叠、大幅优化卡顿。
>
> **v1.2.1**：修复白屏（`codeStats` 在声明前被读取）；新增组件渲染测试防止同类问题再次发生；选中「文档」时自动隐藏底部输入框。

## 功能

### 与聊天输入框的关系

选中 **文档** 标签页时，底部输入框会**自动隐藏**，把整个窗口让给文档；切回 **对话** 时自动恢复（草稿不会丢，只是被隐藏而非卸载）。

工具栏的 **⌨ 输入框** 按钮可以随时把它叫回来——想在读文档时顺手追问一句用得上。

### 文件树

- **全类型文件树**：Markdown / PDF / HTML / 代码 / 表格 / 图片，点击即用对应方式预览
- **默认全部折叠**：只展开当前文档所在的那条路径；工具栏 **⊟ 折叠** 可一键收起全部
- **筛选框**：输入关键字即时过滤文件路径，匹配时自动展开目录
- **分类图标**：📝 Markdown · 📕 PDF · 📗 表格 · 🖼 图片 · 🌐 HTML · 💻 代码
- **扫描上限**：最多 14 层目录、4000 个文件；触顶时工具栏显示 **⚠ 列表已截断**
- 工具栏右端显示构建号 **`v1.2.0`**，用于确认浏览器跑的是哪个版本

### Markdown 预览

- **完整 GFM**：表格、任务列表、删除线、脚注、自动链接
- **数学公式**：`$...$` / `$$...$$`，由 KaTeX 渲染
- **代码高亮**：围栏代码块带语法高亮与复制按钮
- **Mermaid 图表**：```` ```mermaid ```` 直接渲染成图（按需加载，见下）
- **YAML frontmatter**：预览时自动隐藏，编辑时保留原文
- **Obsidian 式双链**：`[[笔记名]]`、`[[路径/笔记.md|别名]]`、`[[文件.pdf#page=17|第17页]]` 点击跳转
- **相对链接与图片**：`[文本](./其他.md)`、`![图](./img/a.png)` **按当前文档所在目录**解析

> **链接解析规则**（两套方言，与 Obsidian 一致）：
>
> | 写法 | 解析基准 |
> | --- | --- |
> | `[[双链]]` | **工作区根目录**；找不到时按文件名在全库范围匹配 |
> | `[文本](./相对路径.md)` | **当前打开的文档**；`../` 可用 |
>
> 解析不依赖文件树是否收录该文件，所以深层目录里的 PDF / 图片也能打开。
>
> **点击由文档级捕获监听器拦截**，因此链接绝不会真的导航到外部地址（平台给链接加了 `target="_blank"`，靠组件内的监听器拦不住，会新开一个空标签页）。

Markdown 渲染直接复用 DSH 平台自身的 `MarkdownText`（`@deepseek-ai/dsh-client-ui-primitives`），因此渲染结果与聊天区完全一致，并自动跟随浅色/深色主题。若某个 DSH 版本没有导出该模块，插件会退回内置的轻量渲染器（支持标题/列表/表格/引用/代码块/双链）。

### 其他预览器

- **PDF**：取回字节后包成 `Blob` 再交给浏览器原生阅读器，避免因 `application/octet-stream` 被当成下载；`#page=17` 跳页锚点会保留到 Blob URL 上；工具栏提供下载
- **图片**：滚轮缩放、拖拽平移、双击工具栏复位，支持 `png/jpg/gif/webp/svg/bmp/ico/avif`
- **HTML**：在 **无 `allow-same-origin`** 的沙箱 iframe 中预览（不透明源，页面拿不到 GUI 的会话数据）
- **代码 / 纯文本**：只读查看，带语言提示与高亮
- **表格**：内置 SheetJS 解析 `xlsx/xlsm/xls/csv/tsv`，多工作表切换

### 大文件保护

代码 / 文本查看按体积分档，避免把大文件塞进渲染管线：

| 体积 | 行为 |
| --- | --- |
| ≤ 200 KB | 正常语法高亮 |
| 200 KB – 2 MB | 纯文本显示（不高亮） |
| > 2 MB | 不渲染，只提供「新窗口 / 下载」 |

在线编辑另有限制：超过 **6 MB** 的文本文件拒绝加载（`ctx.fs.readText` 自身没有上限）。

### 编辑

- **在线编辑**：✏️ 按钮进入编辑，`Ctrl+S` / `⌘S` 保存写盘
- **行号栏**、`Tab` 缩进、脏数据标记（未保存时路径后显示 `•`）
- **查找 / 替换**：`Ctrl+F` 打开查找栏，`Enter` 下一个、`Esc` 关闭；支持替换与全部替换
- **放弃修改确认**：有未保存改动时按 `Esc`／取消会先确认

### 与 dsh-better-sidebar 共存（可选）

检测到 `dsh-better-sidebar` 时，插件会额外注册：

- 一个同名渲染器 `mdvault-markdown`，可在侧边栏设置里开关（使用同一套 Markdown 渲染，因此双链在侧边栏里也能跳转）
- 一个隐藏 Tab `mdvault-pdf`，用于侧边栏内的 PDF 跳页预览

未安装该插件时这部分自动跳过，不影响任何主界面功能。

## 与其他插件的关系

`dsh-better-sidebar` 是一个 VSCode 风格的**侧边栏**（终端 / Git / 浏览器 / 侧边对话等）。本插件只把它**文件预览/编辑**相关的能力搬到**主界面窗口**，并且：

| 能力 | dsh-mdvault（主窗口） | dsh-better-sidebar（侧边栏） |
| --- | --- | --- |
| Markdown 渲染 | ✅ 平台 `MarkdownText` | ✅ 平台 `MarkdownText` |
| Mermaid | ✅ 按需加载 | ✅ 按需加载 |
| PDF | ✅ Blob 预览 | ✅ Blob 预览 |
| 图片 | ✅ 缩放/平移 | 仅静态显示 |
| HTML | ✅ 沙箱预览 | ✅ 沙箱预览 |
| 代码高亮 | ✅ 通过围栏渲染 | ✅ CodeMirror |
| 编辑器 | `<textarea>` + 行号 + 查找替换 | CodeMirror 6（更高阶） |
| 终端 / Git / 浏览器 / 侧边对话 | ❌ 不在范围内 | ✅ |

保留 `dsh-better-sidebar` 不会与本插件冲突：两者注册的 id 不同，渲染器各自独立。

## 环境要求

- DeepSeek Harness（`@deepseek-ai/dsh`）web 部署
- **无构建步骤**：`lib/` 是可直接运行的纯 JavaScript
- **无 npm 依赖**：SheetJS 与 Mermaid 已打包在 `dist/`，不需要外网

## 安装方式一：本地目录（最快，但不进插件管理列表）

1. 把整个 `dsh-mdvault` 文件夹复制到目标机器的：

   ```
   ~/.dsh/profiles/<profile>/node_modules/dsh-mdvault
   ```

   Windows 默认即 `C:\Users\<你>\.dsh\profiles\web\node_modules\dsh-mdvault`

2. 在该 profile 的 `cordis.patch.yml`（如 `~/.dsh/profiles/web/cordis.patch.yml`）加入：

   ```yaml
   - insert:
       - id: mdvault
         name: dsh-mdvault
   ```

3. 重启 `dsh web`。聊天区顶部出现"📄 文档"标签页即成功。

> **注意**：`lib/client.js`（浏览器半边）的改动会被 DSH 自带的 HMR 监听并热重载；但 `lib/index.js`（宿主半边）的改动**不会**热重载，修改宿主代码后需要重启 `dsh web`。

这种方式**不会**出现在「设置 → 插件管理」列表里，因为该列表只枚举 profile `package.json` 的 `dependencies`。想要能统一管理，用下面的打包安装方式。

## 安装方式二：打包成 tgz（推荐，可进插件管理列表）

插件管理列表（`@linxin666/dsh-client-ui-plugin-manager`）的枚举规则是：

```
for (const name of Object.keys(manifest.dependencies).sort()) → 一行
```

即**只列 profile `package.json` 的 `dependencies`**，然后逐行读取
`node_modules/<name>/package.json` 拿版本、读 `node_modules/<name>/cordis.patch.yml`
拿它声明的挂载行。所以要让插件出现在列表里，它必须是一个**被声明的依赖**。

### 打包

```bash
npm pack                 # 产出 dsh-mdvault-<version>.tgz
```

> 若 npm 默认缓存在当前环境不可写（沙箱 / 权限），改用工作区内的缓存：
> `npm pack --cache ./.npm-cache`

产物约 1.3 MB（解包约 4.7 MB），含 `lib/`、`dist/`（SheetJS + Mermaid）、
`test/`、`cordis.patch.yml`、`README.md`、`LICENSE`。

### 安装

把 tgz 放到一个固定位置（例如 `~/.agents/`），然后：

```bash
dsh plugin --profile web add file:C:/Users/<你>/.agents/dsh-mdvault-1.2.1.tgz
```

或手工两步：

1. 在 profile `package.json` 中登记依赖与 bundle：

   ```json
   {
     "dsh": { "profile": { "bundles": [ "...", "dsh-mdvault" ] } },
     "dependencies": {
       "dsh-mdvault": "file:C:/Users/<你>/.agents/dsh-mdvault-1.2.1.tgz"
     }
   }
   ```

2. ⚠️ **同时删掉 `cordis.patch.yml` 里手工加的那段 `- insert: - id: mdvault`**。

   因为 `dsh-mdvault` 一旦成为 bundles 条目，它自己包内的 `cordis.patch.yml`
   就会作为 bundle 层被套用（里面已经写了同样的 insert 行）。两处都写就是
   **同一个 id 被挂载两次**，属于重复挂载。

3. 安装依赖并重启：

   ```bash
   cd ~/.dsh/profiles/web && pnpm install
   # 然后重启 dsh web
   ```

### 为什么 tgz 里带 `test/`

`files` 里包含了 `test/`，所以安装后仍可自检：

```bash
cd ~/.dsh/profiles/web/node_modules/dsh-mdvault && npm test   # 134 项断言
```

## 卸载

- **tgz 方式**：`dsh plugin --profile web remove dsh-mdvault`（或从 profile
  `package.json` 移除该依赖与 bundles 条目），再 `pnpm install`。
- **本地目录方式**：从 `cordis.patch.yml` 删除对应 `- insert:` 块，并删除
  `node_modules/dsh-mdvault` 目录，重启即可。


## 插件注册的 HTTP 路由

全部挂载在 `/mdvault` 前缀下，且每次访问都按调用会话的 cwd 做越界校验：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/mdvault/api/list` | 扫描工作区，返回可预览文件列表（含 `truncated` / `maxDepth`） |
| POST | `/mdvault/api/read` | 读取文本文件（超过 6MB 拒绝，避免拖垮编辑器） |
| POST | `/mdvault/api/write` | 写回文本文件 |
| GET | `/mdvault/asset/<sessionId>/<rel>` | 返回文件原始字节（带正确 Content-Type 与 `nosniff`） |
| GET | `/mdvault/sheet?sessionId&path` | 生成的 SheetJS 表格查看页 |
| GET | `/mdvault/xlsx.js` | 内置 SheetJS 库 |
| GET | `/mdvault/mermaid.js` | 内置 Mermaid 库（仅在文档含 mermaid 围栏时按需加载） |

`xlsx.js` 与 `mermaid.js` 使用 ETag + `304`，避免重复下载数 MB 的资源。

## 性能

这一版针对卡顿做了三处关键优化：

1. **目录默认折叠**。原先 `isOpen = !collapsed[path]` 会让**每个目录都处于展开状态**，首次打开就为工作区里每个文件建一个 DOM 行；现在只展开当前文档所在路径。
2. **文档渲染结果记忆化**。`stripFrontmatter` / mermaid 检测 / `MarkdownText` 的 props 都做了 memo；`nav` 对象保持稳定标识。否则每次在筛选框敲一个字都会让整篇文档重新解析 + 重新高亮。
3. **大文件分档**（见上）。代码查看不再把多 MB 的 `dist/*.js` 之类丢进高亮管线。

## 更新代码后没生效？

DSH 会用 `dsh-client-hmr` 热重载插件的浏览器半边，**但热重载不一定落到已经打开的页面上**。判断方法：

1. 看工具栏右端的构建号（如 `v1.2.0`）。它就是**浏览器当前实际运行**的版本。
2. 如果构建号比你刚改的版本旧 → **硬刷新页面**（`Ctrl+Shift+R` / `⌘⇧R`）。
3. 如果宿主半边（`lib/index.js`）改过 → 必须重启 `dsh web`，刷新页面没用。

两个诊断命令可以确认服务端到底在发什么代码：

```bash
npm run probe:graph    # 插件是否已成为客户端模块？磁盘 rev 是否与注册的一致？
npm run verify:served  # 服务端发出的字节是否就是磁盘上这份，且包含各项功能？
```

## 测试

```bash
npm test              # 纯函数 + 宿主路由 + 组件渲染，共 132 项断言
npm run test:helpers  # 链接改写与解析规则、frontmatter、路径、mermaid、SVG 清洗、树展开、拦截器、apply()
npm run test:host     # 宿主路由：路径越界、Content-Type、ETag/304、表格页、深层目录扫描
npm run test:render   # 组件渲染：真正执行 MdVaultView，捕获渲染期异常（白屏类 bug）
npm run probe:graph   # 诊断：DSH 是否已把本插件加载为客户端模块
npm run verify:served # 诊断：服务端发出的字节 = 磁盘现状，且包含预期功能
```

测试直接加载 `lib/` 下**发布用的真实代码**（通过模拟 `window.__ModuleLoader__` 与 Cordis `ctx`），不是副本。

`test:render` 值得一提：它自带一个精简版 React 实现（`createElement`、按位置索引的 hooks、能把 Promise 状态更新收敛到稳定的重渲染循环），会**真正执行组件函数**。纯函数测试永远抓不到渲染期异常——v1.2.0 因此把一个「`const` 在声明前被读取」的错误发了出去，导致整个标签页白屏。该测试已用旧版本反向验证过：把 bug 放回去，它会立刻报错。

## 许可

MIT（`dist/` 内打包的第三方库许可见 `LICENSE`）
