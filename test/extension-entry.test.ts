import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import piwinSurgeExtension from '../index.js';
import { STATUS_KEY, WIDGET_KEY } from '../src/surge-ui.js';

type HookHandler = (event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown;
type CommandDef = {
  description: string;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
};

type Harness = {
  fireHook: (name: string, event?: unknown) => Promise<unknown>;
  runCommand: (args: string) => Promise<void>;
  notifications: Array<{ message: string; level: string | undefined }>;
  statuses: Map<string, string | undefined>;
  widgets: Map<string, { lines: string[] | undefined; placement?: string }>;
  queueSelect: (picker: (options: string[]) => string | undefined) => void;
  queueInput: (value: string | undefined) => void;
};

function createHarness(cwd: string, hasUI = true): Harness {
  const hooks = new Map<string, HookHandler[]>();
  const commands = new Map<string, CommandDef>();
  const notifications: Array<{ message: string; level: string | undefined }> = [];
  const statuses = new Map<string, string | undefined>();
  const widgets = new Map<string, { lines: string[] | undefined; placement?: string }>();
  const selectQueue: Array<(options: string[]) => string | undefined> = [];
  const inputQueue: Array<string | undefined> = [];

  const ctx = {
    cwd,
    hasUI,
    ui: {
      notify(message: string, level?: 'info' | 'warning' | 'error') {
        notifications.push({ message, level });
      },
      setStatus(key: string, text: string | undefined) {
        statuses.set(key, text);
      },
      setWidget(key: string, content: string[] | undefined, opts?: { placement?: string }) {
        widgets.set(key, { lines: content, ...(opts?.placement ? { placement: opts.placement } : {}) });
      },
      async select(_title: string, options: string[]) {
        const next = selectQueue.shift();
        return next ? next(options) : undefined;
      },
      async input() {
        return inputQueue.shift();
      },
      async confirm() {
        return true;
      },
      setWorkingMessage() {},
    },
  } as unknown as ExtensionCommandContext;

  const pi = {
    on(name: string, handler: HookHandler) {
      const list = hooks.get(name) ?? [];
      list.push(handler);
      hooks.set(name, list);
    },
    registerCommand(name: string, def: CommandDef) {
      commands.set(name, def);
    },
  } as unknown as ExtensionAPI;

  piwinSurgeExtension(pi);

  return {
    async fireHook(name: string, event: unknown = {}) {
      let last: unknown;
      for (const fn of hooks.get(name) ?? []) {
        last = await fn(event, ctx);
      }
      return last;
    },
    async runCommand(args: string) {
      const cmd = commands.get('surge');
      if (!cmd) throw new Error('surge command not registered');
      await cmd.handler(args, ctx);
    },
    notifications,
    statuses,
    widgets,
    queueSelect(picker) {
      selectQueue.push(picker);
    },
    queueInput(value) {
      inputQueue.push(value);
    },
  };
}

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'piwin-surge-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('piwin-surge extension lifecycle and Desktop UI bridge', () => {
  it('starts disabled with no prompt rewrite or surface noise', async () => {
    const h = createHarness(tempDir);
    await h.fireHook('session_start');
    const out = await h.fireHook('before_agent_start', { systemPrompt: 'Stock prompt' });
    expect(out).toBeUndefined();
    expect(h.statuses.get(STATUS_KEY)).toBeUndefined();
    expect(h.widgets.get(WIDGET_KEY)?.lines).toBeUndefined();
  });

  it('publishes status chip, aboveEditor widget, and rewrites prompt when enabled', async () => {
    const h = createHarness(tempDir);
    await h.fireHook('session_start');
    await h.runCommand('on');

    expect(h.statuses.get(STATUS_KEY)).toBe('SURGE · strict · 内嵌示例');
    const widgetBefore = h.widgets.get(WIDGET_KEY);
    expect(widgetBefore?.placement).toBe('aboveEditor');
    expect(widgetBefore?.lines?.[0]).toContain('已开启');

    const rewritten = (await h.fireHook('before_agent_start', {
      systemPrompt: 'Stock\nCurrent working directory: /demo/work',
    })) as { systemPrompt: string };
    expect(rewritten.systemPrompt).toContain('Current working directory: /demo/work');
    expect(rewritten.systemPrompt).not.toContain('Stock');
    expect(h.widgets.get(WIDGET_KEY)?.lines?.some((line) => line.includes('最近一轮 (strict)'))).toBe(true);

    await h.runCommand('off');
    expect(h.statuses.get(STATUS_KEY)).toBeUndefined();
    expect(h.widgets.get(WIDGET_KEY)?.lines).toBeUndefined();
  });

  it('loads external prompt files (supporting quoted paths), reloads edits, and rolls back on errors', async () => {
    const promptPath = join(tempDir, 'persona.md');
    await writeFile(promptPath, '  First persona v1  \n', 'utf8');

    const h = createHarness(tempDir);
    await h.runCommand(`source "${promptPath}"`);
    await h.runCommand('on');

    const first = (await h.fireHook('before_agent_start', {
      systemPrompt: 'Original',
    })) as { systemPrompt: string };
    expect(first.systemPrompt.startsWith('First persona v1')).toBe(true);
    expect(h.statuses.get(STATUS_KEY)).toBe('SURGE · strict · persona.md');

    await writeFile(promptPath, 'Second persona v2', 'utf8');
    await h.runCommand('reload');
    const second = (await h.fireHook('before_agent_start', {
      systemPrompt: 'Original',
    })) as { systemPrompt: string };
    expect(second.systemPrompt.startsWith('Second persona v2')).toBe(true);

    // Invalid path rolls back to previous valid persona without crashing or overwriting
    await h.runCommand('source ./does-not-exist.md');
    expect(h.notifications.at(-1)?.level).toBe('warning');
    const third = (await h.fireHook('before_agent_start', {
      systemPrompt: 'Original',
    })) as { systemPrompt: string };
    expect(third.systemPrompt.startsWith('Second persona v2')).toBe(true);

    await h.runCommand('source embedded');
    expect(h.statuses.get(STATUS_KEY)).toBe('SURGE · strict · 内嵌示例');
  });

  it('opens interactive Desktop select/input flow when invoked with no arguments', async () => {
    const promptPath = join(tempDir, 'custom.md');
    await writeFile(promptPath, 'Interactive custom persona', 'utf8');

    const h = createHarness(tempDir, true);
    // Step 1: pick mode change -> append
    h.queueSelect((opts) => opts.find((o) => o.includes('切换合成模式')));
    h.queueSelect((opts) => opts.find((o) => o.startsWith('append')));
    await h.runCommand('');

    // Step 2: pick external path -> input path
    h.queueSelect((opts) => opts.find((o) => o.includes('设置提示词文件路径')));
    h.queueInput(promptPath);
    await h.runCommand('');

    // Step 3: enable via menu
    h.queueSelect((opts) => opts.find((o) => o.includes('开启提示词注入')));
    await h.runCommand('');

    expect(h.statuses.get(STATUS_KEY)).toBe('SURGE · append · custom.md');
    const out = (await h.fireHook('before_agent_start', {
      systemPrompt: 'Base prompt',
    })) as { systemPrompt: string };
    expect(out.systemPrompt).toBe('Interactive custom persona\n\nBase prompt');
  });

  it('clears surface on session_start and session_shutdown', async () => {
    const h = createHarness(tempDir);
    await h.runCommand('on');
    expect(h.statuses.get(STATUS_KEY)).toBeDefined();

    await h.fireHook('session_shutdown');
    expect(h.statuses.get(STATUS_KEY)).toBeUndefined();
    expect(h.widgets.get(WIDGET_KEY)?.lines).toBeUndefined();
  });
});
