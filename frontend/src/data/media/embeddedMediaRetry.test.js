import {
  resolveTask07CatalogCreateAttempt,
  runTask07EmbeddedOperationSequence,
  task07EmbeddedFileFingerprint,
} from './embeddedMediaRetry';

describe('embedded media parent retry safety', () => {
  test('catalog create resumes only the locally committed parent', () => {
    expect(resolveTask07CatalogCreateAttempt({
      documentExists: true,
      documentId: 'same-item',
      pendingDocumentId: 'same-item',
    })).toEqual({blocked: false, resume: true, reason: null});
    expect(resolveTask07CatalogCreateAttempt({
      documentExists: true,
      documentId: 'foreign-item',
      pendingDocumentId: '',
    })).toEqual({blocked: true, resume: false, reason: 'already-exists'});
    expect(resolveTask07CatalogCreateAttempt({
      documentExists: false,
      documentId: 'renamed-item',
      pendingDocumentId: 'original-item',
    })).toEqual({
      blocked: true,
      resume: false,
      reason: 'pending-other-document',
    });
  });

  test('root upload completion is bound to the exact selected file', () => {
    const first = new File(['one'], 'root.png', {
      lastModified: 1,
      type: 'image/png',
    });
    const same = new File(['one'], 'root.png', {
      lastModified: 1,
      type: 'image/png',
    });
    const replacement = new File(['two'], 'root.png', {
      lastModified: 2,
      type: 'image/png',
    });
    expect(task07EmbeddedFileFingerprint(first))
      .toBe(task07EmbeddedFileFingerprint(first));
    expect(task07EmbeddedFileFingerprint(first))
      .not.toBe(task07EmbeddedFileFingerprint(same));
    expect(task07EmbeddedFileFingerprint(first))
      .not.toBe(task07EmbeddedFileFingerprint(replacement));
  });

  test('failure after operation one retries into one parent and two attachments',
    async () => {
      const parentId = 'one-parent';
      const documents = new Map();
      const completedKeys = new Set();
      const attachments = new Set();
      const calls = [];
      const operations = [1, 2].map((index) => ({
        action: 'upload',
        entry: {task07MediaEntryId: `entry-${index}`},
        entryIndex: index - 1,
        file: new File([`media-${index}`], `media-${index}.png`, {
          lastModified: index,
          type: 'image/png',
        }),
        kind: 'foe',
        slot: 'media',
        targetKind: 'foe-technique',
      }));
      const ensureParent = () => {
        if (!documents.has(parentId)) documents.set(parentId, {id: parentId});
      };
      let failSecond = true;
      const execute = async (operation) => {
        calls.push(operation.entry.task07MediaEntryId);
        if (operation === operations[1] && failSecond) {
          failSecond = false;
          throw new Error('injected operation two failure');
        }
        attachments.add(operation.entry.task07MediaEntryId);
      };

      ensureParent();
      await expect(runTask07EmbeddedOperationSequence({
        completedKeys,
        execute,
        operations,
        parentId,
      })).rejects.toThrow('injected operation two failure');
      ensureParent();
      await runTask07EmbeddedOperationSequence({
        completedKeys,
        execute,
        operations,
        parentId,
      });

      expect(documents.size).toBe(1);
      expect([...attachments].sort()).toEqual(['entry-1', 'entry-2']);
      expect(calls).toEqual(['entry-1', 'entry-2', 'entry-2']);
    });
});
