import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  IMMUTABLE_IMAGE_CACHE_CONTROL,
  LEGACY_IMAGE_CACHE_CONTROL,
  uploadCacheableImage,
} from './imageStorage';

var mockUploadBytesResumable = jest.fn();
var mockGetDownloadURL = jest.fn();

jest.mock('firebase/storage', () => ({
  uploadBytesResumable: (...args) => mockUploadBytesResumable(...args),
  getDownloadURL: (...args) => mockGetDownloadURL(...args),
}));

const createMockUpload = (fullPath = 'characters/user-1_123.png') => {
  let observers = {};
  const unsubscribe = jest.fn();
  const uploadedRef = { fullPath };
  const uploadTask = {
    snapshot: { ref: uploadedRef },
    cancel: jest.fn(() => true),
    on: jest.fn((eventName, next, error, complete) => {
      observers = { next, error, complete };
      return unsubscribe;
    }),
  };

  return {
    uploadTask,
    uploadedRef,
    unsubscribe,
    progress(snapshot) {
      observers.next(snapshot);
    },
    fail(error) {
      observers.error(error);
    },
    complete(snapshot = uploadTask.snapshot) {
      uploadTask.snapshot = snapshot;
      observers.complete();
    },
  };
};

describe('imageStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uploads every allowed image through the resumable transport with immutable private metadata', async () => {
    const imageRef = { fullPath: 'characters/user-1_123.png' };
    const file = new File(['portrait'], 'portrait.png', { type: 'image/png' });
    const upload = createMockUpload(imageRef.fullPath);
    mockUploadBytesResumable.mockReturnValue(upload.uploadTask);
    mockGetDownloadURL.mockResolvedValue('https://example.com/portrait.png');

    const result = uploadCacheableImage(imageRef, file);
    upload.complete();

    await expect(result).resolves.toEqual({
      downloadUrl: 'https://example.com/portrait.png',
      storagePath: imageRef.fullPath,
      snapshot: upload.uploadTask.snapshot,
    });

    expect(mockUploadBytesResumable).toHaveBeenCalledWith(imageRef, file, {
      cacheControl: 'private, max-age=31536000, immutable',
      contentType: 'image/png',
    });
    expect(upload.uploadTask.on).toHaveBeenCalledWith(
      'state_changed',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    );
    expect(mockGetDownloadURL).toHaveBeenCalledWith(upload.uploadedRef);
    expect(upload.unsubscribe).toHaveBeenCalledTimes(1);
    expect(IMMUTABLE_IMAGE_CACHE_CONTROL).toBe('private, max-age=31536000, immutable');
    expect(LEGACY_IMAGE_CACHE_CONTROL).toBe('private, max-age=604800');
    expect(ALLOWED_IMAGE_CONTENT_TYPES).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ]);
  });

  test.each([
    ['a non-image MIME', new File(['video'], 'clip.mp4', { type: 'video/mp4' })],
    ['an unsupported image MIME', new File(['vector'], 'portrait.svg', { type: 'image/svg+xml' })],
    ['a missing MIME', new File(['unknown'], 'portrait', { type: '' })],
  ])('rejects %s before starting transport', async (_label, file) => {
    await expect(uploadCacheableImage({ fullPath: 'images/rejected' }, file))
      .rejects.toThrow('valid image file');
    expect(mockUploadBytesResumable).not.toHaveBeenCalled();
    expect(mockGetDownloadURL).not.toHaveBeenCalled();
  });

  test('reports bounded resumable-upload progress without changing the result', async () => {
    const imageRef = { fullPath: 'characters/progress.png' };
    const file = new File(['portrait'], 'portrait.png', { type: 'image/png' });
    const onProgress = jest.fn();
    const upload = createMockUpload(imageRef.fullPath);
    mockUploadBytesResumable.mockReturnValue(upload.uploadTask);
    mockGetDownloadURL.mockResolvedValue('https://example.com/progress.png');

    const result = uploadCacheableImage(imageRef, file, { onProgress });
    const progressSnapshot = {
      ref: upload.uploadedRef,
      bytesTransferred: 25,
      totalBytes: 100,
    };
    upload.progress(progressSnapshot);
    upload.complete();

    await expect(result).resolves.toEqual(expect.objectContaining({
      downloadUrl: 'https://example.com/progress.png',
    }));
    expect(onProgress).toHaveBeenCalledWith({
      bytesTransferred: 25,
      totalBytes: 100,
      fraction: 0.25,
      progress: 25,
      snapshot: progressSnapshot,
    });
  });

  test('rejects an already-aborted signal without creating a transport', async () => {
    const controller = new AbortController();
    controller.abort();
    const file = new File(['portrait'], 'portrait.png', { type: 'image/png' });

    await expect(uploadCacheableImage(
      { fullPath: 'characters/already-aborted.png' },
      file,
      { signal: controller.signal }
    )).rejects.toMatchObject({
      name: 'AbortError',
      message: 'The image upload was aborted.',
    });
    expect(mockUploadBytesResumable).not.toHaveBeenCalled();
  });

  test('cancels a mid-flight upload and rejects with AbortError even if Firebase reports cancellation', async () => {
    const controller = new AbortController();
    const file = new File(['portrait'], 'portrait.png', { type: 'image/png' });
    const upload = createMockUpload('characters/mid-flight.png');
    mockUploadBytesResumable.mockReturnValue(upload.uploadTask);
    const result = uploadCacheableImage(
      { fullPath: 'characters/mid-flight.png' },
      file,
      { signal: controller.signal }
    );

    controller.abort();
    upload.fail(new Error('storage/canceled'));

    await expect(result).rejects.toMatchObject({
      name: 'AbortError',
      message: 'The image upload was aborted.',
    });
    expect(upload.uploadTask.cancel).toHaveBeenCalledTimes(1);
    expect(upload.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mockGetDownloadURL).not.toHaveBeenCalled();
  });

  test('preserves an upload failure and removes upload and abort listeners', async () => {
    const controller = new AbortController();
    const removeEventListener = jest.spyOn(controller.signal, 'removeEventListener');
    const file = new File(['portrait'], 'portrait.webp', { type: 'image/webp' });
    const upload = createMockUpload('characters/upload-failure.webp');
    const uploadError = new Error('storage/retry-limit-exceeded');
    mockUploadBytesResumable.mockReturnValue(upload.uploadTask);
    const result = uploadCacheableImage(
      { fullPath: 'characters/upload-failure.webp' },
      file,
      { signal: controller.signal }
    );

    upload.fail(uploadError);

    await expect(result).rejects.toBe(uploadError);
    expect(upload.unsubscribe).toHaveBeenCalledTimes(1);
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(mockGetDownloadURL).not.toHaveBeenCalled();
  });

  test('preserves a download URL failure and removes all listeners', async () => {
    const controller = new AbortController();
    const addEventListener = jest.spyOn(controller.signal, 'addEventListener');
    const removeEventListener = jest.spyOn(controller.signal, 'removeEventListener');
    const file = new File(['portrait'], 'portrait.gif', { type: 'image/gif' });
    const upload = createMockUpload('characters/url-failure.gif');
    const downloadError = new Error('storage/object-not-found');
    mockUploadBytesResumable.mockReturnValue(upload.uploadTask);
    mockGetDownloadURL.mockRejectedValue(downloadError);
    const result = uploadCacheableImage(
      { fullPath: 'characters/url-failure.gif' },
      file,
      { signal: controller.signal }
    );

    upload.complete();

    await expect(result).rejects.toBe(downloadError);
    const abortListener = addEventListener.mock.calls.find(([eventName]) => (
      eventName === 'abort'
    ))?.[1];
    expect(abortListener).toEqual(expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('abort', abortListener);
    expect(upload.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
