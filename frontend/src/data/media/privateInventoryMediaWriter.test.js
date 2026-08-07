var mockReadUserDataRole = jest.fn();
var mockReadUserOwnedDataDocument = jest.fn();
var mockMutateInventory = jest.fn();
var mockIsTask07MediaV1WriteEnabled = jest.fn();
var mockRunTask07ControlledWriterUpload = jest.fn();
var mockRetireTask07MediaAsset = jest.fn();
var mockGetTask07PreviousAssetIdForKind = jest.fn();
var mockBuildTask07DetachRetryKey = jest.fn();
var mockBuildTask07PrepareRetryKey = jest.fn();

jest.mock('../../components/firebaseConfig', () => ({
  auth: { currentUser: { uid: 'actor-1' } },
}));

jest.mock('../userData/userDataCommands', () => ({
  mutateInventory: (...args) => mockMutateInventory(...args),
}));

jest.mock('../userData/userDataRepository', () => ({
  readUserDataRole: (...args) => mockReadUserDataRole(...args),
  readUserOwnedDataDocument: (...args) => mockReadUserOwnedDataDocument(...args),
}));

jest.mock('./mediaFeatureFlags', () => ({
  isTask07MediaV1WriteEnabled: (...args) => mockIsTask07MediaV1WriteEnabled(...args),
}));

jest.mock('./mediaErrors', () => ({
  throwIfTask07Aborted: jest.fn(),
}));

jest.mock('./mediaPipeline', () => ({
  retireTask07MediaAsset: (...args) => mockRetireTask07MediaAsset(...args),
}));

jest.mock('./mediaWriterAdapter', () => ({
  buildTask07DetachRetryKey: (...args) => mockBuildTask07DetachRetryKey(...args),
  buildTask07PrepareRetryKey: (...args) => mockBuildTask07PrepareRetryKey(...args),
  getTask07PreviousAssetIdForKind: (...args) => mockGetTask07PreviousAssetIdForKind(...args),
  runTask07ControlledWriterUpload: (...args) => mockRunTask07ControlledWriterUpload(...args),
}));

import {
  persistCanonicalInventoryItem,
  tryPersistTask07VarieMedia,
} from './privateInventoryMediaWriter';
import { auth as mockAuth } from '../../components/firebaseConfig';

const imageFile = Object.assign(new Blob(['image'], { type: 'image/png' }), {
  lastModified: 42,
  name: 'rope.png',
});

const existingInventory = {
  id: 'inventory-1',
  data: {
    kind: 'accessorio',
    quantity: 1,
    currentSnapshot: { id: 'catalog-1', General: { Nome: 'Rope' } },
    media: { assetId: `m_${'a'.repeat(40)}` },
    task07MediaRevision: 2,
  },
};

