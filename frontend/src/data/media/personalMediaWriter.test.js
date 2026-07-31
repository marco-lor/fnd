var mockReadUserDataRole = jest.fn();
var mockReadUserOwnedDataDocument = jest.fn();
var mockMutatePersonalContent = jest.fn();
var mockIsTask07MediaV1WriteEnabled = jest.fn();
var mockRunTask07ControlledWriterUpload = jest.fn();
var mockRetireTask07MediaAsset = jest.fn();

jest.mock('../../components/firebaseConfig', () => ({
  auth: { currentUser: { uid: 'actor-1' } },
}));

jest.mock('../userData/userDataCommands', () => ({
  mutatePersonalContent: (...args) => mockMutatePersonalContent(...args),
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
  buildTask07DetachRetryKey: jest.fn(() => 'task07-detach-spell-fixed'),
  buildTask07PrepareRetryKey: jest.fn(() => 'task07-prepare-spell-fixed'),
  getTask07PreviousAssetIdForKind: jest.fn((entity, kind) => {
    const slot = String(kind).endsWith('-video') ? 'videoMedia' : 'media';
    const assetId = entity?.[slot]?.assetId;
    return /^m_[a-f0-9]{40}$/.test(assetId || '') ? assetId : null;
  }),
  runTask07ControlledWriterUpload: (...args) => (
    mockRunTask07ControlledWriterUpload(...args)
  ),
}));

jest.mock('./mediaConsumerAdapter', () => ({
  task07ConsumerNeedsAttention: jest.fn((outcome) => (
    outcome?.status === 'attached-result-unknown'
    || outcome?.status === 'attach-acknowledgement-unknown'
  )),
}));

jest.mock('./mediaErrors', () => ({
  throwIfTask07Aborted: jest.fn((signal) => {
    if (signal?.aborted) {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }
  }),
}));

jest.mock('./mediaPipeline', () => ({
  retireTask07MediaAsset: (...args) => mockRetireTask07MediaAsset(...args),
}));

import { tryPersistTask07PersonalMedia } from './personalMediaWriter';
import { auth as mockAuth } from '../../components/firebaseConfig';
import {
  buildTask07DetachRetryKey as mockBuildTask07DetachRetryKey,
  buildTask07PrepareRetryKey as mockBuildTask07PrepareRetryKey,
  getTask07PreviousAssetIdForKind as mockGetTask07PreviousAssetIdForKind,
} from './mediaWriterAdapter';
import { task07ConsumerNeedsAttention as mockTask07ConsumerNeedsAttention } from './mediaConsumerAdapter';

const imageAssetId = `m_${'a'.repeat(40)}`;
const videoAssetId = `m_${'b'.repeat(40)}`;
const imageFile = Object.assign(new Blob(['image'], { type: 'image/png' }), {
  lastModified: 42,
  name: 'spell.png',
});

