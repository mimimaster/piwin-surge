export type SurgeMode = 'strict' | 'replace' | 'append';

export type PromptSourceKind = 'embedded' | 'file';

export type RewriteTelemetry = {
  mode: SurgeMode;
  originalLength: number;
  rewrittenLength: number;
  matchedIdentity: boolean;
  matchedDocs: boolean;
  replaceFallback: boolean;
};

export type SurgeState = {
  enabled: boolean;
  mode: SurgeMode;
  sourceKind: PromptSourceKind;
  /** Resolved file path when sourceKind === 'file'. */
  sourcePath?: string;
  persona: string;
  panelVisible: boolean;
  lastRewrite?: RewriteTelemetry;
};

export type ParsedSurgeCommand =
  | { action: 'menu' }
  | { action: 'enable' }
  | { action: 'disable' }
  | { action: 'toggle' }
  | { action: 'status' }
  | { action: 'mode'; mode?: SurgeMode; invalidMode?: string }
  | { action: 'source'; target?: string }
  | { action: 'panel'; visibility: 'on' | 'off' | 'toggle' }
  | { action: 'refresh' }
  | { action: 'help' }
  | { action: 'unknown'; raw: string };

export const DEFAULT_EMBEDDED_PROMPT =
  'You follow the user instructions in this session directly, accurately, and concisely. Prioritize factual observations and ask clarifying questions only when requirements are ambiguous.';

const IDENTITY_MARKER =
  'You are an expert coding assistant operating inside pi, a coding agent harness.';
const DOCS_START_MARKER = 'Pi documentation:';
const DOCS_FALLBACK_START_MARKER =
  'Read the documentation carefully when the user asks about pi itself:';
const DOCS_END_MARKER = '# Project Context';
const CWD_LINE_PREFIXES = ['Current working directory: ', 'Working directory: '] as const;

export function createInitialState(): SurgeState {
  return {
    enabled: false,
    mode: 'strict',
    sourceKind: 'embedded',
    persona: DEFAULT_EMBEDDED_PROMPT,
    panelVisible: false,
  };
}

export function isSurgeMode(value: string): value is SurgeMode {
  return value === 'strict' || value === 'replace' || value === 'append';
}

export function extractWorkingDirectory(systemPrompt: string, fallbackCwd: string): string {
  for (const line of systemPrompt.split(/\r?\n/)) {
    for (const prefix of CWD_LINE_PREFIXES) {
      if (line.startsWith(prefix)) {
        const value = line.slice(prefix.length).trim();
        if (value) return value;
      }
    }
  }
  return fallbackCwd;
}

export function stripStockPromptSections(systemPrompt: string): {
  stripped: string;
  matchedIdentity: boolean;
  matchedDocs: boolean;
} {
  let result = systemPrompt;
  let matchedIdentity = false;
  let matchedDocs = false;

  const idIdx = result.indexOf(IDENTITY_MARKER);
  if (idIdx >= 0) {
    matchedIdentity = true;
    const afterLineBreak = result.indexOf('\n', idIdx);
    const cutEnd = afterLineBreak >= 0 ? afterLineBreak + 1 : result.length;
    result = (result.slice(0, idIdx) + result.slice(cutEnd)).replace(/^\n+/, '');
  }

  const docsIdx = result.indexOf(DOCS_START_MARKER);
  if (docsIdx >= 0) {
    matchedDocs = true;
    const endIdx = result.indexOf(DOCS_END_MARKER, docsIdx);
    result =
      endIdx >= 0
        ? (result.slice(0, docsIdx) + result.slice(endIdx)).trimStart()
        : result.slice(0, docsIdx).trimEnd();
    return { stripped: result, matchedIdentity, matchedDocs };
  }

  const fallbackIdx = result.indexOf(DOCS_FALLBACK_START_MARKER);
  if (fallbackIdx >= 0) {
    matchedDocs = true;
    const projectCtxIdx = result.indexOf(DOCS_END_MARKER, fallbackIdx);
    const blankBreakIdx = result.indexOf('\n\n', fallbackIdx);
    const cutEnd =
      projectCtxIdx >= 0
        ? projectCtxIdx
        : blankBreakIdx >= 0
          ? blankBreakIdx + 2
          : result.length;
    result = (result.slice(0, fallbackIdx) + result.slice(cutEnd)).trim();
  }

  return { stripped: result, matchedIdentity, matchedDocs };
}

