/* --------------------------------------------------------------------------
 *  PatchPilot — Types for patch operations
 * ----------------------------------------------------------------------- */

/**
 * Represents a hunk in a diff
 */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/**
 * Represents a parsed patch with hunks
 */
export interface DiffParsedPatch {
  oldFileName?: string;
  newFileName?: string;
  hunks: DiffHunk[];
}

/**
 * Patch operation type derived from git/unified diff metadata
 */
export type PatchOperationType = 'modify' | 'add' | 'delete' | 'rename';

/**
 * Options for applying a patch
 */
export interface ApplyOptions {
  /** Show preview before applying (default: true) */
  preview?: boolean;

  /** Auto-stage files to Git after applying (default: from config) */
  autoStage?: boolean;

  /** Fuzz factor for context matching (default: from config) */
  fuzz?: 0 | 1 | 2 | 3;

  /** Check file modification time before applying (default: from config) */
  mtimeCheck?: boolean;

  /** Whether to prompt on file modification */
  mtimePrompt?: boolean;
}

/**
 * Result of applying a patch to a file
 */
export interface ApplyResult {
  /** The file path */
  file: string;

  /** Whether the patch was applied successfully */
  status: 'applied' | 'failed';

  /** If the patch failed, the reason why */
  reason?: string;

  /** The strategy that was used to apply the patch, if successful */
  strategy?: string;

  /** The operation type that was applied */
  operationType?: PatchOperationType;

  /** Source path (for delete/rename operations) */
  sourcePath?: string;

  /** Target path (for add/rename operations) */
  targetPath?: string;
}

/**
 * Information about a file in a patch
 */
export interface FileInfo {
  /** Path to the file */
  filePath: string;

  /** Whether the file exists in the workspace */
  exists: boolean;

  /** Number of hunks in the patch for this file */
  hunks: number;

  /** Operation type for this patch entry */
  operationType?: PatchOperationType;

  /** Source path (for delete/rename operations) */
  sourcePath?: string;

  /** Target path (for add/rename operations) */
  targetPath?: string;

  /** Changes statistics */
  changes: {
    additions: number;
    deletions: number;
  };
}