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
    label: 'strict — 仅人设 + 工作目录（单变量实验默认，隔离 AGENTS.md 与其它上下文）',
  },
  {
    mode: 'replace',
    label: 'replace — 人设在顶，剥离宿主身份与文档，保留工具与 # Project Context',
  },
  {
    mode: 'append',
    label: 'append — 将人设前置附加到完整宿主系统提示词顶部（基线对照）',
  },
];

export type MenuActions = {
  onToggleEnabled: () => void;
  onSetMode: (mode: SurgeMode) => void;
  onSetCustomPrompt: (text: string) => void;
  onSetSourcePath: (target: string) => Promise<void>;
  onResetEmbedded: () => void;
  onReloadSource: () => Promise<void>;
  onTogglePanel: () => void;
  onShowGuide: () => void;
  onShowStatus: () => void;
};

export function describeSourceShort(state: SurgeState): string {
  if (state.sourceKind === 'custom') return '自定义文本';
  if (state.sourceKind === 'file' && state.sourcePath) return basename(state.sourcePath);
  return '内嵌示例';
}

export function formatStatusChip(state: SurgeState): string | undefined {
  if (!state.enabled) return undefined;
  return `SURGE · ${state.mode} · ${describeSourceShort(state)}`;
}

function formatSnippet(text: string, maxChars = 68): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxChars) return oneLine;
  return `${oneLine.slice(0, maxChars - 1)}…`;
}

export function buildGuideLines(): string[] {
  return [
    'Piwin Surge 快速使用指南（默认关闭，仅在当前会话生效，不会写入磁盘配置）',
    '1. 选人设来源：支持免建文件直接输入文本（/surge prompt ...）、读取本地 .md 文件（/surge source ~/persona.md）或使用内嵌示例',
    '2. 选合成模式：strict（纯人设+工作目录）| replace（去宿主身份与文档，留工具与项目规则）| append（前置叠加）',
    '3. 开启并对话：输入 /surge on 开启（再发消息即生效）；关闭输入 /surge off 立即恢复默认；收起本指南输入 /surge panel off',
    '常用命令：/surge 交互菜单 · /surge mode <模式> · /surge source <路径|embedded> · /surge reload · /surge status',
  ];
}

export function buildWidgetLines(state: SurgeState): string[] | undefined {
  if (state.guideVisible) {
    return buildGuideLines();
  }
  if (!state.panelVisible) return undefined;

  const power = state.enabled ? '已开启' : '已关闭（待命）';
  const sourceLabel = `${describeSourceShort(state)} (${state.persona.length} 字符)`;
  const lines = [
    `Piwin Surge · ${power} | 模式: ${MODE_LABELS[state.mode]} | 来源: ${sourceLabel}`,
    `当前人设预览: "${formatSnippet(state.persona)}"`,
  ];

  if (state.sourceKind === 'file' && state.sourcePath) {
    lines.push(`文件路径: ${state.sourcePath}`);
  }

  if (!state.enabled) {
    lines.push('提示词状态: 当前未改写（开启后从下一条发送的消息开始生效）');
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
    lines.push('生效时机: 下一次发送消息时注入当前人设；退出或新建会话自动复位');
  }

  lines.push('快捷操作: /surge 打开菜单 · /surge guide 使用指南 · /surge panel 显隐面板 · /surge off 关闭');
  return lines;
}

