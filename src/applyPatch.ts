/* --------------------------------------------------------------------------
 *  PatchPilot — AI‑grade unified‑diff applier
 * ----------------------------------------------------------------------- */

import * as vscode from 'vscode';
import { normalizeDiff } from './utilities';
import { autoStageFiles } from './gitSecure';
import { trackEvent } from './telemetry';
import { GitDiffOperation, parseGitDiffOperations } from './gitExtendedDiff';
import {
  PatchStrategyFactory,
  PatchResult,
} from './strategies/patchStrategy';
import {
  ApplyOptions,
  ApplyResult,
  FileInfo,
  DiffParsedPatch,
  PatchOperationType,
} from './types/patchTypes';
import { useOptimizedStrategies } from './strategies/optimizedPatchStrategy';

/* ────────────────────── Multi‑file entry point ─────────────────────────── */

export async function applyPatch(
  patchText: string,
  opts: ApplyOptions = {},
): Promise<ApplyResult[]> {
  trackEvent('apply_patch_start', { preview: opts.preview ?? true });

  const cfg = vscode.workspace.getConfiguration('patchPilot');
  const autoStage = opts.autoStage ?? cfg.get('autoStage', false);
  const fuzz = (opts.fuzz ?? cfg.get('fuzzFactor', 2)) as 0 | 1 | 2 | 3;
  const preview = opts.preview ?? true;
  const mtimeCheck = opts.mtimeCheck ?? cfg.get('mtimeCheck', true);

  const canonical = normalizeDiff(patchText);
  const operations = parseGitDiffOperations(canonical);
  if (operations.length === 0 || operations.every((op) => !op.patch && op.operationType === 'modify')) {
    throw new Error('No valid patches found in the provided text.');
  }

  const results: ApplyResult[] = [];
  const staged: string[] = [];

  for (const operation of operations) {
    const relPath = operation.targetPath ?? operation.sourcePath ?? 'unknown-file';

    try {
      switch (operation.operationType) {
      case 'add': {
        const targetPath = operation.targetPath ?? relPath;
        const targetUri = await resolveWorkspaceTarget(targetPath);
        const existingTarget = await pathExists(targetUri);
        if (existingTarget) {
          results.push({
            file: targetPath,
            status: 'failed',
            reason: 'Target file already exists for add operation',
            operationType: 'add',
            targetPath,
          });
          continue;
        }

        let patched = '';
        let strategy: string | undefined = 'add-file';
        if (operation.patch && operation.patch.hunks.length > 0) {
          const applyResult = await applyPatchToContent('', operation.patch, fuzz);
          if (!applyResult.success) {
            const reason = applyResult.diagnostics
              ? `Patch could not be applied\n${applyResult.diagnostics}`
              : 'Patch could not be applied';
            results.push({
              file: targetPath,
              status: 'failed',
              reason,
              operationType: 'add',
              targetPath,
            });
            continue;
          }
          patched = applyResult.patched;
          strategy = applyResult.strategy ?? strategy;
        }

        if (preview) {
          const confirmed = await showPatchPreview(targetUri, '', patched, targetPath);
          if (!confirmed) {
            results.push({
              file: targetPath,
              status: 'failed',
              reason: 'User cancelled after preview',
              operationType: 'add',
              targetPath,
            });
            continue;
          }
        }

        await ensureParentDirectory(targetUri);
        await vscode.workspace.fs.writeFile(targetUri, new TextEncoder().encode(patched));

        results.push({
          file: targetPath,
          status: 'applied',
          strategy,
          operationType: 'add',
          targetPath,
        });
        if (autoStage) {staged.push(targetPath);}
        break;
      }
      case 'delete': {
        const sourcePath = operation.sourcePath ?? relPath;
        const sourceUri = await resolveWorkspaceFile(sourcePath);
        if (!sourceUri) {
          results.push({
            file: sourcePath,
            status: 'failed',
            reason: 'File not found in workspace',
            operationType: 'delete',
            sourcePath,
          });
          continue;
        }

        let fileStats: vscode.FileStat | undefined;
        if (mtimeCheck) {
          try {
            fileStats = await vscode.workspace.fs.stat(sourceUri);
          } catch {
            fileStats = undefined;
          }
        }

        const doc = await vscode.workspace.openTextDocument(sourceUri);
        const original = doc.getText();

        if (preview) {
          const confirmed = await showPatchPreview(sourceUri, original, '', sourcePath);
          if (!confirmed) {
            results.push({
              file: sourcePath,
              status: 'failed',
              reason: 'User cancelled after preview',
              operationType: 'delete',
              sourcePath,
            });
            continue;
          }
        }

        if (mtimeCheck && fileStats) {
          const proceed = await confirmMtime(sourceUri, sourcePath, fileStats);
          if (!proceed) {
            results.push({
              file: sourcePath,
              status: 'failed',
              reason: 'File modified externally, update aborted',
              operationType: 'delete',
              sourcePath,
            });
            continue;
          }
        }

        await vscode.workspace.fs.delete(sourceUri, { useTrash: false });
        results.push({
          file: sourcePath,
          status: 'applied',
          strategy: 'delete-file',
          operationType: 'delete',
          sourcePath,
        });
        if (autoStage) {staged.push(sourcePath);}
        break;
      }
      case 'rename': {
        const sourcePath = operation.sourcePath;
        const targetPath = operation.targetPath;
        if (!sourcePath || !targetPath) {
          results.push({
            file: relPath,
            status: 'failed',
            reason: 'Rename operation missing source or target path',
            operationType: 'rename',
            sourcePath,
            targetPath,
          });
          continue;
        }

        const sourceUri = await resolveWorkspaceFile(sourcePath);
        if (!sourceUri) {
          results.push({
            file: targetPath,
            status: 'failed',
            reason: 'File not found in workspace',
            operationType: 'rename',
            sourcePath,
            targetPath,
          });
          continue;
        }

        const targetUri = await resolveWorkspaceTarget(targetPath);
        const targetExists = await pathExists(targetUri);
        if (targetExists) {
          results.push({
            file: targetPath,
            status: 'failed',
            reason: 'Rename target already exists',
            operationType: 'rename',
            sourcePath,
            targetPath,
          });
          continue;
        }

        let fileStats: vscode.FileStat | undefined;
        if (mtimeCheck) {
          try {
            fileStats = await vscode.workspace.fs.stat(sourceUri);
          } catch {
            fileStats = undefined;
          }
        }

        const sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
        const original = sourceDoc.getText();
        let patched = original;
        let strategy: string | undefined = 'rename-file';

        if (operation.patch && operation.patch.hunks.length > 0) {
          const applyResult = await applyPatchToContent(original, operation.patch, fuzz);
          if (!applyResult.success) {
            const reason = applyResult.diagnostics
              ? `Patch could not be applied\n${applyResult.diagnostics}`
              : 'Patch could not be applied';
            results.push({
              file: targetPath,
              status: 'failed',
              reason,
              operationType: 'rename',
              sourcePath,
              targetPath,
            });
            continue;
          }

          patched = applyResult.patched;
          strategy = applyResult.strategy ?? strategy;
        }

        if (preview) {
          const confirmed = await showPatchPreview(
            sourceUri,
            original,
            patched,
            `${sourcePath} -> ${targetPath}`,
          );
          if (!confirmed) {
            results.push({
              file: targetPath,
              status: 'failed',
              reason: 'User cancelled after preview',
              operationType: 'rename',
              sourcePath,
              targetPath,
            });
            continue;
          }
        }

        if (mtimeCheck && fileStats) {
          const proceed = await confirmMtime(sourceUri, sourcePath, fileStats);
          if (!proceed) {
            results.push({
              file: targetPath,
              status: 'failed',
              reason: 'File modified externally, update aborted',
              operationType: 'rename',
              sourcePath,
              targetPath,
            });
            continue;
          }
        }

        await ensureParentDirectory(targetUri);
        await vscode.workspace.fs.rename(sourceUri, targetUri, { overwrite: false });

        if (patched !== original) {
          const renamedDoc = await vscode.workspace.openTextDocument(targetUri);
          const edit = new vscode.WorkspaceEdit();
          edit.replace(targetUri, fullDocRange(renamedDoc), patched);
          if (!(await vscode.workspace.applyEdit(edit))) {
            results.push({
              file: targetPath,
              status: 'failed',
              reason: 'Workspace edit failed after rename',
              operationType: 'rename',
              sourcePath,
              targetPath,
            });
            continue;
          }

          if (renamedDoc.isDirty) {await renamedDoc.save();}
        }

        results.push({
          file: targetPath,
          status: 'applied',
          strategy,
          operationType: 'rename',
          sourcePath,
          targetPath,
        });
        if (autoStage) {
          staged.push(sourcePath);
          staged.push(targetPath);
        }
        break;
      }
      case 'modify':
      default: {
        if (!operation.patch) {
          results.push({
            file: relPath,
            status: 'failed',
            reason: 'No patch content found for modify operation',
            operationType: 'modify',
            sourcePath: operation.sourcePath,
            targetPath: operation.targetPath,
          });
          continue;
        }

        const fileUri = await resolveWorkspaceFile(relPath);
        if (!fileUri) {
          results.push({
            file: relPath,
            status: 'failed',
            reason: 'File not found in workspace',
            operationType: 'modify',
            sourcePath: operation.sourcePath,
            targetPath: operation.targetPath,
          });
          continue;
        }

        let fileStats: vscode.FileStat | undefined;
        if (mtimeCheck) {
          try {
            fileStats = await vscode.workspace.fs.stat(fileUri);
          } catch {
            fileStats = undefined;
          }
        }

        const doc = await vscode.workspace.openTextDocument(fileUri);
        const original = doc.getText();
        const { patched, success, strategy, diagnostics } = await applyPatchToContent(
          original,
          operation.patch,
          fuzz,
        );

        if (!success) {
          const reason = diagnostics
            ? `Patch could not be applied\n${diagnostics}`
            : 'Patch could not be applied';
          results.push({
            file: relPath,
            status: 'failed',
            reason,
            operationType: 'modify',
            sourcePath: operation.sourcePath,
            targetPath: operation.targetPath,
          });
          continue;
        }

        if (preview) {
          const confirmed = await showPatchPreview(
            fileUri,
            original,
            patched,
            relPath,
          );
          if (!confirmed) {
            results.push({
              file: relPath,
              status: 'failed',
              reason: 'User cancelled after preview',
              operationType: 'modify',
              sourcePath: operation.sourcePath,
              targetPath: operation.targetPath,
            });
            continue;
          }
        }

        if (mtimeCheck && fileStats) {
          const proceed = await confirmMtime(fileUri, relPath, fileStats);
          if (!proceed) {
            results.push({
              file: relPath,
              status: 'failed',
              reason: 'File modified externally, update aborted',
              operationType: 'modify',
              sourcePath: operation.sourcePath,
              targetPath: operation.targetPath,
            });
            continue;
          }
        }

        const edit = new vscode.WorkspaceEdit();
        edit.replace(fileUri, fullDocRange(doc), patched);
        if (!(await vscode.workspace.applyEdit(edit))) {
          results.push({
            file: relPath,
            status: 'failed',
            reason: 'Workspace edit failed',
            operationType: 'modify',
            sourcePath: operation.sourcePath,
            targetPath: operation.targetPath,
          });
          continue;
        }

        if (doc.isDirty) {await doc.save();}
        results.push({
          file: relPath,
          status: 'applied',
          strategy,
          operationType: 'modify',
          sourcePath: operation.sourcePath,
          targetPath: operation.targetPath,
        });
        if (autoStage) {staged.push(relPath);}
        break;
      }
      }
    } catch (err) {
      results.push({
        file: relPath,
        status: 'failed',
        reason: (err as Error).message ?? String(err),
        operationType: operation.operationType,
        sourcePath: operation.sourcePath,
        targetPath: operation.targetPath,
      });
    }
  }

  if (autoStage && staged.length) {
    try {
      await autoStageFiles(staged);
    } catch (_e) {
      vscode.window.showWarningMessage(
        `Patch applied but Git staging failed: ${(_e as Error).message}`,
      );
    }
  }

  trackEvent('apply_patch_complete', {
    files: results.length,
    success: results.filter((r) => r.status === 'applied').length,
    fuzz,
    mtimeCheck
  });

  return results;
}

