import {
  __legacyMediaStorageBoundary,
  createLegacyStorageCleanup,
  deleteLegacyStoragePath,
  uploadLegacyBlob,
} from './legacyMediaStorage';
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from 'firebase/storage';

jest.mock('../firebaseStorage', () => ({ storage: { bucket: 'test' } }));
jest.mock('firebase/storage', () => ({
  deleteObject: jest.fn(),
  getDownloadURL: jest.fn(),
  ref: jest.fn((_storage, path) => ({ fullPath: path })),
  uploadBytes: jest.fn(),
}));
jest.mock('./imageStorage', () => ({ uploadCacheableImage: jest.fn() }));

describe('legacyMediaStorage boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects generated and absolute paths at the reviewed legacy boundary', async () => {
    await expect(deleteLegacyStoragePath('https://example.com/object'))
      .rejects.toThrow('safe legacy Storage path');
    await expect(deleteLegacyStoragePath('media_assets\\v1\\asset'))
      .rejects.toThrow('safe legacy Storage path');
    await expect(deleteLegacyStoragePath('media_assets/v1/private/asset'))
      .rejects.toThrow('safe legacy Storage path');
    await expect(deleteLegacyStoragePath('media_uploads/user/asset/source'))
      .rejects.toThrow('safe legacy Storage path');
    await expect(deleteLegacyStoragePath('media/v1/map/user/asset/original.webp'))
      .rejects.toThrow('safe legacy Storage path');
    expect(__legacyMediaStorageBoundary.generatedMediaWritesAllowed).toBe(false);
  });

  test('owns legacy upload and download URL creation', async () => {
    uploadBytes.mockResolvedValue({ ref: { fullPath: 'legacy/file.mp4' } });
    getDownloadURL.mockResolvedValue('https://legacy.test/file');
    await expect(uploadLegacyBlob('legacy/file.mp4', new Blob(['video'])))
      .resolves.toEqual(expect.objectContaining({
        downloadUrl: 'https://legacy.test/file',
        storagePath: 'legacy/file.mp4',
      }));
    expect(ref).toHaveBeenCalledWith(expect.anything(), 'legacy/file.mp4');
  });

  test('deletes only after a deferred cleanup flush', async () => {
    deleteObject.mockResolvedValue(undefined);
    const cleanup = createLegacyStorageCleanup();
    cleanup.addPath('legacy/old.png');
    expect(deleteObject).not.toHaveBeenCalled();
    await expect(cleanup.flush()).resolves.toEqual(expect.objectContaining({
      deleted: ['legacy/old.png'],
    }));
  });
});
