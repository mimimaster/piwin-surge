# Piwin Surge

面向 **piwin 桌面端与 CLI** 的会话级系统提示词切换、裁剪与实验控制台（基于 MIT 协议的 [ZiChuanLan/pi-purge](https://github.com/ZiChuanLan/pi-purge) 改造，深度适配 piwin 桌面端交互桥接能力）。

## 为什么安全？

- **默认关闭**：扩展安装、启动、每次新建或恢复会话时均默认为关闭状态，不改写任何系统提示词。
- **零磁盘写入**：不写本地配置文件、不污染全局设置；关闭 `/surge off`、退出或切换会话即刻恢复宿主默认提示词。
- **独立命令无冲突**：使用 `/surge`，即使同时装有原版 `/purge` 也不会命令撞车。

---

## 快速上手（3 步配置，无需看文档也能用）

### 第 1 步：打开交互控制台
安装并启用后，在 piwin 桌面端输入框：
- 点击 **`+` → 扩展 → `/surge`**（或键入 `/` 选择 **`/surge`**），直接回车发送。
- 不带参数运行 `/surge` 会自动在输入框上方弹出 **交互式配置卡片**（无需记任何子命令）。

### 第 2 步：选择或输入你的人设提示词
在交互菜单中选择 **「配置提示词来源」**，支持 3 种方式：
1. **免建文件 · 直接粘贴（最省事）**：选择「直接输入 / 粘贴人设文本」，把人设提示词填进输入框即刻生效（或直接运行 `/surge prompt 你是一位严谨的代码审计专家...`）。
2. **读取本地文件（适合长提示词）**：选择「从本地文件加载」，输入 `.md` / `.txt` 文件路径，支持 `~/` 缩写与拖拽/复制带引号的路径（或直接运行 `/surge source ~/prompts/my-persona.md`）。
3. **内置精简示例**：开箱即用，方便第一时间对照实验；可随时切回 `/surge source embedded`。

### 第 3 步：选择模式并开启
- 在菜单中切换模式（默认 `strict`），再点击 **「开启提示词注入」**（或直接输入 `/surge on`）。
- 开启后：
  - 输入框底部状态栏会出现紧凑状态芯片：`SURGE · strict · ...`；
  - 输入框上方会展开实时预览面板，显示当前人设摘要与最近一轮注入前后字符数对比；
  - 从**下一条你发送的消息**开始生效，随时输入 `/surge off` 一键关停。

---

## 三种合成模式对比

| 模式 | 实际发给模型的系统提示词构成 | 适用场景 | 备注 |
| --- | --- | --- | --- |
| `strict`（默认） | 你的人设 + `Current working directory: ...` | **纯单变量对照实验**：只验证你写的人设效果 | 会隔离 `AGENTS.md`、Skills 与其它扩展附加文本；工具声明仍通过 API `tools` 正常传递 |
| `replace` | 你的人设 + 剥离宿主身份行与内置文档后的系统提示词 | **真实项目实测**：保留工具指引和 `# Project Context`，仅去掉 pi 原生身份束缚 | 若上游提示词段落文案变更未命中，状态面板会明示并自动安全退化为前置追加 |
| `append` | 你的人设前置叠加到完整宿主系统提示词顶部 | **对照组基线**：观察未裁剪宿主约束时的人设权重 | 原宿主提示词一字不动保留 |

---

## 全部斜杠命令速查

| 命令 | 作用 |
| --- | --- |
| `/surge` | 在桌面端打开交互配置主菜单（非 UI 环境自动切换开关） |
| `/surge guide` / `/surge help` | 在输入框上方固定显示快速使用指南面板（`/surge panel off` 收起） |
| `/surge on` / `/surge off` / `/surge toggle` | 开启、关闭或切换当前会话的系统提示词改写 |
| `/surge mode strict\|replace\|append` | 切换合成模式（省略参数时弹出模式选择卡片） |
| `/surge source <path\|embedded>` | 指定外部 `.md/.txt` 文件或恢复内置示例（省略路径时打开来源配置菜单） |
| `/surge prompt <文本>` | 免建文件，直接设定本会话使用的自定义人设文本 |
| `/surge reload` | 重新读取当前绑定的外部提示词文件 |
| `/surge panel [on\|off]` | 显示或收起输入框上方的实时状态面板 |
| `/surge status` | 查看当前状态与上一轮系统提示词改写字符统计 |

---

## 致谢与许可

- 原作机制与实验理念源自 [ZiChuanLan/pi-purge](https://github.com/ZiChuanLan/pi-purge)（MIT）与 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)。
- 本项目基于 MIT 协议独立重构，完整适配 piwin 桌面端 UI 桥接能力（`registerCommand`、`ctx.ui.select`、`ctx.ui.input`、`ctx.ui.setStatus`、`ctx.ui.setWidget`、`ctx.ui.notify`）。
