import { getDownloadURL, uploadBytesResumable } from 'firebase/storage';

export const IMMUTABLE_IMAGE_CACHE_CONTROL = 'private, max-age=31536000, immutable';
export const LEGACY_IMAGE_CACHE_CONTROL = 'private, max-age=604800';
export const ALLOWED_IMAGE_CONTENT_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const allowedImageContentTypes = new Set(ALLOWED_IMAGE_CONTENT_TYPES);

const createUploadAbortError = () => {
  const message = 'The image upload was aborted.';
  if (typeof DOMException === 'function') {
    return new DOMException(message, 'AbortError');
  }

  const error = new Error(message);
  error.name = 'AbortError';
  return error;
};

const readFiniteProgressValue = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
};

export async function uploadCacheableImage(imageRef, file, options = {}) {
  const contentType = String(file?.type || '').trim().toLowerCase();
  if (!file || !allowedImageContentTypes.has(contentType)) {
    throw new Error('A valid image file is required (JPEG, PNG, WebP, or GIF).');
  }

  const { signal, onProgress } = options || {};
  if (signal?.aborted) {
    throw createUploadAbortError();
  }

  const metadata = {
    cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
    contentType,
  };
  const uploadTask = uploadBytesResumable(imageRef, file, metadata);

  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribeUpload = null;

    const detachUploadObserver = () => {
      if (typeof unsubscribeUpload !== 'function') return;
      const unsubscribe = unsubscribeUpload;
      unsubscribeUpload = null;
      try {
        unsubscribe();
      } catch {
        // Firebase observer cleanup must not change the upload outcome.
      }
    };

    const detachAbortObserver = () => {
      if (signal && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', handleAbort);
      }
    };

    const cleanup = () => {
      detachUploadObserver();
      detachAbortObserver();
    };

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const resolveOnce = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const handleAbort = () => {
      if (settled) return;
      try {
        uploadTask.cancel();
      } catch {
        // The public result is still a deterministic AbortError.
      }
      rejectOnce(createUploadAbortError());
    };

    const handleProgress = (snapshot) => {
      if (settled || typeof onProgress !== 'function') return;

      const bytesTransferred = readFiniteProgressValue(snapshot?.bytesTransferred);
      const totalBytes = readFiniteProgressValue(snapshot?.totalBytes);
      const fraction = totalBytes > 0
        ? Math.min(1, bytesTransferred / totalBytes)
        : 0;

      try {
        onProgress({
          bytesTransferred,
          totalBytes,
          fraction,
          progress: fraction * 100,
          snapshot,
        });
      } catch {
        // A presentation callback cannot be allowed to corrupt the transport.
      }
    };

    const handleUploadError = (error) => {
      if (signal?.aborted) {
        rejectOnce(createUploadAbortError());
        return;
      }
      rejectOnce(error);
    };

    const handleUploadComplete = async () => {
      if (settled) return;

      const snapshot = uploadTask.snapshot;
      const uploadedRef = snapshot?.ref || imageRef;

      try {
        const downloadUrl = await getDownloadURL(uploadedRef);
        if (signal?.aborted) {
          handleAbort();
          return;
        }

        resolveOnce({
          downloadUrl,
          storagePath: uploadedRef?.fullPath || '',
          snapshot,
        });
      } catch (error) {
        if (signal?.aborted) {
          rejectOnce(createUploadAbortError());
          return;
        }
        rejectOnce(error);
      }
    };

    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', handleAbort, { once: true });
    }
    if (signal?.aborted) {
      handleAbort();
      return;
    }

    try {
      unsubscribeUpload = uploadTask.on(
        'state_changed',
        handleProgress,
        handleUploadError,
        handleUploadComplete
      );
      if (settled) detachUploadObserver();
    } catch (error) {
      try {
        uploadTask.cancel();
      } catch {
        // The observer registration error remains the public failure.
      }
      rejectOnce(error);
      return;
    }

    if (signal?.aborted) handleAbort();
  });
}
