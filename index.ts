/**
 * Piwin Surge — 会话级系统提示词切换与单变量实验台（深度适配 piwin 桌面端 `/surge` 交互菜单、状态芯片与预览面板）。
 */
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { loadPromptFile } from './src/prompt-loader.js';
import {
  createInitialState,
  DEFAULT_EMBEDDED_PROMPT,
  parseSurgeCommand,
  rewriteSystemPrompt,
  type SurgeMode,
  type SurgeState,
} from './src/prompt-rewriter.js';
import {
  buildHelpSummary,
  buildStatusSummary,
  clearDesktopSurface,
  describeSourceShort,
  openSurgeMenu,
  promptModeSelection,
  promptSourcePathInput,
  syncDesktopSurface,
} from './src/surge-ui.js';

export default function piwinSurgeExtension(pi: ExtensionAPI): void {
  let state: SurgeState = createInitialState();

  function notify(ctx: ExtensionContext, message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
    if (ctx.hasUI) {
      ctx.ui.notify(message, level);
    }
  }

  function applyEnabled(enabled: boolean, ctx: ExtensionContext): void {
    state.enabled = enabled;
    state.panelVisible = enabled;
    if (!enabled) {
      delete state.lastRewrite;
    }
    syncDesktopSurface(state, ctx);
    notify(
      ctx,
      enabled
        ? `Piwin Surge 已开启 · 模式: ${state.mode} · 来源: ${describeSourceShort(state)}（仅当前会话生效）`
        : 'Piwin Surge 已关闭 · 恢复 piwin 默认系统提示词。',
      'info',
    );
  }

  function applyMode(mode: SurgeMode, ctx: ExtensionContext): void {
    state.mode = mode;
    syncDesktopSurface(state, ctx);
    notify(ctx, `合成模式已切换为 ${mode}${state.enabled ? '（下轮生效）' : '（当前未开启，运行 /surge on 启用）'}。`);
  }

  function resetToEmbedded(ctx: ExtensionContext): void {
    state.sourceKind = 'embedded';
    delete state.sourcePath;
    state.persona = DEFAULT_EMBEDDED_PROMPT;
    syncDesktopSurface(state, ctx);
    notify(ctx, `已切回内嵌示例提示词 (${state.persona.length} 字符)。`);
  }

  async function applyExternalSource(rawTarget: string, ctx: ExtensionContext): Promise<void> {
    if (rawTarget.trim().toLowerCase() === 'embedded') {
      resetToEmbedded(ctx);
      return;
    }
    const loaded = await loadPromptFile(rawTarget, ctx.cwd);
    if (!loaded.ok) {
      notify(ctx, `${loaded.error} 已保持原提示词来源。`, 'warning');
      return;
    }
    state.sourceKind = 'file';
    state.sourcePath = loaded.resolvedPath;
    state.persona = loaded.content;
    syncDesktopSurface(state, ctx);
    notify(ctx, `已载入外部提示词: ${loaded.resolvedPath} (${loaded.content.length} 字符)。`);
  }

  async function reloadExternalSource(ctx: ExtensionContext): Promise<void> {
    if (state.sourceKind !== 'file' || !state.sourcePath) {
      notify(ctx, `当前使用内嵌示例提示词 (${state.persona.length} 字符)，无需重载文件。`);
      return;
    }
    const loaded = await loadPromptFile(state.sourcePath, ctx.cwd);
    if (!loaded.ok) {
      notify(ctx, `${loaded.error} 已继续保留上次成功载入的文本。`, 'warning');
      return;
    }
    state.persona = loaded.content;
    syncDesktopSurface(state, ctx);
    notify(ctx, `已重新载入: ${loaded.resolvedPath} (${loaded.content.length} 字符)。`);
  }

  function setPanelVisibility(visibility: 'on' | 'off' | 'toggle', ctx: ExtensionContext): void {
    state.panelVisible = visibility === 'toggle' ? !state.panelVisible : visibility === 'on';
    syncDesktopSurface(state, ctx);
    notify(ctx, state.panelVisible ? '已在输入框上方展开 Piwin Surge 状态面板。' : '已收起 Piwin Surge 状态面板。');
  }

  pi.on('session_start', async (_event, ctx) => {
    state = createInitialState();
    clearDesktopSurface(ctx);
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    state = createInitialState();
    clearDesktopSurface(ctx);
  });

  pi.on('before_agent_start', async (event, ctx) => {
    if (!state.enabled) return undefined;
    const rewritten = rewriteSystemPrompt({
      mode: state.mode,
      persona: state.persona,
      originalPrompt: event.systemPrompt,
      cwd: ctx.cwd,
    });
    state.lastRewrite = rewritten.telemetry;
    syncDesktopSurface(state, ctx);
    return { systemPrompt: rewritten.systemPrompt };
  });

  pi.registerCommand('surge', {
    description: '提示词切换实验台 [on|off|mode|source|panel|status]',
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const parsed = parseSurgeCommand(args);

      switch (parsed.action) {
        case 'menu':
          if (!ctx.hasUI) {
            applyEnabled(!state.enabled, ctx);
            return;
          }
          await openSurgeMenu(state, ctx, {
            onToggleEnabled: () => applyEnabled(!state.enabled, ctx),
            onSetMode: (mode) => applyMode(mode, ctx),
            onSetSourcePath: (target) => applyExternalSource(target, ctx),
            onResetEmbedded: () => resetToEmbedded(ctx),
            onReloadSource: () => reloadExternalSource(ctx),
            onTogglePanel: () => setPanelVisibility('toggle', ctx),
            onShowStatus: () => {
              state.panelVisible = true;
              syncDesktopSurface(state, ctx);
              notify(ctx, buildStatusSummary(state));
            },
          });
          return;

        case 'enable':
          applyEnabled(true, ctx);
          return;

        case 'disable':
          applyEnabled(false, ctx);
          return;

        case 'toggle':
          applyEnabled(!state.enabled, ctx);
          return;

        case 'status':
          syncDesktopSurface(state, ctx);
          notify(ctx, buildStatusSummary(state));
          return;

        case 'mode':
          if (parsed.mode) {
            applyMode(parsed.mode, ctx);
            return;
          }
          if (parsed.invalidMode) {
            notify(ctx, `不支持的模式 "${parsed.invalidMode}"，可选: strict | replace | append。`, 'warning');
            return;
          }
          if (ctx.hasUI) {
            const selected = await promptModeSelection(state.mode, ctx);
            if (selected) applyMode(selected, ctx);
            return;
          }
          notify(ctx, `当前模式: ${state.mode}；用法: /surge mode strict|replace|append`);
          return;

        case 'source':
          if (parsed.target) {
            await applyExternalSource(parsed.target, ctx);
            return;
          }
          if (ctx.hasUI) {
            const input = await promptSourcePathInput(state, ctx);
            if (input !== undefined && input.trim()) {
              await applyExternalSource(input, ctx);
            }
            return;
          }
          notify(ctx, `当前来源: ${state.sourcePath ?? '内嵌示例'}；用法: /surge source <path|embedded>`);
          return;

        case 'panel':
          setPanelVisibility(parsed.visibility, ctx);
          return;

        case 'refresh':
          await reloadExternalSource(ctx);
          return;

        case 'help':
          notify(ctx, buildHelpSummary());
          return;

        case 'unknown':
          notify(ctx, `未识别子命令 "${parsed.raw}"。\n${buildHelpSummary()}`, 'warning');
          return;
      }
    },
  });
}
