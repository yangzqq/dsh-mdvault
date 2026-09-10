# dsh-mdvault

DSH Web UI 的工作区文档库插件：在会话区新增一个 **📄 文档** 标签页，把当前工作区变成一个可浏览、可跳转、可编辑的"轻量 Obsidian"。

## 功能

- **全类型文件树**：📝 Markdown / 📕 PDF / 📗 Excel·CSV / 🖼 图片，点击即用对应方式预览
- **Obsidian 式双链**：`[[笔记名]]`、`[[路径/笔记.md|别名]]` 直接跳转；相对链接同样可用
- **PDF 引用直达**：`[[文件.pdf#page=17|标签]]` 在右侧内嵌打开并定位到第 17 页
- **Excel 原生预览**：内置 SheetJS 解析 xlsx/xls/csv/xlsm，多工作表切换，无需转换成 PDF
- **在线编辑**：✏️ 按钮进入编辑，Ctrl+S / ⌘S 保存写盘
- **better-sidebar 联动（可选）**：检测到 dsh-better-sidebar 时自动注册同名渲染器为其文件查看器，可在其设置中开关

## 环境要求

- DeepSeek Harness（`@deepseek-ai/dsh`）web 部署
- 无其他依赖：SheetJS 已打包在本插件 `dist/` 内，不需要 Obsidian / Office / 外网

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

## 安装（npm 方式，发布后）

```bash
dsh plugin --profile web add dsh-mdvault
```

## 卸载

从 profile 的 `cordis.patch.yml` 删除对应 `- insert:` 块，并删除 `node_modules/dsh-mdvault` 目录，重启即可。
