var mockUploadBytes = jest.fn();
var mockGetDownloadURL = jest.fn();

jest.mock('firebase/storage', () => ({
  uploadBytes: (...args) => mockUploadBytes(...args),
  getDownloadURL: (...args) => mockGetDownloadURL(...args),
}));

import {
  IMMUTABLE_IMAGE_CACHE_CONTROL,
  LEGACY_IMAGE_CACHE_CONTROL,
  uploadCacheableImage,
} from './imageStorage';

describe('imageStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uploads images with immutable private browser-cache metadata', async () => {
    const imageRef = { fullPath: 'characters/user-1_123.png' };
    const uploadedRef = { fullPath: imageRef.fullPath };
    const file = new File(['portrait'], 'portrait.png', { type: 'image/png' });
    mockUploadBytes.mockResolvedValue({ ref: uploadedRef });
    mockGetDownloadURL.mockResolvedValue('https://example.com/portrait.png');

    await expect(uploadCacheableImage(imageRef, file)).resolves.toEqual(expect.objectContaining({
      downloadUrl: 'https://example.com/portrait.png',
      storagePath: imageRef.fullPath,
    }));

    expect(mockUploadBytes).toHaveBeenCalledWith(imageRef, file, {
      cacheControl: 'private, max-age=31536000, immutable',
      contentType: 'image/png',
    });
    expect(mockGetDownloadURL).toHaveBeenCalledWith(uploadedRef);
    expect(IMMUTABLE_IMAGE_CACHE_CONTROL).toBe('private, max-age=31536000, immutable');
    expect(LEGACY_IMAGE_CACHE_CONTROL).toBe('private, max-age=604800');
  });

  test('rejects non-image files before uploading', async () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

    await expect(uploadCacheableImage({ fullPath: 'clips/1.mp4' }, file))
      .rejects.toThrow('valid image file');
    expect(mockUploadBytes).not.toHaveBeenCalled();
  });
});
