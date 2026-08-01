import { tryPersistTask07PersonalMedia } from "../../data/media/personalMediaWriter";
import { mutatePersonalContent } from "../../data/userData/userDataCommands";

const PERSONAL_COMMAND_KINDS = Object.freeze({
  spells: "spell",
  tecniche: "tecnica",
});

const USER_DATA_TRANSPORT_FIELDS = new Set([
  '_task05',
  '_task05ContentId',
  'media',
  'mediaUpdatedAt',
  'task07MediaRevision',
  'task07VideoMediaRevision',
  'videoMedia',
  'videoMediaUpdatedAt',
  'createdAt',
  'displayName',
  'id',
  'legacyManaged',
  'legacySourceHash',
  'legacySourceUpdateTime',
  'migration',
  'modelVersion',
  'name',
  'normalizedName',
  'revision',
  'schemaVersion',
  'updatedAt',
  'updatedBy',
]);

const normalizeContentId = (value) => {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(candidate) ? candidate : null;
};

export const stripUserDataTransportFields = (value) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const stableContentId = normalizeContentId(source._task05ContentId);
  if (!stableContentId) return { ...source };
  const result = Object.fromEntries(
    Object.entries(source).filter(([key]) => !USER_DATA_TRANSPORT_FIELDS.has(key))
  );
  return { ...result, id: stableContentId };
};

const createCanonicalError = (message, code) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(',')}}`;
};

const buildPersonalRetryKey = ({ collectionKey, userId, contentId, data }) => [
  'task05-personal-upsert',
  collectionKey,
  userId,
  contentId || 'new',
  stableStringify(data),
].join(':').slice(0, 512);

async function persistOwnedEntry({
  userId,
  collectionKey,
  originalName,
  entryData,
  originalEntity = entryData,
  imageFile = null,
  videoFile = null,
  removeImage = false,
  removeVideo = false,
  signal = null,
}) {
  const cleanEntryData = stripUserDataTransportFields(entryData);
  const trimmedName = cleanEntryData?.Nome?.trim();

  if (!trimmedName) throw new Error("Nome is required");
  const commandKind = PERSONAL_COMMAND_KINDS[collectionKey];
  if (!commandKind) throw new Error(`Unsupported collection key: ${collectionKey}`);

  const contentId = normalizeContentId(
    originalEntity?._task05ContentId || entryData?._task05ContentId
  );
  const nextEntry = {
    ...cleanEntryData,
    Nome: trimmedName,
  };
  const hasMediaChange = Boolean(imageFile || videoFile || removeImage || removeVideo);

  if (hasMediaChange) {
    const task07Result = await tryPersistTask07PersonalMedia({
      userId,
      collectionKey,
      originalEntity: contentId
        ? { ...originalEntity, _task05ContentId: contentId }
        : originalEntity,
      entryData: nextEntry,
      imageFile,
      videoFile,
      removeImage,
      removeVideo,
      signal,
    });
    if (!task07Result) {
      throw createCanonicalError(
        'Canonical media is unavailable. The entry was not changed; retry after Task 07 is enabled.',
        'task07-canonical-required'
      );
    }
    const resolvedContentId = normalizeContentId(task07Result.contentId);
    if (!resolvedContentId || (contentId && resolvedContentId !== contentId)) {
      throw createCanonicalError(
        'Task 07 returned an unexpected personal-content identity.',
        'task07-target-mismatch'
      );
    }
    return {
      ...task07Result,
      name: trimmedName,
      contentId: resolvedContentId,
      data: { ...nextEntry, _task05ContentId: resolvedContentId },
    };
  }

  const receipt = await mutatePersonalContent({
    userId,
    kind: commandKind,
    action: 'upsert',
    ...(contentId ? { contentId } : {}),
    name: trimmedName,
    data: nextEntry,
    retryKey: buildPersonalRetryKey({
      collectionKey,
      userId,
      contentId,
      data: nextEntry,
    }),
  });
  const resolvedContentId = normalizeContentId(receipt?.contentId);
  if (!resolvedContentId || (contentId && resolvedContentId !== contentId)) {
    throw createCanonicalError(
      'Task 05 returned an invalid personal-content identity.',
      'task05-invalid-target'
    );
  }
  return {
    ...receipt,
    name: trimmedName,
    contentId: resolvedContentId,
    data: { ...nextEntry, _task05ContentId: resolvedContentId },
  };
}

async function deleteOwnedEntry({ userId, collectionKey, itemName, itemData }) {
  const contentId = normalizeContentId(itemData?._task05ContentId);
  const commandKind = PERSONAL_COMMAND_KINDS[collectionKey];
  if (!contentId || !commandKind) {
    throw createCanonicalError(
      `Cannot delete ${itemName || 'this entry'} without its stable V2 content ID.`,
      'task05-stable-target-required'
    );
  }
  await mutatePersonalContent({
    userId,
    kind: commandKind,
    action: "delete",
    contentId,
    retryKey: [
      "task07-personal-delete",
      collectionKey,
      userId,
      contentId,
      Number(itemData?.task07MediaRevision) || 0,
      Number(itemData?.task07VideoMediaRevision) || 0,
    ].join(":"),
  });
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