describe('Task 07 personal media writer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildTask07DetachRetryKey.mockReturnValue('task07-detach-spell-fixed');
    mockBuildTask07PrepareRetryKey.mockReturnValue('task07-prepare-spell-fixed');
    mockGetTask07PreviousAssetIdForKind.mockImplementation((entity, kind) => {
      const slot = String(kind).endsWith('-video') ? 'videoMedia' : 'media';
      const assetId = entity?.[slot]?.assetId;
      return /^m_[a-f0-9]{40}$/.test(assetId || '') ? assetId : null;
    });
    mockTask07ConsumerNeedsAttention.mockImplementation((outcome) => (
      outcome?.status === 'attached-result-unknown'
      || outcome?.status === 'attach-acknowledgement-unknown'
    ));
    mockAuth.currentUser = { uid: 'actor-1' };
    mockReadUserDataRole.mockResolvedValue('dm');
    mockIsTask07MediaV1WriteEnabled.mockResolvedValue(true);
    mockMutatePersonalContent.mockResolvedValue({
      contentId: 'spell-content-1',
      success: true,
    });
    mockRetireTask07MediaAsset.mockResolvedValue({
      ok: true,
      state: 'superseded',
    });
    mockReadUserOwnedDataDocument.mockImplementation((userId, collectionKey, contentId) => {
      if (
        userId === 'owner-1'
        && collectionKey === 'spells'
        && contentId === 'spell-content-1'
      ) {
        return Promise.resolve({
          id: 'spell-content-1',
          data: {
          displayName: 'Luce',
          media: { assetId: imageAssetId },
          videoMedia: { assetId: videoAssetId },
          task07MediaRevision: 3,
          task07VideoMediaRevision: 5,
          },
        });
      }
      return Promise.resolve(null);
    });
  });

  test('prepares the Task 05 target only inside the receipt-owned upload pipeline', async () => {
    mockRunTask07ControlledWriterUpload.mockImplementation(async (input) => {
      expect(mockMutatePersonalContent).not.toHaveBeenCalled();
      await input.prepareEntity();
      return { handled: true, status: 'complete' };
    });

    const result = await tryPersistTask07PersonalMedia({
      userId: 'owner-1',
      collectionKey: 'spells',
      originalEntity: {
        _task05ContentId: 'spell-content-1',
        media: { assetId: imageAssetId },
      },
      entryData: {
        Nome: 'Luce',
        image_url: 'spells/legacy-light.png',
      },
      imageFile,
      signal: new AbortController().signal,
    });

    expect(mockMutatePersonalContent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'upsert',
        contentId: 'spell-content-1',
        kind: 'spell',
        retryKey: 'task07-prepare-spell-fixed:prepare',
      })
    );
    expect(mockRunTask07ControlledWriterUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: 'spell-content-1',
        kind: 'spell',
        target: expect.objectContaining({
          media: { assetId: imageAssetId },
          task07MediaRevision: 3,
        }),
      })
    );
    expect(result).toEqual(expect.objectContaining({
      contentId: 'spell-content-1',
      task07: true,
    }));
  });

  test('retires an exact canonical video slot after the Task 05 preparation', async () => {
    const result = await tryPersistTask07PersonalMedia({
      userId: 'owner-1',
      collectionKey: 'spells',
      originalEntity: {
        _task05ContentId: 'spell-content-1',
        videoMedia: { assetId: videoAssetId },
      },
      entryData: { Nome: 'Luce' },
      removeVideo: true,
      signal: new AbortController().signal,
    });

    expect(mockRunTask07ControlledWriterUpload).not.toHaveBeenCalled();
    expect(mockMutatePersonalContent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'upsert',
        contentId: 'spell-content-1',
        retryKey: 'task07-detach-spell-fixed:prepare',
      })
    );
    expect(mockRetireTask07MediaAsset).toHaveBeenCalledWith(videoAssetId);
    expect(mockMutatePersonalContent.mock.invocationCallOrder[0])
      .toBeLessThan(mockRetireTask07MediaAsset.mock.invocationCallOrder[0]);
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        assetId: videoAssetId,
        kind: 'spell-video',
        status: 'retired',
      }),
    ]);
  });

  test('defers a mixed-slot removal while replacement acknowledgement needs attention', async () => {
    mockRunTask07ControlledWriterUpload.mockImplementationOnce(async (input) => {
      await input.prepareEntity();
      return {
        handled: true,
        status: 'attach-acknowledgement-unknown',
      };
    });
    const request = {
      userId: 'owner-1',
      collectionKey: 'spells',
      originalEntity: {
        _task05ContentId: 'spell-content-1',
        media: { assetId: imageAssetId },
        videoMedia: { assetId: videoAssetId },
      },
      entryData: { Nome: 'Luce' },
      imageFile,
      removeVideo: true,
      signal: new AbortController().signal,
    };

    const interrupted = await tryPersistTask07PersonalMedia(request);

    expect(interrupted.outcomes).toEqual([
      expect.objectContaining({
        status: 'attach-acknowledgement-unknown',
      }),
    ]);
    expect(mockRetireTask07MediaAsset).not.toHaveBeenCalled();

    mockRunTask07ControlledWriterUpload.mockImplementationOnce(async (input) => {
      await input.prepareEntity();
      return {
        handled: true,
        status: 'complete',
      };
    });

    const recovered = await tryPersistTask07PersonalMedia(request);

    expect(mockRetireTask07MediaAsset).toHaveBeenCalledTimes(1);
    expect(mockRetireTask07MediaAsset).toHaveBeenCalledWith(videoAssetId);
    expect(recovered.outcomes).toEqual([
      expect.objectContaining({ status: 'complete' }),
      expect.objectContaining({
        assetId: videoAssetId,
        status: 'retired',
      }),
    ]);
  });

  test('fails closed when canonical media has no stable Task 05 target', async () => {
    await expect(tryPersistTask07PersonalMedia({
      userId: 'owner-1',
      collectionKey: 'spells',
      originalEntity: {
        Nome: 'Legacy-shaped canonical entry',
        media: { assetId: imageAssetId },
      },
      entryData: { Nome: 'Legacy-shaped canonical entry' },
      removeImage: true,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'task07-stable-target-required',
    });

    expect(mockMutatePersonalContent).not.toHaveBeenCalled();
    expect(mockRetireTask07MediaAsset).not.toHaveBeenCalled();
  });
});
