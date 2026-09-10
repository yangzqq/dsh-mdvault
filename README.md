# dsh-mdvault

DSH Web UI 的工作区文档库插件：在会话区新增一个 **📄 文档** 标签页，把当前工作区变成一个可浏览、可跳转、可编辑的"轻量 Obsidian"。

> **v1.1.0 起**：文件预览能力对齐 `dsh-better-sidebar`（Markdown 全语法 / Mermaid / PDF / 图片 / HTML / 代码），并且全部在主界面窗口内打开。两个插件可以共存。

## 功能

### 文件树

- **全类型文件树**：Markdown / PDF / HTML / 代码 / 表格 / 图片，点击即用对应方式预览
- **筛选框**：输入关键字即时过滤文件路径，匹配时自动展开目录
- **分类图标**：📝 Markdown · 📕 PDF · 📗 表格 · 🖼 图片 · 🌐 HTML · 💻 代码

### Markdown 预览

- **完整 GFM**：表格、任务列表、删除线、脚注、自动链接
- **数学公式**：`$...$` / `$$...$$`，由 KaTeX 渲染
- **代码高亮**：围栏代码块带语法高亮与复制按钮
- **Mermaid 图表**：```` ```mermaid ```` 直接渲染成图（按需加载，见下）
- **YAML frontmatter**：预览时自动隐藏，编辑时保留原文
- **Obsidian 式双链**：`[[笔记名]]`、`[[路径/笔记.md|别名]]`、`[[文件.pdf#page=17|第17页]]` 点击跳转
- **相对链接与图片**：`[文本](./其他.md)`、`![图](./img/a.png)` 按当前文件目录解析

Markdown 渲染直接复用 DSH 平台自身的 `MarkdownText`（`@deepseek-ai/dsh-client-ui-primitives`），因此渲染结果与聊天区完全一致，并自动跟随浅色/深色主题。若某个 DSH 版本没有导出该模块，插件会退回内置的轻量渲染器（支持标题/列表/表格/引用/代码块/双链）。

### 其他预览器

- **PDF**：取回字节后包成 `Blob` 再交给浏览器原生阅读器，避免因 `application/octet-stream` 被当成下载；工具栏提供下载
- **图片**：滚轮缩放、拖拽平移、双击工具栏复位，支持 `png/jpg/gif/webp/svg/bmp/ico/avif`
- **HTML**：在 **无 `allow-same-origin`** 的沙箱 iframe 中预览（不透明源，页面拿不到 GUI 的会话数据）
- **代码 / 纯文本**：只读查看，带语言提示与高亮
- **表格**：内置 SheetJS 解析 `xlsx/xlsm/xls/csv/tsv`，多工作表切换

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

## 安装（本地目录方式）

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

## 插件注册的 HTTP 路由

全部挂载在 `/mdvault` 前缀下，且每次访问都按调用会话的 cwd 做越界校验：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/mdvault/api/list` | 扫描工作区，返回可预览文件列表 |
| POST | `/mdvault/api/read` | 读取文本文件（超过 6MB 拒绝，避免拖垮编辑器） |
| POST | `/mdvault/api/write` | 写回文本文件 |
| GET | `/mdvault/asset/<sessionId>/<rel>` | 返回文件原始字节（带正确 Content-Type 与 `nosniff`） |
| GET | `/mdvault/sheet?sessionId&path` | 生成的 SheetJS 表格查看页 |
| GET | `/mdvault/xlsx.js` | 内置 SheetJS 库 |
| GET | `/mdvault/mermaid.js` | 内置 Mermaid 库（仅在文档含 mermaid 围栏时按需加载） |

`xlsx.js` 与 `mermaid.js` 使用 ETag + `304`，避免重复下载数 MB 的资源。

## 测试

```bash
npm test              # 纯函数 + 宿主路由，共 72 项断言
npm run test:helpers  # 链接改写、frontmatter、路径解析、mermaid 检测、SVG 清洗、apply()
npm run test:host     # 宿主路由：路径越界、Content-Type、ETag/304、表格页
npm run probe:hmr     # 诊断：确认本插件是否已被 DSH 作为客户端模块加载
```

测试直接加载 `lib/` 下**发布用的真实代码**（通过模拟 `window.__ModuleLoader__` 与 Cordis `ctx`），不是副本。

## 卸载

从 profile 的 `cordis.patch.yml` 删除对应 `- insert:` 块，并删除 `node_modules/dsh-mdvault` 目录，重启即可。

## 许可

MIT
