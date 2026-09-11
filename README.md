# dsh-mdvault

[![npm](https://img.shields.io/npm/v/dsh-mdvault.svg)](https://www.npmjs.com/package/dsh-mdvault)
[![license](https://img.shields.io/npm/l/dsh-mdvault.svg)](./LICENSE)
[![test](https://github.com/yangzqq/dsh-mdvault/actions/workflows/test.yml/badge.svg)](https://github.com/yangzqq/dsh-mdvault/actions/workflows/test.yml)

**点开 Markdown 里的链接，直接就到达那个文件。**

不是新开标签页跳到一个地址，而是就地打开：PDF 直接翻到指定页，图片直接显示，表格直接渲染，另一篇笔记直接跳过去。

```bash
dsh plugin --profile web add dsh-mdvault
```

DSH Web UI 的工作区文档库插件：在会话区新增一个 **📄 文档** 标签页，把当前工作区变成一个可浏览、可跳转、可编辑的"轻量 Obsidian"。

## 链接直达

这是本插件的核心能力。在文档里写下链接，点击即可到达：

| 你写的 | 点击后 |
| --- | --- |
| `[[会议纪要]]` | 打开同名笔记（全库范围查找） |
| `[说明](./docs/readme.md)` | 跳转到另一篇笔记 |
| `[[报告.pdf#page=17]]` | 打开 PDF 并**直接翻到第 17 页** |
| `[设计图](./assets/plan.png)` | 打开图片，可缩放、可拖拽 |
| `[统计表](../data/2026.xlsx)` | 打开表格，多工作表切换 |
| `![流程图](./img/flow.svg)` | 在正文里直接显示图片 |

**两套写法，各按各的规则解析**（与 Obsidian 一致）：

| 写法 | 相对谁解析 |
| --- | --- |
| `[[双链]]` | **工作区根目录**；找不到时按文件名在全库范围匹配 |
| `[文本](./相对路径)` | **当前打开的这篇文档**；`../` 可用 |

用 `|` 加别名，让链接显示得更自然：

```markdown
[[报告.pdf#page=17|第 17 页]]      →  点击「第 17 页」，翻到 PDF 第 17 页
[[很长的笔记文件名|简称]]           →  链接文字显示「简称」
```

解析**不依赖文件树是否收录了该文件** —— 目录再深、文件再多，只要在会话工作区内就能打开。

> **为什么单靠平台做不到？** DSH 自带的 Markdown 渲染器只认 `http(s)://` 绝对地址，相对链接和 `[[双链]]` 会渲染成**点不动的纯文本**。而且平台给链接统一加了 `target="_blank"` —— 插件若只在组件内部拦截，链接一经重新渲染就失效，浏览器会新开一个空白标签页。本插件在 **document 级捕获阶段**拦截点击并 `preventDefault()`，所以链接是真正"就地打开"的，也永远不会误跳出页面。

## 其他功能

### 文件树

- **全类型**：Markdown / PDF / HTML / 代码 / 表格 / 图片，按类型用对应方式预览
- **默认全部折叠**：只展开当前文档所在的那条路径；工具栏 **⊟ 折叠** 一键收起全部
- **筛选框**：输入关键字即时过滤，匹配时自动展开路径
- **分类图标**：📝 Markdown · 📕 PDF · 📗 表格 · 🖼 图片 · 🌐 HTML · 💻 代码

### Markdown 预览

- **完整 GFM**：表格、任务列表、删除线、脚注、自动链接
- **数学公式**：`$...$` / `$$...$$`，由 KaTeX 渲染
- **代码高亮**：围栏代码块带语法高亮与复制按钮
- **Mermaid 图表**：```` ```mermaid ```` 直接画成图（按需加载，见下）
- **YAML frontmatter**：预览时自动隐藏，编辑时保留原文

渲染直接复用 DSH 平台自身的 `MarkdownText`，所以效果与聊天区完全一致，并自动跟随浅色 / 深色主题。

### 各种文件的预览方式

| 类型 | 说明 |
| --- | --- |
| **PDF** | 取回字节包成 `Blob` 再交给浏览器原生阅读器，避免被当成下载；`#page=17` 跳页锚点会保留；工具栏提供下载 |
| **图片** | 滚轮缩放、拖拽平移、复位、新窗口、下载；支持 `png/jpg/gif/webp/svg/bmp/ico/avif` |
| **HTML** | 在**无 `allow-same-origin`** 的沙箱 iframe 中预览 —— 页面处于不透明源，拿不到 GUI 的会话数据 |
| **代码 / 纯文本** | 只读查看，带语言提示与高亮 |
| **表格** | 内置 SheetJS 解析 `xlsx/xlsm/xls/csv/tsv`，多工作表切换 |

### 大文件保护

代码 / 文本按体积分档，避免把大文件塞进渲染管线：

| 体积 | 行为 |
| --- | --- |
| ≤ 200 KB | 正常语法高亮 |
| 200 KB – 2 MB | 纯文本显示（不高亮） |
| > 2 MB | 不渲染，只提供「新窗口 / 下载」 |

在线编辑另有限制：超过 **6 MB** 的文本文件拒绝加载。

### 编辑

- ✏️ 按钮进入编辑，`Ctrl+S` / `⌘S` 保存写盘
- **行号栏**、`Tab` 缩进、脏数据标记（未保存时路径后显示 `•`）
- **查找 / 替换**：`Ctrl+F` 打开查找栏，`Enter` 下一个、`Esc` 关闭，支持替换与全部替换
- **放弃修改前会确认**，不会静默丢失改动

### 与聊天输入框的关系

切到 **文档** 标签时，底部输入框会**自动隐藏**，把整个窗口让给文档；切回 **对话** 自动恢复（草稿不会丢，只是被隐藏）。

工具栏的 **⌨ 输入框** 按钮可以随时把它叫回来 —— 读文档时想顺手追问一句用得上。

## 与其他插件的关系

`dsh-better-sidebar` 是一个 VSCode 风格的**侧边栏**（终端 / Git / 浏览器 / 侧边对话等）。本插件把其中**文件预览 / 编辑**相关的能力搬到了**主界面窗口**：

| 能力 | dsh-mdvault（主窗口） | dsh-better-sidebar（侧边栏） |
| --- | --- | --- |
| Markdown 渲染 | ✅ 平台 `MarkdownText` | ✅ 平台 `MarkdownText` |
| 链接直达 | ✅ 双链 + 相对链接 | — |
| Mermaid | ✅ 按需加载 | ✅ 按需加载 |
| PDF / HTML | ✅ Blob 预览 / 沙箱预览 | ✅ 同 |
| 图片 | ✅ 缩放 / 平移 | 仅静态显示 |
| 编辑器 | `<textarea>` + 行号 + 查找替换 | CodeMirror 6（更高阶） |
| 终端 / Git / 浏览器 / 侧边对话 | ❌ 不在范围内 | ✅ |

**两者可以共存，不冲突** —— 注册的 id 不同，渲染器各自独立。装了 `dsh-better-sidebar` 时，本插件还会额外提供：

- 一个 Markdown 渲染器 `mdvault-markdown`，可在侧边栏设置里开关（同一套渲染，双链在侧边栏里也能跳）
- 一个隐藏 Tab `mdvault-pdf`，用于侧边栏内的 PDF 跳页预览

未安装该插件时这部分自动跳过，不影响主界面任何功能。

## 安装

```bash
dsh plugin --profile web add dsh-mdvault
```

然后**重启 `dsh web`**。会话区顶部出现 **📄 文档** 标签页即成功。

安装后可在「设置 → 插件」里看到它，开关和版本号都在那里。

<details>
<summary>其他安装方式</summary>

```bash
dsh plugin --profile web add dsh-mdvault@1.2.1   # 指定版本
dsh plugin --profile web add /path/to/dsh-mdvault  # 从本地源码目录
```

</details>

## 环境要求

- DeepSeek Harness（`@deepseek-ai/dsh`）web 部署，`dsh >= 0.1.5-rc.1`
- **零依赖、零安装脚本**：不会拉取任何 npm 包，安装时不执行任何代码
- **无构建步骤**：`lib/` 是可直接运行的纯 JavaScript
- **不需要外网**：SheetJS 与 Mermaid 已内置在 `dist/`，用到时才按需加载

## 常见问题

**标签页没出现？**
空白的新会话不会显示顶部标签栏。打开一个已有内容的会话再看。

**Mermaid 图表没渲染出来？**
Mermaid 库有 3.4 MB，只在文档里真的出现 ```` ```mermaid ```` 代码块时才会按需加载。第一次渲染会稍慢一下。

**某个文件点不开？**
请带上工具栏右端的**构建号**（形如 `v1.2.1`）反馈，它能确认你实际运行的版本。

## 卸载

```bash
dsh plugin --profile web remove dsh-mdvault
```

再重启 `dsh web`。

## 许可

MIT。`dist/` 内打包的第三方库（SheetJS / Mermaid）许可见 [LICENSE](./LICENSE)。
