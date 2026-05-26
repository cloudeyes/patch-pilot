import { parseGitDiffOperations, splitDiffBlocks } from '../../gitExtendedDiff';
import {
  ADD_FILE_DIFF,
  DELETE_FILE_DIFF,
  RENAME_ONLY_DIFF,
  RENAME_MODIFY_DIFF,
} from '../fixtures/sample-diffs';

describe('gitExtendedDiff helpers', () => {
  describe('splitDiffBlocks', () => {
    it('splits multiple diff blocks', () => {
      const blocks = splitDiffBlocks(`${ADD_FILE_DIFF}\n\n${DELETE_FILE_DIFF}`);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toContain('new file mode 100644');
      expect(blocks[1]).toContain('deleted file mode 100644');
    });
  });

  describe('parseGitDiffOperations', () => {
    it('detects add operations', () => {
      const ops = parseGitDiffOperations(ADD_FILE_DIFF);
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        operationType: 'add',
        targetPath: 'src/new-file.ts',
      });
      expect(ops[0].additions).toBeGreaterThan(0);
      expect(ops[0].deletions).toBe(0);
    });

    it('detects delete operations', () => {
      const ops = parseGitDiffOperations(DELETE_FILE_DIFF);
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        operationType: 'delete',
        sourcePath: 'src/old-file.ts',
      });
      expect(ops[0].deletions).toBeGreaterThan(0);
      expect(ops[0].additions).toBe(0);
    });

    it('detects rename-only operations', () => {
      const ops = parseGitDiffOperations(RENAME_ONLY_DIFF);
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        operationType: 'rename',
        sourcePath: 'src/old-name.ts',
        targetPath: 'src/new-name.ts',
      });
      expect(ops[0].additions).toBe(0);
      expect(ops[0].deletions).toBe(0);
    });

    it('detects rename+modify operations', () => {
      const ops = parseGitDiffOperations(RENAME_MODIFY_DIFF);
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        operationType: 'rename',
        sourcePath: 'src/old-name.ts',
        targetPath: 'src/new-name.ts',
      });
      expect(ops[0].additions).toBeGreaterThan(0);
      expect(ops[0].deletions).toBeGreaterThan(0);
      expect(ops[0].patch?.hunks).toHaveLength(1);
    });
  });
});