export function buildStatusSummary(state: SurgeState): string {
  const sourceDetail =
    state.sourceKind === 'file' && state.sourcePath
      ? `${state.sourcePath} (${state.persona.length} 字符)`
      : `${describeSourceShort(state)} (${state.persona.length} 字符)`;
  const parts = [
    `Piwin Surge: ${state.enabled ? '开启' : '关闭'}`,
    `模式: ${MODE_LABELS[state.mode]}`,
    `来源: ${sourceDetail}`,
    `人设摘要: "${formatSnippet(state.persona, 48)}"`,
    `桌面面板: ${state.guideVisible ? '使用指南' : state.panelVisible ? '状态面板' : '隐藏'}`,
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
  return buildGuideLines().join('\n');
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

export async function promptCustomPersonaInput(
  state: SurgeState,
  ctx: ExtensionCommandContext,
): Promise<string | undefined> {
  const placeholder =
    state.sourceKind === 'custom'
      ? formatSnippet(state.persona, 60)
      : '例如：你是一位严谨的代码审计专家，所有结论必须给出文件路径与行号。';
  return ctx.ui.input('直接输入或粘贴人设提示词（免建文件，仅限当前会话）', placeholder);
}

export async function promptSourcePathInput(
  state: SurgeState,
  ctx: ExtensionCommandContext,
): Promise<string | undefined> {
  const placeholder = state.sourcePath ?? '~/prompts/persona.md (支持 ~/.md/.txt，或输入 embedded)';
  return ctx.ui.input('输入本地提示词文件路径（支持 ~/ 与引号包裹路径）', placeholder);
}

export async function openSourceMenu(
  state: SurgeState,
  ctx: ExtensionCommandContext,
  actions: Pick<
    MenuActions,
    'onSetCustomPrompt' | 'onSetSourcePath' | 'onResetEmbedded' | 'onReloadSource'
  >,
): Promise<void> {
  const customOpt = '直接输入 / 粘贴人设文本（免建文件，立即生效）';
  const fileOpt = '从本地文件加载提示词 (.md / .txt)';
  const reloadOpt = '重新读取当前外部文件';
  const embeddedOpt = '恢复内置精简示例提示词 (embedded)';
  const inspectOpt = '查看当前完整人设文本';

  const options = [customOpt, fileOpt];
  if (state.sourceKind === 'file') {
    options.push(reloadOpt);
  }
  if (state.sourceKind !== 'embedded') {
    options.push(embeddedOpt);
  }
  options.push(inspectOpt);

  const picked = await ctx.ui.select(
    `配置提示词来源（当前: ${describeSourceShort(state)} · ${state.persona.length} 字符）`,
    options,
  );
  if (!picked) return;

  if (picked === customOpt) {
    const text = await promptCustomPersonaInput(state, ctx);
    if (text !== undefined && text.trim()) {
      actions.onSetCustomPrompt(text);
    }
    return;
  }
  if (picked === fileOpt) {
    const pathInput = await promptSourcePathInput(state, ctx);
    if (pathInput !== undefined && pathInput.trim()) {
      await actions.onSetSourcePath(pathInput);
    }
    return;
  }
  if (picked === reloadOpt) {
    await actions.onReloadSource();
    return;
  }
  if (picked === embeddedOpt) {
    actions.onResetEmbedded();
    return;
  }
  if (picked === inspectOpt) {
    const preview =
      state.persona.length > 850 ? `${state.persona.slice(0, 847)}...` : state.persona;
    ctx.ui.notify(`当前人设 (${describeSourceShort(state)}, ${state.persona.length} 字符):\n${preview}`, 'info');
  }
}

export async function openSurgeMenu(
  state: SurgeState,
  ctx: ExtensionCommandContext,
  actions: MenuActions,
): Promise<void> {
  const toggleOption = state.enabled
    ? `关闭提示词注入（当前: ${state.mode} · ${describeSourceShort(state)}）`
    : `开启提示词注入（当前: ${state.mode} · ${describeSourceShort(state)}）`;
  const sourceOption = `配置提示词来源（文本 / 文件 · 当前: ${describeSourceShort(state)}）`;
  const modeOption = `切换合成模式（当前: ${state.mode}）`;
  const panelOption = state.panelVisible && !state.guideVisible ? '隐藏状态面板' : '显示实时状态面板';
  const guideOption = '查看使用指南与模式说明（快速上手）';
  const statusOption = '查看完整状态摘要';

  const options = [toggleOption, sourceOption, modeOption, panelOption, guideOption, statusOption];
  const picked = await ctx.ui.select('Piwin Surge · 提示词实验控制台', options);
  if (!picked) return;

  if (picked === toggleOption) {
    actions.onToggleEnabled();
    return;
  }
  if (picked === sourceOption) {
    await openSourceMenu(state, ctx, actions);
    return;
  }
  if (picked === modeOption) {
    const mode = await promptModeSelection(state.mode, ctx);
    if (mode) actions.onSetMode(mode);
    return;
  }
  if (picked === panelOption) {
    actions.onTogglePanel();
    return;
  }
  if (picked === guideOption) {
    actions.onShowGuide();
    return;
  }
  if (picked === statusOption) {
    actions.onShowStatus();
  }
}
