import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export const MAX_PROMPT_BYTES = 512 * 1024;

export type PromptLoadResult =
  | { ok: true; resolvedPath: string; content: string; byteLength: number }
  | { ok: false; resolvedPath: string; error: string };

/** Normalize pasted paths (quotes, leading `~/`, relative against cwd). */
export function resolvePromptPath(rawInput: string, cwd: string): string {
  let clean = rawInput.trim();
  if (
    (clean.startsWith('"') && clean.endsWith('"') && clean.length >= 2) ||
    (clean.startsWith("'") && clean.endsWith("'") && clean.length >= 2)
  ) {
    clean = clean.slice(1, -1).trim();
  }
  if (!clean) return '';
  if (clean === '~') return homedir();
  if (clean.startsWith('~/') || clean.startsWith('~\\')) {
    return join(homedir(), clean.slice(2));
  }
  return isAbsolute(clean) ? resolve(clean) : resolve(cwd, clean);
}

/** Read an external Markdown or plain-text prompt without persisting state. */
export async function loadPromptFile(rawInput: string, cwd: string): Promise<PromptLoadResult> {
  const resolvedPath = resolvePromptPath(rawInput, cwd);
  if (!resolvedPath) {
    return { ok: false, resolvedPath: '', error: '请提供有效的提示词文件路径。' };
  }

  let fileStat;
  try {
    fileStat = await stat(resolvedPath);
  } catch (error) {
    return {
      ok: false,
      resolvedPath,
      error: `无法读取文件 (${resolvedPath}): ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!fileStat.isFile()) {
    return {
      ok: false,
      resolvedPath,
      error: `目标不是常规文件 (${resolvedPath})，请选择具体的 .md 或 .txt 文件。`,
    };
  }

  if (fileStat.size > MAX_PROMPT_BYTES) {
    return {
      ok: false,
      resolvedPath,
      error: `提示词文件过大 (${fileStat.size} 字节，上限 ${MAX_PROMPT_BYTES} 字节)。`,
    };
  }

  try {
    const rawBuffer = await readFile(resolvedPath);
    if (rawBuffer.includes(0)) {
      return {
        ok: false,
        resolvedPath,
        error: `目标似乎是二进制文件 (${resolvedPath})，请选择 UTF-8 文本或 .md 文件。`,
      };
    }
    const content = rawBuffer.toString('utf8').replace(/^\uFEFF/, '').trim();
    if (!content) {
      return {
        ok: false,
        resolvedPath,
        error: `提示词文件为空 (${resolvedPath})。`,
      };
    }
    return {
      ok: true,
      resolvedPath,
      content,
      byteLength: Buffer.byteLength(content, 'utf8'),
    };
  } catch (error) {
    return {
      ok: false,
      resolvedPath,
      error: `读取提示词失败 (${resolvedPath}): ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
