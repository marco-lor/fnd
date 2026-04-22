import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "../firebaseConfig";

const COLLECTION_CONFIG = {
  tecniche: {
    imageFolder: "tecnicas",
    videoFolder: "tecnicas/videos",
    prefix: "tecnica",
    sizeLimit: 900000,
  },
  spells: {
    imageFolder: "spells",
    videoFolder: "spells/videos",
    prefix: "spell",
    sizeLimit: 900000,
  },
};

const AUTH_WAIT_TIMEOUT_MS = 5000;

function sanitizeStorageName(value) {
  const sanitized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized || "item";
}

function getCollectionConfig(collectionKey) {
  const config = COLLECTION_CONFIG[collectionKey];

  if (!config) {
    throw new Error(`Unsupported collection key: ${collectionKey}`);
  }

  return config;
}

function extractStoragePathFromUrl(fileUrl) {
  if (!fileUrl || !fileUrl.includes("/o/")) {
    return null;
  }

  try {
    return decodeURIComponent(fileUrl.split("/o/")[1].split("?")[0]);
  } catch (error) {
    console.warn("Unable to extract storage path from URL:", fileUrl, error);
    return null;
  }
}

function createAuthenticationError() {
  const error = new Error("You must be logged in to upload media. Please sign in again.");
  error.code = "auth/not-authenticated";
  return error;
}

async function waitForAuthenticatedUser(timeoutMs = AUTH_WAIT_TIMEOUT_MS) {
  if (auth.currentUser) {
    return auth.currentUser;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId;
    let unsubscribe = () => {};

    unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        if (settled || !currentUser) {
          return;
        }

        settled = true;
        clearTimeout(timeoutId);
        unsubscribe();
        resolve(currentUser);
      },
      (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutId);
        unsubscribe();
        reject(error);
      }
    );

    timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      unsubscribe();
      reject(createAuthenticationError());
    }, timeoutMs);
  });
}

async function ensureStorageUploadAuth() {
  const currentUser = await waitForAuthenticatedUser();

  try {
    await currentUser.getIdToken(true);
  } catch (error) {
    throw createAuthenticationError();
  }

  return currentUser;
}

async function deleteStoragePath(storagePath) {
  if (!storagePath) {
    return false;
  }

  try {
    await deleteObject(ref(storage, storagePath));
    return true;
  } catch (error) {
    console.warn("Storage cleanup failed for path:", storagePath, error);
    return false;
  }
}

export async function deleteStorageFileByUrl(fileUrl) {
  return deleteStoragePath(extractStoragePathFromUrl(fileUrl));
}

async function uploadFile(collectionKey, userId, itemName, suffix, file, folder) {
  const config = getCollectionConfig(collectionKey);
  const safeBase = `${config.prefix}_${userId}_${sanitizeStorageName(itemName)}_${Date.now()}`;
  const storagePath = `${folder}/${safeBase}_${suffix}`;
  const storageRef = ref(storage, storagePath);
  await ensureStorageUploadAuth();

  await uploadBytes(storageRef, file);
  const downloadUrl = await getDownloadURL(storageRef);

  return { downloadUrl, storagePath };
}

async function loadUserCollection(userId, collectionKey) {
  const userRef = doc(db, "users", userId);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    throw new Error("User not found");
  }

  return {
    userRef,
    userData: userSnap.data(),
    collection: { ...(userSnap.data()?.[collectionKey] || {}) },
  };
}

async function persistOwnedEntry({
  userId,
  collectionKey,
  originalName,
  entryData,
  imageFile = null,
  videoFile = null,
  removeImage = false,
  removeVideo = false,
}) {
  const trimmedName = entryData?.Nome?.trim();

  if (!trimmedName) {
    throw new Error("Nome is required");
  }

  const config = getCollectionConfig(collectionKey);
  const { userRef, collection } = await loadUserCollection(userId, collectionKey);
  const previousEntry = collection[originalName] || {};
  const nextEntry = {
    ...entryData,
    Nome: trimmedName,
  };

  let uploadedImagePath = null;
  let uploadedVideoPath = null;
  let oldImageUrlToDelete = null;
  let oldVideoUrlToDelete = null;

  try {
    if (imageFile) {
      const { downloadUrl, storagePath } = await uploadFile(
        collectionKey,
        userId,
        trimmedName,
        "image",
        imageFile,
        config.imageFolder
      );
      nextEntry.image_url = downloadUrl;
      uploadedImagePath = storagePath;

      if (previousEntry.image_url && previousEntry.image_url !== downloadUrl) {
        oldImageUrlToDelete = previousEntry.image_url;
      }
    } else if (removeImage) {
      delete nextEntry.image_url;
      if (previousEntry.image_url) {
        oldImageUrlToDelete = previousEntry.image_url;
      }
    } else if (previousEntry.image_url) {
      nextEntry.image_url = previousEntry.image_url;
    }

    if (videoFile) {
      const { downloadUrl, storagePath } = await uploadFile(
        collectionKey,
        userId,
        trimmedName,
        "video",
        videoFile,
        config.videoFolder
      );
      nextEntry.video_url = downloadUrl;
      uploadedVideoPath = storagePath;

      if (previousEntry.video_url && previousEntry.video_url !== downloadUrl) {
        oldVideoUrlToDelete = previousEntry.video_url;
      }
    } else if (removeVideo) {
      delete nextEntry.video_url;
      if (previousEntry.video_url) {
        oldVideoUrlToDelete = previousEntry.video_url;
      }
    } else if (previousEntry.video_url) {
      nextEntry.video_url = previousEntry.video_url;
    }

    if (trimmedName !== originalName) {
      delete collection[originalName];
    }

    collection[trimmedName] = nextEntry;

    if (config.sizeLimit && JSON.stringify(collection).length > config.sizeLimit) {
      const sizeError = new Error("Data too large. Try using a smaller image or video.");
      sizeError.code = "data-too-large";
      throw sizeError;
    }

    await updateDoc(userRef, { [collectionKey]: collection });

    await Promise.allSettled([
      deleteStorageFileByUrl(oldImageUrlToDelete),
      deleteStorageFileByUrl(oldVideoUrlToDelete),
    ]);

    return { name: trimmedName, data: nextEntry };
  } catch (error) {
    await Promise.allSettled([
      deleteStoragePath(uploadedImagePath),
      deleteStoragePath(uploadedVideoPath),
    ]);
    throw error;
  }
}

async function deleteOwnedEntry({ userId, collectionKey, itemName, itemData }) {
  const { userRef, collection } = await loadUserCollection(userId, collectionKey);
  const currentEntry = itemData || collection[itemName] || null;

  if (!(itemName in collection)) {
    return false;
  }

  delete collection[itemName];
  await updateDoc(userRef, { [collectionKey]: collection });

  await Promise.allSettled([
    deleteStorageFileByUrl(currentEntry?.image_url),
    deleteStorageFileByUrl(currentEntry?.video_url),
  ]);

  return true;
}

export async function saveTecnicaForUser(options) {
  return persistOwnedEntry({ ...options, collectionKey: "tecniche" });
}

export async function saveSpellForUser(options) {
  return persistOwnedEntry({ ...options, collectionKey: "spells" });
}

export async function deleteTecnicaForUser(options) {
  return deleteOwnedEntry({ ...options, collectionKey: "tecniche" });
}

export async function deleteSpellForUser(options) {
  return deleteOwnedEntry({ ...options, collectionKey: "spells" });
}
