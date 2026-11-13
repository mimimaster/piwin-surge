/**
 * Piwin Surge — 会话级系统提示词切换控制台（输入 `/surge` 打开交互配置与新手指南，支持状态芯片与预览面板）。
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
  openSourceMenu,
  openSurgeMenu,
  promptCustomPersonaInput,
  promptModeSelection,
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
    state.guideVisible = false;
    state.panelVisible = enabled;
    if (!enabled) {
      delete state.lastRewrite;
    }
    syncDesktopSurface(state, ctx);
    notify(
      ctx,
      enabled
        ? `Piwin Surge 已开启 · 模式: ${state.mode} · 来源: ${describeSourceShort(state)}（下条消息生效，仅限当前会话）`
        : 'Piwin Surge 已关闭 · 已恢复 piwin 默认系统提示词。',
      'info',
    );
  }

  function applyMode(mode: SurgeMode, ctx: ExtensionContext): void {
    state.mode = mode;
    state.guideVisible = false;
    syncDesktopSurface(state, ctx);
    notify(ctx, `合成模式已切换为 ${mode}${state.enabled ? '（下条消息生效）' : '（当前未开启，运行 /surge on 或在 /surge 菜单启用）'}。`);
  }

  function applyCustomPrompt(rawText: string, ctx: ExtensionContext): void {
    const content = rawText.trim();
    if (!content) {
      notify(ctx, '提示词文本不能为空，已保持原设置。', 'warning');
      return;
    }
    state.sourceKind = 'custom';
    delete state.sourcePath;
    state.persona = content;
    state.guideVisible = false;
    syncDesktopSurface(state, ctx);
    notify(
      ctx,
      `已设定自定义人设 (${content.length} 字符)${state.enabled ? '，下条消息生效' : '；运行 /surge on 开启注入'}。`,
    );
  }

  function resetToEmbedded(ctx: ExtensionContext): void {
    state.sourceKind = 'embedded';
    delete state.sourcePath;
    state.persona = DEFAULT_EMBEDDED_PROMPT;
    state.guideVisible = false;
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
    state.guideVisible = false;
    syncDesktopSurface(state, ctx);
    notify(ctx, `已载入外部提示词: ${loaded.resolvedPath} (${loaded.content.length} 字符)。`);
  }

  async function reloadExternalSource(ctx: ExtensionContext): Promise<void> {
    if (state.sourceKind !== 'file' || !state.sourcePath) {
      notify(ctx, `当前来源为${describeSourceShort(state)} (${state.persona.length} 字符)，仅外部文件支持重载。`);
      return;
    }
    const loaded = await loadPromptFile(state.sourcePath, ctx.cwd);
    if (!loaded.ok) {
      notify(ctx, `${loaded.error} 已继续保留上次成功载入的文本。`, 'warning');
      return;
    }
    state.persona = loaded.content;
    state.guideVisible = false;
    syncDesktopSurface(state, ctx);
    notify(ctx, `已重新载入: ${loaded.resolvedPath} (${loaded.content.length} 字符)。`);
  }

  function setPanelVisibility(visibility: 'on' | 'off' | 'toggle', ctx: ExtensionContext): void {
    if (visibility === 'off') {
      state.guideVisible = false;
      state.panelVisible = false;
    } else if (visibility === 'on') {
      state.guideVisible = false;
      state.panelVisible = true;
    } else {
      const currentlyShowingStatus = state.panelVisible && !state.guideVisible;
      state.guideVisible = false;
      state.panelVisible = !currentlyShowingStatus;
    }
    syncDesktopSurface(state, ctx);
    notify(ctx, state.panelVisible ? '已在输入框上方展开 Piwin Surge 状态面板。' : '已收起输入框上方提示面板。');
  }

  function showGuide(ctx: ExtensionContext): void {
    state.guideVisible = true;
    syncDesktopSurface(state, ctx);
    notify(ctx, buildHelpSummary());
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
    description: '系统提示词控制台（直接运行打开菜单，或传 on|off|mode|source|prompt|guide）',
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
            onSetCustomPrompt: (text) => applyCustomPrompt(text, ctx),
            onSetSourcePath: (target) => applyExternalSource(target, ctx),
            onResetEmbedded: () => resetToEmbedded(ctx),
            onReloadSource: () => reloadExternalSource(ctx),
            onTogglePanel: () => setPanelVisibility('toggle', ctx),
            onShowGuide: () => showGuide(ctx),
            onShowStatus: () => {
              state.guideVisible = false;
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
          state.guideVisible = false;
          syncDesktopSurface(state, ctx);
          notify(ctx, buildStatusSummary(state));
          return;

        case 'guide':
          showGuide(ctx);
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
            await openSourceMenu(state, ctx, {
              onSetCustomPrompt: (text) => applyCustomPrompt(text, ctx),
              onSetSourcePath: (target) => applyExternalSource(target, ctx),
              onResetEmbedded: () => resetToEmbedded(ctx),
              onReloadSource: () => reloadExternalSource(ctx),
            });
            return;
          }
          notify(ctx, `当前来源: ${state.sourcePath ?? describeSourceShort(state)}；用法: /surge source <path|embedded>`);
          return;

        case 'prompt':
          if (parsed.text) {
            applyCustomPrompt(parsed.text, ctx);
            return;
          }
          if (ctx.hasUI) {
            const input = await promptCustomPersonaInput(state, ctx);
            if (input !== undefined && input.trim()) {
              applyCustomPrompt(input, ctx);
            }
            return;
          }
          notify(ctx, '用法: /surge prompt <人设提示词文本>');
          return;

        case 'panel':
          setPanelVisibility(parsed.visibility, ctx);
          return;

        case 'refresh':
          await reloadExternalSource(ctx);
          return;

        case 'unknown':
          notify(ctx, `未识别子命令 "${parsed.raw}"。\n${buildHelpSummary()}`, 'warning');
          return;
      }
    },
  });
}