/* ───────────────────── Single‑file helper (strategy chain) ─────────────── */

export async function applyPatchToContent(
  content: string,
  patch: DiffParsedPatch,
  fuzz: 0 | 1 | 2 | 3,
): Promise<PatchResult> {
  // Check if the patch is large - could be performance intensive
  const isLargePatch = patch.hunks.length > 5 || content.length > 100000;
  const isLargeFile = content.length > 500000; // ~500KB

  if (isLargePatch || isLargeFile) {
    // Use optimized strategies for large patches or files
    // This enhances performance with potentially large diffs
    trackEvent('patch_content', {
      strategy: 'optimized',
      hunkCount: patch.hunks.length,
      contentSize: content.length
    });

    // Create the standard strategy first
    const standardStrategy = PatchStrategyFactory.createDefaultStrategy(fuzz);
    // Then wrap it with optimized strategies that handle large files better
    const optimizedStrategy = useOptimizedStrategies(standardStrategy, fuzz);

    return optimizedStrategy.apply(content, patch);
  } else {
    // Use standard strategies for normal patches
    trackEvent('patch_content', {
      strategy: 'standard',
      hunkCount: patch.hunks.length,
      contentSize: content.length
    });

    return PatchStrategyFactory.createDefaultStrategy(fuzz).apply(content, patch);
  }
}

