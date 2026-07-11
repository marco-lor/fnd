import { getDownloadURL, uploadBytes } from 'firebase/storage';

export const IMMUTABLE_IMAGE_CACHE_CONTROL = 'private, max-age=31536000, immutable';
export const LEGACY_IMAGE_CACHE_CONTROL = 'private, max-age=604800';

export async function uploadCacheableImage(imageRef, file) {
  if (!file || (file.type && !file.type.startsWith('image/'))) {
    throw new Error('A valid image file is required.');
  }

  const metadata = {
    cacheControl: IMMUTABLE_IMAGE_CACHE_CONTROL,
    ...(file.type ? { contentType: file.type } : {}),
  };
  const snapshot = await uploadBytes(imageRef, file, metadata);
  const downloadUrl = await getDownloadURL(snapshot?.ref || imageRef);

  return {
    downloadUrl,
    storagePath: (snapshot?.ref || imageRef)?.fullPath || '',
    snapshot,
  };
}
