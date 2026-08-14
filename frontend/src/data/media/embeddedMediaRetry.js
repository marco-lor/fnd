const asString = (value) => (
  typeof value === 'string' ? value.trim() : ''
);

const fileIdentityByObject = new WeakMap();
let nextFileIdentity = 1;

export const task07EmbeddedFileFingerprint = (file) => {
  if (!file || (typeof file !== 'object' && typeof file !== 'function')) {
    throw new TypeError('Embedded media file identity is invalid.');
  }
  let objectIdentity = fileIdentityByObject.get(file);
  if (!objectIdentity) {
    objectIdentity = `file-${nextFileIdentity}`;
    nextFileIdentity += 1;
    fileIdentityByObject.set(file, objectIdentity);
  }
  return JSON.stringify({
    lastModified: Number(file.lastModified) || 0,
    name: asString(file.name),
    objectIdentity,
    size: Number(file.size) || 0,
    type: asString(file.type),
  });
};

export const task07EmbeddedOperationRetryKey = ({parentId, operation}) => {
  const normalizedParentId = asString(parentId);
  if (!normalizedParentId || !operation || typeof operation !== 'object') {
    throw new TypeError('Embedded media retry identity is invalid.');
  }
  if (operation.action === 'retire') {
    const assetId = asString(operation.assetId);
    if (!/^m_[a-f0-9]{40}$/.test(assetId)) {
      throw new TypeError('Embedded media retirement identity is invalid.');
    }
    return JSON.stringify({action: 'retire', assetId, parentId: normalizedParentId});
  }
  if (operation.action !== 'upload' || !operation.file) {
    throw new TypeError('Embedded media upload identity is invalid.');
  }
  const entryId = asString(operation.entry?.task07MediaEntryId);
  const locator = operation.entryKey ?? operation.entryIndex;
  return JSON.stringify({
    action: 'upload',
    entryId,
    file: task07EmbeddedFileFingerprint(operation.file),
    kind: asString(operation.kind),
    locator,
    parentId: normalizedParentId,
    slot: asString(operation.slot || 'media'),
    targetKind: asString(operation.targetKind),
  });
};

export const runTask07EmbeddedOperationSequence = async ({
  completedKeys,
  execute,
  operations,
  parentId,
}) => {
  if (!(completedKeys instanceof Set) || typeof execute !== 'function' ||
    !Array.isArray(operations)) {
    throw new TypeError('Embedded media retry sequence is invalid.');
  }
  const results = [];
  for (const operation of operations) {
    const key = task07EmbeddedOperationRetryKey({parentId, operation});
    if (completedKeys.has(key)) {
      results.push({key, skipped: true});
      continue;
    }
    const value = await execute(operation);
    completedKeys.add(key);
    results.push({key, skipped: false, value});
  }
  return results;
};

export const resolveTask07CatalogCreateAttempt = ({
  documentExists,
  documentId,
  pendingDocumentId,
}) => {
  const requested = asString(documentId);
  const pending = asString(pendingDocumentId);
  if (!requested) throw new TypeError('Catalog document identity is invalid.');
  if (pending && pending !== requested) {
    return {blocked: true, resume: false, reason: 'pending-other-document'};
  }
  if (documentExists && pending !== requested) {
    return {blocked: true, resume: false, reason: 'already-exists'};
  }
  return {
    blocked: false,
    resume: documentExists && pending === requested,
    reason: null,
  };
};