/* ───────────────────────── Preview diff editor ─────────────────────────── */

async function showPatchPreview(
  fileUri: vscode.Uri,
  original: string,
  patched: string,
  relPath: string,
): Promise<boolean> {
  const left = fileUri.with({
    scheme: 'patchpilot-orig',
    query: fileUri.toString(),
  });
  const right = fileUri.with({
    scheme: 'patchpilot-mod',
    query: fileUri.toString(),
  });

  const origProvider = vscode.workspace.registerTextDocumentContentProvider(
    'patchpilot-orig',
    { provideTextDocumentContent: (u) => (u.query === fileUri.toString() ? original : '') },
  );
  const modProvider = vscode.workspace.registerTextDocumentContentProvider(
    'patchpilot-mod',
    { provideTextDocumentContent: (u) => (u.query === fileUri.toString() ? patched : '') },
  );

  try {
    await vscode.commands.executeCommand(
      'vscode.diff',
      left,
      right,
      `Patch Preview – ${relPath}`,
    );
    const choice = await vscode.window.showInformationMessage(
      `Apply patch to ${relPath}?`,
      { modal: true },
      'Apply',
    );
    return choice === 'Apply';
  } finally {
    origProvider.dispose();
    modProvider.dispose();
  }
}

/* ─────────────────────────── Utility helpers ───────────────────────────── */

