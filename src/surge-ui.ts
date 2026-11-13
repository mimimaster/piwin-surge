import { basename } from 'node:path';
import type { ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { SurgeMode, SurgeState } from './prompt-rewriter.js';

export const STATUS_KEY = 'piwin-surge';
export const WIDGET_KEY = 'piwin-surge-panel';

const MODE_LABELS: Record<SurgeMode, string> = {
  strict: 'strict (单变量隔离)',
  replace: 'replace (剥离宿主身份/文档)',
  append: 'append (前置追加对照组)',
};

const MODE_CHOICES: Array<{ mode: SurgeMode; label: string }> = [
  {
    mode: 'strict',
    label: 'strict — 仅人设 + 工作目录（单变量实验默认模式）',
  },
  {
    mode: 'replace',
    label: 'replace — 人设在顶，剥离宿主身份与文档，保留工具与项目上下文',
  },
  {
    mode: 'append',
    label: 'append — 将人设前置附加到宿主系统提示词顶部（对照组）',
  },
];

export type MenuActions = {
  onToggleEnabled: () => void;
  onSetMode: (mode: SurgeMode) => void;
  onSetSourcePath: (target: string) => Promise<void>;
  onResetEmbedded: () => void;
  onReloadSource: () => Promise<void>;
  onTogglePanel: () => void;
  onShowStatus: () => void;
};

export function describeSourceShort(state: SurgeState): string {
  if (state.sourceKind === 'embedded' || !state.sourcePath) {
    return '内嵌示例';
  }
  return basename(state.sourcePath);
}

export function formatStatusChip(state: SurgeState): string | undefined {
  if (!state.enabled) return undefined;
  return `SURGE · ${state.mode} · ${describeSourceShort(state)}`;
}

export function buildWidgetLines(state: SurgeState): string[] | undefined {
  if (!state.panelVisible) return undefined;

  const power = state.enabled ? '已开启' : '已关闭（待命）';
  const sourceLabel = `${describeSourceShort(state)} (${state.persona.length} 字符)`;
  const lines = [`Piwin Surge · ${power} | 模式: ${MODE_LABELS[state.mode]} | 来源: ${sourceLabel}`];

  if (state.sourceKind === 'file' && state.sourcePath) {
    lines.push(`文件路径: ${state.sourcePath}`);
  }

  if (!state.enabled) {
    lines.push('提示词状态: 当前未改写（发送消息前启用即可在下一轮生效；范围仅限当前会话）');
  } else if (state.lastRewrite) {
    const t = state.lastRewrite;
    const modeDetail =
      t.mode === 'replace'
        ? t.replaceFallback
          ? '宿主段落未匹配，已安全退化为前置追加'
          : `宿主身份: ${t.matchedIdentity ? '已剥离' : '未匹配'} · 文档段: ${t.matchedDocs ? '已剥离' : '未匹配'}`
        : t.mode === 'strict'
          ? '已隔离其余宿主与项目片段'
          : '宿主原提示词完整保留';
    lines.push(
      `最近一轮 (${t.mode}): 原 ${t.originalLength} 字符 -> 注入 ${t.rewrittenLength} 字符 | ${modeDetail}`,
    );
  } else {
    lines.push('生效时机: 下一次模型调用起注入当前人设；退出或新建会话自动复位');
  }

  lines.push('快捷指令: /surge 控制菜单 · /surge panel 显隐面板 · /surge off 关闭');
  return lines;
}

export function buildStatusSummary(state: SurgeState): string {
  const parts = [
    `Piwin Surge: ${state.enabled ? '开启' : '关闭'}`,
    `模式: ${MODE_LABELS[state.mode]}`,
    `来源: ${
      state.sourceKind === 'file' && state.sourcePath
        ? `${state.sourcePath} (${state.persona.length} 字符)`
        : `内嵌示例 (${state.persona.length} 字符)`
    }`,
    `桌面面板: ${state.panelVisible ? '显示' : '隐藏'}`,
  ];
  if (state.lastRewrite) {
    const t = state.lastRewrite;
    const extra =
      t.mode === 'replace'
        ? `, 身份:${t.matchedIdentity ? '已剥离' : '未匹配'}, 文档:${t.matchedDocs ? '已剥离' : '未匹配'}`
        : '';
    parts.push(`最近一轮: ${t.mode} ${t.originalLength} -> ${t.rewrittenLength} 字符${extra}`);
  }
  return parts.join(' | ');
}

export function buildHelpSummary(): string {
  return [
    '/surge — 打开桌面端交互控制台（非 UI 环境自动切换开关）',
    '/surge on | off | toggle — 开关当前会话的系统提示词改写',
    '/surge mode strict|replace|append — 切换合成模式',
    '/surge source <path|embedded> — 指定外部文件或切回内嵌示例',
    '/surge reload — 重新读取外部提示词文件',
    '/surge panel [on|off] — 显示/隐藏输入框上方状态面板',
    '/surge status — 查看当前模式、来源与最近一轮注入统计',
  ].join('\n');
}

export function syncDesktopSurface(state: SurgeState, ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus(STATUS_KEY, formatStatusChip(state));
  const lines = buildWidgetLines(state);
  ctx.ui.setWidget(WIDGET_KEY, lines, lines ? { placement: 'aboveEditor' } : undefined);
}

export function clearDesktopSurface(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus(STATUS_KEY, undefined);
  ctx.ui.setWidget(WIDGET_KEY, undefined);
}

export async function promptModeSelection(
  currentMode: SurgeMode,
  ctx: ExtensionCommandContext,
): Promise<SurgeMode | undefined> {
  const options = MODE_CHOICES.map((choice) =>
    choice.mode === currentMode ? `[当前] ${choice.label}` : choice.label,
  );
  const picked = await ctx.ui.select('选择系统提示词合成模式', options);
  if (!picked) return undefined;
  const hit = MODE_CHOICES.find((choice) => picked.includes(choice.label));
  return hit?.mode;
}

export async function promptSourcePathInput(
  state: SurgeState,
  ctx: ExtensionCommandContext,
): Promise<string | undefined> {
  const placeholder = state.sourcePath ?? '~/prompts/persona.md (输入 embedded 恢复内嵌示例)';
  return ctx.ui.input('输入提示词文件路径（支持 ~/ 与 .md/.txt，或输入 embedded）', placeholder);
}

export async function openSurgeMenu(
  state: SurgeState,
  ctx: ExtensionCommandContext,
  actions: MenuActions,
): Promise<void> {
  const toggleOption = state.enabled
    ? `关闭提示词注入（当前: ${state.mode} · ${describeSourceShort(state)}）`
    : `开启提示词注入（当前: ${state.mode} · ${describeSourceShort(state)}）`;
  const modeOption = `切换合成模式（当前: ${state.mode}）`;
  const inputSourceOption = `设置提示词文件路径（当前: ${describeSourceShort(state)}）`;
  const embeddedOption = '切回内嵌示例提示词 (embedded)';
  const reloadOption = '重新读取外部提示词文件';
  const panelOption = state.panelVisible ? '隐藏输入框上方状态面板' : '显示输入框上方状态面板';
  const statusOption = '查看详细状态与注入统计';

  const options = [toggleOption, modeOption, inputSourceOption];
  if (state.sourceKind === 'file') {
    options.push(reloadOption, embeddedOption);
  }
  options.push(panelOption, statusOption);

  const picked = await ctx.ui.select('Piwin Surge · 提示词控制台', options);
  if (!picked) return;

  if (picked === toggleOption) {
    actions.onToggleEnabled();
    return;
  }
  if (picked === modeOption) {
    const mode = await promptModeSelection(state.mode, ctx);
    if (mode) actions.onSetMode(mode);
    return;
  }
  if (picked === inputSourceOption) {
    const input = await promptSourcePathInput(state, ctx);
    if (input !== undefined && input.trim()) {
      await actions.onSetSourcePath(input);
    }
    return;
  }
  if (picked === reloadOption) {
    await actions.onReloadSource();
    return;
  }
  if (picked === embeddedOption) {
    actions.onResetEmbedded();
    return;
  }
  if (picked === panelOption) {
    actions.onTogglePanel();
    return;
  }
  if (picked === statusOption) {
    actions.onShowStatus();
  }
}
