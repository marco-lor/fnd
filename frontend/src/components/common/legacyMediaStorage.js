import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from 'firebase/storage';
import { storage } from '../firebaseStorage';
import { createDeferredStorageCleanup } from './deferredStorageCleanup';
import { uploadCacheableImage } from './imageStorage';

const normalizeLegacyStoragePath = (value) => {
  const path = typeof value === 'string' ? value.trim().replace(/^\/+/, '') : '';
  if (
    !path
    || path.includes('\\')
    || path.includes('\0')
    || path.includes('://')
    || /^(?:media_assets|media_uploads)\//.test(path)
    || /^media\/v\d+\//.test(path)
  ) {
    throw new TypeError('A safe legacy Storage path is required.');
  }
  return path;
};

const legacyRef = (path) => ref(storage, normalizeLegacyStoragePath(path));

export const uploadLegacyImage = async (path, file, options) => (
  uploadCacheableImage(legacyRef(path), file, options)
);

export const uploadLegacyBlob = async (path, file, metadata) => {
  const objectRef = legacyRef(path);
  const snapshot = await uploadBytes(objectRef, file, metadata);
  const downloadUrl = await getDownloadURL(snapshot?.ref || objectRef);
  return {
    downloadUrl,
    objectRef: snapshot?.ref || objectRef,
    snapshot,
    storagePath: snapshot?.ref?.fullPath || normalizeLegacyStoragePath(path),
  };
};

export const getLegacyDownloadUrl = (path) => getDownloadURL(legacyRef(path));

export const deleteLegacyStoragePath = async (path) => {
  if (!path) return false;
  await deleteObject(legacyRef(path));
  return true;
};

export const createLegacyStorageCleanup = (options) => (
  createDeferredStorageCleanup(deleteLegacyStoragePath, options)
);

export const __legacyMediaStorageBoundary = Object.freeze({
  generatedMediaWritesAllowed: false,
  excludedRoots: Object.freeze(['media_assets/', 'media_uploads/', 'media/v*/']),
  root: 'legacy-only',
});