export function extractFilePath(p: DiffParsedPatch): string | undefined {
  if (p.newFileName && p.newFileName !== '/dev/null') {
    // Clean both actual control characters and escaped character sequences
    return p.newFileName.replace(/^b\//, '')
      .replace(/[\x00-\x1F\x7F]+/g, '') // Remove actual control characters
      .replace(/\\r|\\n/g, '')          // Remove escaped \r and \n sequences
      .trim();
  }
  if (p.oldFileName && p.oldFileName !== '/dev/null') {
    // Clean both actual control characters and escaped character sequences
    return p.oldFileName.replace(/^a\//, '')
      .replace(/[\x00-\x1F\x7F]+/g, '') // Remove actual control characters
      .replace(/\\r|\\n/g, '')          // Remove escaped \r and \n sequences
      .trim();
  }
  return undefined;
}

async function resolveWorkspaceFile(
  relPath: string,
): Promise<vscode.Uri | undefined> {
  const roots = vscode.workspace.workspaceFolders;
  if (!roots?.length) {throw new Error('No workspace folder open.');}

  // Security improvement: Validate the relative path
  if (!relPath || relPath.includes('..') || relPath.startsWith('/')) {
    throw new Error(`Invalid file path: ${relPath}`);
  }

  // Try each workspace folder
  for (const r of roots) {
    const uri = vscode.Uri.joinPath(r.uri, relPath);
    try {
      await vscode.workspace.fs.stat(uri);
      return uri;
    } catch {
      /* ignore */
    }
  }

  // If not found directly, try finding by filename
  const fname = relPath.split('/').pop() ?? relPath;
  if (!fname || fname === '' || fname === '..' || fname === '.') {
    return undefined;
  }

  const found = await vscode.workspace.findFiles(
    `**/${fname}`,
    '**/node_modules/**',
    10 // Limit results to avoid performance issues
  );

  if (found.length === 1) {return found[0];}
  if (found.length > 1) {
    // Get stats for each found file
    const filesWithStats = [];
    for (const f of found) {
      const stats = await vscode.workspace.fs.stat(f);
      filesWithStats.push({
        label: vscode.workspace.asRelativePath(f),
        uri: f,
        description: `Last modified: ${new Date(stats.mtime).toLocaleString()}`
      });
    }

    const pick = await vscode.window.showQuickPick(
      filesWithStats,
      {
        placeHolder: `Select file for patch «${relPath}»`,
        title: "Multiple files match the patch target"
      },
    );
    return pick?.uri;
  }
  return undefined;
}

async function resolveWorkspaceTarget(
  relPath: string,
): Promise<vscode.Uri> {
  const roots = vscode.workspace.workspaceFolders;
  if (!roots?.length) {throw new Error('No workspace folder open.');}

  // Security improvement: Validate the relative path
  if (!relPath || relPath.includes('..') || relPath.startsWith('/')) {
    throw new Error(`Invalid file path: ${relPath}`);
  }

  for (const r of roots) {
    const existingUri = vscode.Uri.joinPath(r.uri, relPath);
    if (await pathExists(existingUri)) {
      return existingUri;
    }
  }

  return vscode.Uri.joinPath(roots[0].uri, relPath);
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function ensureParentDirectory(fileUri: vscode.Uri): Promise<void> {
  const slashIdx = fileUri.path.lastIndexOf('/');
  if (slashIdx <= 0) {return;}
  const parentPath = fileUri.path.slice(0, slashIdx);
  const parentUri = fileUri.with({ path: parentPath });
  await vscode.workspace.fs.createDirectory(parentUri);
}

async function confirmMtime(
  fileUri: vscode.Uri,
  relPath: string,
  originalStats: vscode.FileStat,
): Promise<boolean> {
  try {
    const currentStats = await vscode.workspace.fs.stat(fileUri);
    if (originalStats.mtime !== currentStats.mtime) {
      const confirmOverwrite = await vscode.window.showWarningMessage(
        `File ${relPath} has been modified since reading it. Apply patch anyway?`,
        { modal: true },
        'Apply Anyway',
        'Cancel',
      );

      return confirmOverwrite === 'Apply Anyway';
    }
  } catch {
    const output = vscode.window.createOutputChannel('PatchPilot');
    output.appendLine(`Could not verify file stats for ${relPath}`);
  }

  return true;
}

function fullDocRange(doc: vscode.TextDocument): vscode.Range {
  const lastLine = doc.lineCount - 1;
  return new vscode.Range(0, 0, lastLine, doc.lineAt(lastLine).text.length);
}

/* ───────────────────── Parse‑only helper for WebView ───────────────────── */

export async function parsePatch(patchText: string): Promise<FileInfo[]> {
  const cleanPatchText = patchText.replace(/\\r\\n|\\r|\\n/g, '');

  const normalized = normalizeDiff(cleanPatchText);
  const operations = parseGitDiffOperations(normalized);

  const info: FileInfo[] = [];

  for (const op of operations) {
    const filePath = op.targetPath ?? op.sourcePath;
    if (!filePath) {continue;}

    let exists = false;
    switch (op.operationType) {
    case 'add': {
      const targetUri = await resolveWorkspaceTarget(filePath);
      exists = !(await pathExists(targetUri));
      break;
    }
    case 'rename': {
      const sourceExists = op.sourcePath ? !!(await resolveWorkspaceFile(op.sourcePath)) : false;
      const targetExists = op.targetPath
        ? await pathExists(await resolveWorkspaceTarget(op.targetPath))
        : false;
      exists = sourceExists && !targetExists;
      break;
    }
    case 'delete':
    case 'modify':
    default:
      exists = !!(await resolveWorkspaceFile(filePath));
      break;
    }

    info.push({
      filePath,
      exists,
      hunks: op.patch?.hunks.length ?? 0,
      operationType: op.operationType,
      sourcePath: op.sourcePath,
      targetPath: op.targetPath,
      changes: {
        additions: op.additions,
        deletions: op.deletions,
      },
    });
  }

  return info;
}