describe('canonical private inventory writer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.currentUser = { uid: 'actor-1' };
    mockBuildTask07DetachRetryKey.mockReturnValue('task07-detach-item-fixed');
    mockBuildTask07PrepareRetryKey.mockReturnValue('task07-prepare-item-fixed');
    mockReadUserDataRole.mockResolvedValue('dm');
    mockIsTask07MediaV1WriteEnabled.mockResolvedValue(true);
    mockReadUserOwnedDataDocument.mockResolvedValue(existingInventory);
    mockGetTask07PreviousAssetIdForKind.mockReturnValue(`m_${'a'.repeat(40)}`);
    mockMutateInventory.mockImplementation(async ({ action }) => (
      action === 'createVarie'
        ? { success: true, inventoryId: 'varie-receipt-1' }
        : { success: true }
    ));
    mockRunTask07ControlledWriterUpload.mockImplementation(async (options) => {
      await options.prepareEntity();
      return { handled: true, status: 'complete' };
    });
    mockRetireTask07MediaAsset.mockResolvedValue({ ok: true, state: 'superseded' });
  });

  test('fails closed when an existing edit lacks a stable V2 target', async () => {
    mockReadUserOwnedDataDocument.mockResolvedValue(null);
    await expect(persistCanonicalInventoryItem({
      userId: 'owner-1',
      inventoryItemId: 'legacy-only-item',
      snapshot: { Nome: 'Legacy rope' },
      retryKey: 'edit-fixed',
    })).rejects.toMatchObject({ code: 'task05-target-not-found' });
    expect(mockMutateInventory).not.toHaveBeenCalled();
  });

  test('returns null before mutation when Task 07 is unavailable for media', async () => {
    mockIsTask07MediaV1WriteEnabled.mockResolvedValue(false);
    const result = await persistCanonicalInventoryItem({
      userId: 'owner-1',
      inventoryItemId: 'inventory-1',
      snapshot: { Nome: 'Rope' },
      file: imageFile,
      signal: new AbortController().signal,
    });
    expect(result).toBeNull();
    expect(mockReadUserOwnedDataDocument).not.toHaveBeenCalled();
    expect(mockMutateInventory).not.toHaveBeenCalled();
  });

  test('edits a stable equipment snapshot before canonical upload', async () => {
    const result = await persistCanonicalInventoryItem({
      userId: 'owner-1',
      inventoryItemId: 'inventory-1',
      snapshot: {
        _task05: { inventoryId: 'inventory-1' },
        General: { Nome: 'Updated rope' },
      },
      file: imageFile,
      signal: new AbortController().signal,
    });

    expect(mockMutateInventory).toHaveBeenCalledWith({
      userId: 'owner-1',
      action: 'edit',
      inventoryId: 'inventory-1',
      patch: { General: { Nome: 'Updated rope' } },
      retryKey: 'task07-prepare-item-fixed:prepare-edit',
    });
    expect(mockRunTask07ControlledWriterUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUid: 'owner-1',
        entityId: 'inventory-1',
        target: existingInventory.data,
        kind: 'item',
      })
    );
    expect(result).toEqual(expect.objectContaining({
      inventoryItemId: 'inventory-1',
      task07: true,
    }));
  });

  test('creates a distinct V2 Varie target before canonical upload', async () => {
    mockReadUserOwnedDataDocument.mockResolvedValue(null);
    const result = await tryPersistTask07VarieMedia({
      userId: 'owner-1',
      snapshot: { name: 'Corda', type: 'varie' },
      quantity: 2,
      file: imageFile,
      signal: new AbortController().signal,
    });

    expect(mockMutateInventory).toHaveBeenCalledWith({
      userId: 'owner-1',
      action: 'createVarie',
      quantity: 2,
      snapshot: { name: 'Corda', type: 'varie' },
      retryKey: 'task07-prepare-item-fixed:prepare-create',
    });
    expect(mockRunTask07ControlledWriterUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'varie-receipt-1',
        ownerUid: 'owner-1',
      })
    );
    expect(mockRunTask07ControlledWriterUpload.mock.calls[0][0].entityId).not.toBeNull();
    expect(result.inventoryItemId).toBe('varie-receipt-1');
  });

  test('rolls back the pre-created target when receipt acquisition fails', async () => {
    mockReadUserOwnedDataDocument.mockResolvedValue(null);
    const receiptError = new Error('session storage unavailable');
    receiptError.name = 'Task07MediaOperationReceiptError';
    mockRunTask07ControlledWriterUpload.mockRejectedValue(receiptError);

    await expect(tryPersistTask07VarieMedia({
      userId: 'owner-1',
      snapshot: { name: 'Corda', type: 'varie' },
      quantity: 2,
      file: imageFile,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      name: 'Task07MediaOperationReceiptError',
      targetRollback: { ok: true },
    });
    expect(mockMutateInventory.mock.calls.map(([input]) => input.action))
      .toEqual(['createVarie', 'remove']);
    expect(mockMutateInventory.mock.calls[1][0].inventoryId).toBe('varie-receipt-1');
  });

  test('retires the existing canonical asset after preparing the V2 edit', async () => {
    const result = await persistCanonicalInventoryItem({
      userId: 'owner-1',
      inventoryItemId: 'inventory-1',
      snapshot: { General: { Nome: 'No image' } },
      removeImage: true,
      signal: new AbortController().signal,
    });

    expect(mockMutateInventory).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'edit', inventoryId: 'inventory-1' })
    );
    expect(mockRetireTask07MediaAsset).toHaveBeenCalledWith(`m_${'a'.repeat(40)}`);
    expect(result.outcome.status).toBe('retired');
  });

  test('supports ordinary V2 edits without reading Task 07 flags', async () => {
    const result = await persistCanonicalInventoryItem({
      userId: 'owner-1',
      inventoryItemId: 'inventory-1',
      snapshot: { General: { Nome: 'No media change' } },
      retryKey: 'inventory-edit-fixed',
    });

    expect(mockIsTask07MediaV1WriteEnabled).not.toHaveBeenCalled();
    expect(mockMutateInventory).toHaveBeenCalledWith({
      userId: 'owner-1',
      action: 'edit',
      inventoryId: 'inventory-1',
      patch: { General: { Nome: 'No media change' } },
      retryKey: 'inventory-edit-fixed:prepare-edit',
    });
    expect(result.task07).toBe(false);
  });
});
