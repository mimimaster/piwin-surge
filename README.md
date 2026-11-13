# piwin-surge

Session-scoped system prompt switcher and isolation lab for **piwin**, rebuilt as a standalone `piwin` extension from [ZiChuanLan/pi-purge](https://github.com/ZiChuanLan/pi-purge) with full Desktop UI integration.

- **Off by default**: each session starts clean with zero prompt rewrites and zero disk writes.
- **Desktop UI adapted**:
  - Run `/surge` (or pick it from Desktop's `/` / `+` command menu) to open the interactive inline control menu (`ctx.ui.select` / `ctx.ui.input`).
  - Live **composer status chip** (`SURGE · strict · 内嵌示例`) while enabled.
  - Toggleable **above-editor status widget** showing active mode, persona source/size, and last turn rewrite telemetry.
- **Direct subcommands** also work seamlessly in Desktop & CLI:
  - `/surge on` | `/surge off` | `/surge toggle`
  - `/surge mode strict|replace|append`
  - `/surge source <path|embedded>` (supports `~/...`, relative paths, or quoted paths)
  - `/surge reload` — re-read the active external prompt file
  - `/surge panel [on|off]` — show or hide the preview widget above the composer
  - `/surge status` — inspect current state and last-turn statistics

## Modes

| Mode | Behavior | Use when |
| --- | --- | --- |
| `strict` | Persona + `Current working directory: ...` only | Isolating instructions as a single clean variable |
| `replace` | Persona at top; strips Pi's built-in identity line & bundled docs while preserving tools and `# Project Context` | Testing prompt behavior with tool & project context intact |
| `append` | Prepends persona before the unmodified host system prompt | Baseline comparison |

## Credits

- Based on [ZiChuanLan/pi-purge](https://github.com/ZiChuanLan/pi-purge) (MIT) and [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge).
- Adapted for piwin's Desktop extension UI bridge (`registerCommand`, `ctx.ui.select`, `ctx.ui.input`, `ctx.ui.setStatus`, `ctx.ui.setWidget`, `ctx.ui.notify`).
