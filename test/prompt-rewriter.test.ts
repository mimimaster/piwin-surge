import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMBEDDED_PROMPT,
  extractWorkingDirectory,
  parseSurgeCommand,
  rewriteSystemPrompt,
  stripStockPromptSections,
} from '../src/prompt-rewriter.js';

const STOCK_PROMPT = [
  'You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files.',
  '',
  'Available tools:',
  '- read: Read files',
  '',
  'Guidelines:',
  '- Be concise.',
  '',
  'Pi documentation:',
  '- Read the manual when asked.',
  '',
  '# Project Context',
  'Project rules stay here.',
  '',
  'Current working directory: /workspace/demo',
].join('\n');

describe('extractWorkingDirectory', () => {
  it('extracts Current working directory or Working directory with fallback', () => {
    expect(extractWorkingDirectory(STOCK_PROMPT, '/fallback')).toBe('/workspace/demo');
    expect(extractWorkingDirectory('Working directory: /other/dir\n', '/fallback')).toBe('/other/dir');
    expect(extractWorkingDirectory('No cwd here', '/fallback')).toBe('/fallback');
  });
});

describe('stripStockPromptSections', () => {
  it('removes stock identity line and Pi documentation while keeping tools and project context', () => {
    const result = stripStockPromptSections(STOCK_PROMPT);
    expect(result.matchedIdentity).toBe(true);
    expect(result.matchedDocs).toBe(true);
    expect(result.stripped).not.toContain('operating inside pi');
    expect(result.stripped).not.toContain('Pi documentation:');
    expect(result.stripped).toContain('Available tools:');
    expect(result.stripped).toContain('# Project Context');
    expect(result.stripped).toContain('Current working directory: /workspace/demo');
  });

  it('reports unmatched markers safely without stripping arbitrary text', () => {
    const result = stripStockPromptSections('Custom system prompt body');
    expect(result.matchedIdentity).toBe(false);
    expect(result.matchedDocs).toBe(false);
    expect(result.stripped).toBe('Custom system prompt body');
  });
});

describe('rewriteSystemPrompt', () => {
  it('isolates prompt in strict mode with persona + cwd only', () => {
    const { systemPrompt, telemetry } = rewriteSystemPrompt({
      mode: 'strict',
      persona: DEFAULT_EMBEDDED_PROMPT,
      originalPrompt: STOCK_PROMPT,
      cwd: '/fallback',
    });
    expect(systemPrompt).toBe(`${DEFAULT_EMBEDDED_PROMPT}\n\nCurrent working directory: /workspace/demo`);
    expect(telemetry.mode).toBe('strict');
    expect(telemetry.rewrittenLength).toBe(systemPrompt.length);
  });

  it('prepends persona over stripped prompt in replace mode and records fallback when absent', () => {
    const matched = rewriteSystemPrompt({
      mode: 'replace',
      persona: 'Persona X',
      originalPrompt: STOCK_PROMPT,
      cwd: '/fallback',
    });
    expect(matched.systemPrompt.startsWith('Persona X\n\nAvailable tools:')).toBe(true);
    expect(matched.telemetry.matchedIdentity).toBe(true);
    expect(matched.telemetry.matchedDocs).toBe(true);
    expect(matched.telemetry.replaceFallback).toBe(false);

    const unmatched = rewriteSystemPrompt({
      mode: 'replace',
      persona: 'Persona X',
      originalPrompt: 'Unrecognized host prompt',
      cwd: '/fallback',
    });
    expect(unmatched.systemPrompt).toBe('Persona X\n\nUnrecognized host prompt');
    expect(unmatched.telemetry.replaceFallback).toBe(true);
  });

  it('prepends persona before untouched prompt in append mode', () => {
    const { systemPrompt, telemetry } = rewriteSystemPrompt({
      mode: 'append',
      persona: 'Persona Y',
      originalPrompt: STOCK_PROMPT,
      cwd: '/fallback',
    });
    expect(systemPrompt).toBe(`Persona Y\n\n${STOCK_PROMPT}`);
    expect(telemetry.mode).toBe('append');
  });
});

describe('parseSurgeCommand', () => {
  it('parses menu, power toggles, mode, source, panel, refresh, and help subcommands', () => {
    expect(parseSurgeCommand('')).toEqual({ action: 'menu' });
    expect(parseSurgeCommand('on')).toEqual({ action: 'enable' });
    expect(parseSurgeCommand('off')).toEqual({ action: 'disable' });
    expect(parseSurgeCommand('toggle')).toEqual({ action: 'toggle' });
    expect(parseSurgeCommand('mode replace')).toEqual({ action: 'mode', mode: 'replace' });
    expect(parseSurgeCommand('mode bogus')).toEqual({ action: 'mode', invalidMode: 'bogus' });
    expect(parseSurgeCommand('source ~/my prompt.md')).toEqual({
      action: 'source',
      target: '~/my prompt.md',
    });
    expect(parseSurgeCommand('panel off')).toEqual({ action: 'panel', visibility: 'off' });
    expect(parseSurgeCommand('reload')).toEqual({ action: 'refresh' });
    expect(parseSurgeCommand('help')).toEqual({ action: 'help' });
    expect(parseSurgeCommand('wat')).toEqual({ action: 'unknown', raw: 'wat' });
  });
});
