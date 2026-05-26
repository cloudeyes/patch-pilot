/* --------------------------------------------------------------------------
 *  PatchPilot — Git extended diff helpers
 * ----------------------------------------------------------------------- */

import * as DiffLib from 'diff';
import { DiffParsedPatch, PatchOperationType } from './types/patchTypes';

export interface GitDiffOperation {
  operationType: PatchOperationType;
  sourcePath?: string;
  targetPath?: string;
  patch?: DiffParsedPatch;
  rawBlock: string;
  additions: number;
  deletions: number;
}

function cleanPath(path?: string): string | undefined {
  if (!path) {return undefined;}
  if (path === '/dev/null') {return '/dev/null';}
  return path
    .replace(/^[ab]\//, '')
    .replace(/[\x00-\x1F\x7F]+/g, '')
    .replace(/\\r|\\n/g, '')
    .trim();
}

function parseDiffGitHeader(line: string): { oldPath?: string; newPath?: string } {
  const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (!match) {
    return { oldPath: undefined, newPath: undefined };
  }

  return {
    oldPath: cleanPath(match[1]),
    newPath: cleanPath(match[2]),
  };
}

export function splitDiffBlocks(diffText: string): string[] {
  const normalized = diffText.replace(/\r\n|\r/g, '\n');
  const starts = [...normalized.matchAll(/^diff --git .+$/gm)].map((m) => m.index ?? 0);

  if (starts.length === 0) {
    return normalized.trim() ? [normalized] : [];
  }

  const blocks: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : normalized.length;
    blocks.push(normalized.slice(start, end).trim());
  }

  return blocks.filter(Boolean);
}

export function parseGitDiffOperations(diffText: string): GitDiffOperation[] {
  const blocks = splitDiffBlocks(diffText);
  const operations: GitDiffOperation[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const headerLine = lines.find((l) => l.startsWith('diff --git')) ?? '';
    const headerPaths = parseDiffGitHeader(headerLine);

    const renameFrom = lines.find((l) => l.startsWith('rename from '))?.slice('rename from '.length).trim();
    const renameTo = lines.find((l) => l.startsWith('rename to '))?.slice('rename to '.length).trim();

    const minusHeader = lines.find((l) => l.startsWith('--- '))?.slice(4).trim();
    const plusHeader = lines.find((l) => l.startsWith('+++ '))?.slice(4).trim();

    const sourceCandidate = cleanPath(renameFrom)
      ?? cleanPath(minusHeader)
      ?? cleanPath(headerPaths.oldPath);
    const targetCandidate = cleanPath(renameTo)
      ?? cleanPath(plusHeader)
      ?? cleanPath(headerPaths.newPath);

    const hasNewFileMode = lines.some((l) => l.startsWith('new file mode '));
    const hasDeletedFileMode = lines.some((l) => l.startsWith('deleted file mode '));

    const parsed = (DiffLib.parsePatch(block) ?? []) as DiffParsedPatch[];
    const patch = parsed.length > 0 ? parsed[0] : undefined;

    const isAdd = hasNewFileMode || sourceCandidate === '/dev/null';
    const isDelete = hasDeletedFileMode || targetCandidate === '/dev/null';
    const isRename = !!renameFrom || !!renameTo || (!!sourceCandidate && !!targetCandidate && sourceCandidate !== '/dev/null' && targetCandidate !== '/dev/null' && sourceCandidate !== targetCandidate);

    let operationType: PatchOperationType = 'modify';
    if (isAdd) {
      operationType = 'add';
    } else if (isDelete) {
      operationType = 'delete';
    } else if (isRename) {
      operationType = 'rename';
    }

    let additions = 0;
    let deletions = 0;

    if (patch?.hunks?.length) {
      for (const h of patch.hunks) {
        for (const l of h.lines) {
          if (l.startsWith('+')) {additions += 1;}
          else if (l.startsWith('-')) {deletions += 1;}
        }
      }
    } else {
      for (const l of lines) {
        if (l.startsWith('+++ ') || l.startsWith('--- ')) {continue;}
        if (l.startsWith('+')) {additions += 1;}
        else if (l.startsWith('-')) {deletions += 1;}
      }
    }

    const sourcePath = sourceCandidate === '/dev/null' ? undefined : sourceCandidate;
    const targetPath = targetCandidate === '/dev/null' ? undefined : targetCandidate;

    operations.push({
      operationType,
      sourcePath,
      targetPath,
      patch,
      rawBlock: block,
      additions,
      deletions,
    });
  }

  return operations;
}
