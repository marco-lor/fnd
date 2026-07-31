var mockReadUserDataRole = jest.fn();
var mockReadUserOwnedDataDocument = jest.fn();
var mockMutateInventory = jest.fn();
var mockIsTask07MediaV1WriteEnabled = jest.fn();
var mockRunTask07ControlledWriterUpload = jest.fn();

jest.mock('../../components/firebaseConfig', () => ({
  auth: { currentUser: { uid: 'actor-1' } },
}));

jest.mock('../userData/userDataCommands', () => ({
  mutateInventory: (...args) => mockMutateInventory(...args),
}));

jest.mock('../userData/userDataRepository', () => ({
  readUserDataRole: (...args) => mockReadUserDataRole(...args),
  readUserOwnedDataDocument: (...args) => (
    mockReadUserOwnedDataDocument(...args)
  ),
}));

jest.mock('./mediaFeatureFlags', () => ({
  isTask07MediaV1WriteEnabled: (...args) => (
    mockIsTask07MediaV1WriteEnabled(...args)
  ),
}));

jest.mock('./mediaWriterAdapter', () => ({
  buildTask07PrepareRetryKey: jest.fn(() => 'task07-prepare-item-fixed'),
  runTask07ControlledWriterUpload: (...args) => (
    mockRunTask07ControlledWriterUpload(...args)
  ),
}));

import { tryPersistTask07VarieMedia } from './privateInventoryMediaWriter';
import { auth as mockAuth } from '../../components/firebaseConfig';
import { buildTask07PrepareRetryKey as mockBuildTask07PrepareRetryKey } from './mediaWriterAdapter';

const imageFile = Object.assign(new Blob(['image'], { type: 'image/png' }), {
  lastModified: 42,
  name: 'rope.png',
});

describe('Task 07 private inventory media writer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildTask07PrepareRetryKey.mockReturnValue('task07-prepare-item-fixed');
    mockAuth.currentUser = { uid: 'actor-1' };
    mockReadUserDataRole.mockResolvedValue('dm');
    mockIsTask07MediaV1WriteEnabled.mockResolvedValue(true);
    mockReadUserOwnedDataDocument.mockResolvedValue(null);
    mockMutateInventory.mockImplementation(async ({ action }) => {
      if (action === 'createVarie') {
        return { success: true, inventoryId: 'varie-receipt-1' };
      }
      return { success: true };
    });
  });

  test('rolls back a pre-created Varie target when receipt acquisition fails', async () => {
    const receiptError = new Error('session storage unavailable');
    receiptError.name = 'Task07MediaOperationReceiptError';
    mockRunTask07ControlledWriterUpload.mockRejectedValue(receiptError);

    await expect(tryPersistTask07VarieMedia({
      userId: 'owner-1',
      snapshot: {
        Nome: 'Corda',
        image_url: 'items/legacy-rope.png',
      },
      quantity: 2,
      file: imageFile,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      name: 'Task07MediaOperationReceiptError',
      targetRollback: { ok: true },
    });

    expect(mockMutateInventory.mock.calls.map(([input]) => input.action))
      .toEqual(['createVarie', 'remove']);
    expect(mockMutateInventory.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        inventoryId: 'varie-receipt-1',
        retryKey: 'task07-prepare-item-fixed:rollback-create',
      })
    );
  });

  test('leaves a root-array-only edit on the legacy path', async () => {
    const result = await tryPersistTask07VarieMedia({
      userId: 'owner-1',
      inventoryItemId: 'legacy-only-item',
      snapshot: { Nome: 'Legacy rope' },
      quantity: 1,
      file: imageFile,
      signal: new AbortController().signal,
    });

    expect(result).toBeNull();
    expect(mockMutateInventory).not.toHaveBeenCalled();
    expect(mockRunTask07ControlledWriterUpload).not.toHaveBeenCalled();
  });
});