export function rewriteSystemPrompt(options: {
  mode: SurgeMode;
  persona: string;
  originalPrompt: string;
  cwd: string;
}): { systemPrompt: string; telemetry: RewriteTelemetry } {
  const persona = options.persona.trim();
  const originalPrompt = options.originalPrompt;

  if (options.mode === 'strict') {
    const resolvedCwd = extractWorkingDirectory(originalPrompt, options.cwd);
    const systemPrompt = `${persona}\n\nCurrent working directory: ${resolvedCwd}`;
    return {
      systemPrompt,
      telemetry: {
        mode: 'strict',
        originalLength: originalPrompt.length,
        rewrittenLength: systemPrompt.length,
        matchedIdentity: false,
        matchedDocs: false,
        replaceFallback: false,
      },
    };
  }

  if (options.mode === 'replace') {
    const { stripped, matchedIdentity, matchedDocs } = stripStockPromptSections(originalPrompt);
    const replaceFallback = !matchedIdentity && !matchedDocs;
    const remainder = replaceFallback ? originalPrompt : stripped;
    const systemPrompt = remainder ? `${persona}\n\n${remainder}` : persona;
    return {
      systemPrompt,
      telemetry: {
        mode: 'replace',
        originalLength: originalPrompt.length,
        rewrittenLength: systemPrompt.length,
        matchedIdentity,
        matchedDocs,
        replaceFallback,
      },
    };
  }

  const systemPrompt = originalPrompt ? `${persona}\n\n${originalPrompt}` : persona;
  return {
    systemPrompt,
    telemetry: {
      mode: 'append',
      originalLength: originalPrompt.length,
      rewrittenLength: systemPrompt.length,
      matchedIdentity: false,
      matchedDocs: false,
      replaceFallback: false,
    },
  };
}

export function parseSurgeCommand(rawArgs: string): ParsedSurgeCommand {
  const trimmed = rawArgs.trim();
  if (!trimmed) return { action: 'menu' };

  const spaceIdx = trimmed.search(/\s/);
  const head = (spaceIdx >= 0 ? trimmed.slice(0, spaceIdx) : trimmed).toLowerCase();
  const rest = spaceIdx >= 0 ? trimmed.slice(spaceIdx + 1).trim() : '';

  switch (head) {
    case 'on':
    case 'enable':
      return { action: 'enable' };
    case 'off':
    case 'disable':
      return { action: 'disable' };
    case 'toggle':
      return { action: 'toggle' };
    case 'status':
      return { action: 'status' };
    case 'mode': {
      if (!rest) return { action: 'mode' };
      const normalized = rest.toLowerCase();
      return isSurgeMode(normalized)
        ? { action: 'mode', mode: normalized }
        : { action: 'mode', invalidMode: rest };
    }
    case 'source':
      return rest ? { action: 'source', target: rest } : { action: 'source' };
    case 'panel': {
      const normalized = rest.toLowerCase();
      if (!normalized || normalized === 'toggle') return { action: 'panel', visibility: 'toggle' };
      if (normalized === 'on' || normalized === 'show') return { action: 'panel', visibility: 'on' };
      if (normalized === 'off' || normalized === 'hide') return { action: 'panel', visibility: 'off' };
      return { action: 'unknown', raw: trimmed };
    }
    case 'reload':
    case 'refresh':
      return { action: 'refresh' };
    case 'help':
    case '-h':
    case '--help':
      return { action: 'help' };
    default:
      return { action: 'unknown', raw: trimmed };
  }
}
