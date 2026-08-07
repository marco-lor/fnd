import { auth } from '../../components/firebaseConfig';
import { mutateInventory } from '../userData/userDataCommands';
import {
  readUserDataRole,
  readUserOwnedDataDocument,
} from '../userData/userDataRepository';
import {
  buildTask07DetachRetryKey,
  buildTask07PrepareRetryKey,
  getTask07PreviousAssetIdForKind,
  runTask07ControlledWriterUpload,
} from './mediaWriterAdapter';
import { isTask07MediaV1WriteEnabled } from './mediaFeatureFlags';
import { throwIfTask07Aborted } from './mediaErrors';
import { retireTask07MediaAsset } from './mediaPipeline';

export const stableInventoryId = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(normalized)
    ? normalized
    : null;
};

const INVENTORY_TRANSPORT_FIELDS = new Set([
  '_instance',
  '_task05',
  'acquisitionHash',
  'acquisitionSnapshot',
  'catalogItemId',
  'catalogVersion',
  'createdAt',
  'currentHash',
  'currentRevision',
  'currentSnapshot',
  'displayName',
  'kind',
  'legacyManaged',
  'media',
  'mediaUpdatedAt',
  'migration',
  'modelVersion',
  'normalizedName',
  'quantity',
  'revision',
  'schemaVersion',
  'source',
  'task07MediaRevision',
  'task07VideoMediaRevision',
  'updatedAt',
  'updatedBy',
  'videoMedia',
  'videoMediaUpdatedAt',
]);

export const stripTask07InventoryTransport = (value) => {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
  const output = Object.fromEntries(
    Object.entries(source).filter(([key]) => !INVENTORY_TRANSPORT_FIELDS.has(key))
  );
  if (output.General && typeof output.General === 'object') {
    output.General = { ...output.General };
    delete output.General.media;
  }
  return output;
};

const createCanonicalError = (message, code) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const recordTargetRollback = (error, result) => {
  if (error && typeof error === 'object') error.targetRollback = result;
};

const validQuantity = (value) => (
  Number.isSafeInteger(Number(value))
  && Number(value) >= 1
  && Number(value) <= 9999
);

/**
 * Persists a private inventory snapshot through Task 05 and, when requested,
 * attaches/replaces/retires its canonical Task 07 main-image slot. Existing
 * items must have a stable V2 inventory ID. A new target is allowed only for a
 * custom Varie creation, where Task 05 returns the identity before upload.
 */
export const persistCanonicalInventoryItem = async ({
  userId,
  inventoryItemId = null,
  snapshot,
  quantity = null,
  file = null,
  removeImage = false,
  allowCreateVarie = false,
  retryKey = null,
  signal = null,
}) => {
  const requestedInventoryId = inventoryItemId == null
    ? null
    : stableInventoryId(inventoryItemId);
  if (inventoryItemId != null && !requestedInventoryId) {
    throw createCanonicalError(
      'Inventory edit requires a stable Task 05 inventory ID.',
      'task05-stable-target-required'
    );
  }
  if (!requestedInventoryId && !allowCreateVarie) {
    throw createCanonicalError(
      'Inventory edit requires a stable Task 05 inventory ID.',
      'task05-stable-target-required'
    );
  }
  if (!requestedInventoryId && removeImage) {
    throw createCanonicalError(
      'Canonical media cannot be removed before the inventory item exists.',
      'task05-stable-target-required'
    );
  }

  const hasMediaChange = Boolean(file || removeImage);
  const actorUid = auth.currentUser?.uid || '';
  let role = '';
  if (hasMediaChange) {
    if (!actorUid || !signal) return null;
    role = await readUserDataRole(actorUid);
    if (!role || !await isTask07MediaV1WriteEnabled({
      purpose: 'item',
      role,
      uid: actorUid,
    })) {
      return null;
    }
  }

  const before = requestedInventoryId
    ? await readUserOwnedDataDocument(userId, 'inventory', requestedInventoryId)
    : null;
  if (requestedInventoryId && !before) {
    throw createCanonicalError(
      'The V2 inventory target no longer exists. Refresh and try again.',
      'task05-target-not-found'
    );
  }
  const beforeData = before?.data || {};
  const beforeSnapshot = beforeData.currentSnapshot
    || beforeData.acquisitionSnapshot
    || {};
  const beforeQuantity = Number(beforeData.quantity);
  const safeSnapshot = stripTask07InventoryTransport(snapshot);
  const detachAssetId = removeImage && !file
    ? getTask07PreviousAssetIdForKind(beforeData, 'item')
    : null;
  if (removeImage && !file && !detachAssetId) {
    throw createCanonicalError(
      'This inventory item has no canonical image to remove.',
      'task07-canonical-target-required'
    );
  }

  const operationRetryKey = file
    ? buildTask07PrepareRetryKey({
      kind: 'item',
      ownerUid: userId,
      entityHint: requestedInventoryId || snapshot?.name || snapshot?.Nome,
      file,
    })
    : (detachAssetId
      ? buildTask07DetachRetryKey({
        kind: 'item',
        ownerUid: userId,
        entityId: requestedInventoryId,
        assetId: detachAssetId,
      })
      : retryKey);
  if (!operationRetryKey) {
    throw new TypeError('A retryKey is required for an inventory mutation without media.');
  }

  let resolvedInventoryId = requestedInventoryId;
  let preparationChanged = false;
  const rollbackPreparedEntity = async () => {
    if (!preparationChanged) return;
    if (requestedInventoryId) {
      await mutateInventory({
        userId,
        action: 'edit',
        inventoryId: requestedInventoryId,
        patch: stripTask07InventoryTransport(beforeSnapshot),
        retryKey: `${operationRetryKey}:rollback-edit`,
      });
      if (validQuantity(beforeQuantity) && beforeData.kind === 'varie') {
        await mutateInventory({
          userId,
          action: 'setQuantity',
          inventoryId: requestedInventoryId,
          quantity: beforeQuantity,
          retryKey: `${operationRetryKey}:rollback-quantity`,
        });
      }
    } else {
      await mutateInventory({
        userId,
        action: 'remove',
        inventoryId: resolvedInventoryId,
        retryKey: `${operationRetryKey}:rollback-create`,
      });
    }
    preparationChanged = false;
  };

  const prepareTarget = async () => {
    if (requestedInventoryId) {
      await mutateInventory({
        userId,
        action: 'edit',
        inventoryId: requestedInventoryId,
        patch: safeSnapshot,
        retryKey: `${operationRetryKey}:prepare-edit`,
      });
      preparationChanged = true;
      if (
        beforeData.kind === 'varie'
        && validQuantity(quantity)
        && Number(quantity) !== beforeQuantity
      ) {
        await mutateInventory({
          userId,
          action: 'setQuantity',
          inventoryId: requestedInventoryId,
          quantity: Number(quantity),
          retryKey: `${operationRetryKey}:prepare-quantity`,
        });
      }
      return;
    }
    if (!validQuantity(quantity)) {
      throw new TypeError('Varie quantity must be between 1 and 9999.');
    }
    const prepared = await mutateInventory({
      userId,
      action: 'createVarie',
      quantity: Number(quantity),
      snapshot: safeSnapshot,
      retryKey: `${operationRetryKey}:prepare-create`,
    });
    resolvedInventoryId = stableInventoryId(prepared?.inventoryId);
    if (!resolvedInventoryId) {
      throw createCanonicalError(
        'Task 05 returned an invalid inventory identity.',
        'task05-invalid-target'
      );
    }
    preparationChanged = true;
  };

  try {
    if (!hasMediaChange) {
      await prepareTarget();
      return {
        inventoryItemId: resolvedInventoryId,
        outcome: null,
        task07: false,
      };
    }

    if (file) {
      let pipelineStarted = false;
      const createdBeforePipeline = !requestedInventoryId;
      try {
        // The Task 07 receipt and manifest must never capture a null entityId.
        if (createdBeforePipeline) await prepareTarget();
        const outcome = await runTask07ControlledWriterUpload({
          actorUid,
          role,
          ownerUid: userId,
          entityId: resolvedInventoryId,
          kind: 'item',
          referenceScope: 'user-inventory',
          file,
          target: beforeData,
          enabled: true,
          signal,
          prepareEntity: async () => {
            if (!createdBeforePipeline) await prepareTarget();
            pipelineStarted = true;
          },
          rollbackPreparedEntity,
        });
        return {
          inventoryItemId: resolvedInventoryId,
          outcome,
          task07: true,
        };
      } catch (error) {
        const receiptFailedBeforePipeline = (
          !pipelineStarted
          && !error?.assetId
          && error?.committed !== true
          && error?.commitAttempted !== true
          && error?.targetRollback == null
        );
        if (receiptFailedBeforePipeline && preparationChanged) {
          try {
            await rollbackPreparedEntity();
            recordTargetRollback(error, { ok: true });
          } catch (rollbackError) {
            recordTargetRollback(error, { ok: false, error: rollbackError });
          }
        }
        throw error;
      }
    }

    await prepareTarget();
    try {
      throwIfTask07Aborted(signal);
      const retirement = await retireTask07MediaAsset(detachAssetId);
      throwIfTask07Aborted(signal);
      return {
        inventoryItemId: resolvedInventoryId,
        outcome: {
          assetId: detachAssetId,
          handled: true,
          kind: 'item',
          retirement,
          status: 'retired',
        },
        task07: true,
      };
    } catch (error) {
      try {
        await rollbackPreparedEntity();
        recordTargetRollback(error, { ok: true });
      } catch (rollbackError) {
        recordTargetRollback(error, { ok: false, error: rollbackError });
      }
      throw error;
    }
  } catch (error) {
    if (preparationChanged && error?.targetRollback == null) {
      try {
        await rollbackPreparedEntity();
        recordTargetRollback(error, { ok: true });
      } catch (rollbackError) {
        recordTargetRollback(error, { ok: false, error: rollbackError });
      }
    }
    throw error;
  }
};

export const tryPersistTask07VarieMedia = (options) => (
  persistCanonicalInventoryItem({
    ...options,
    allowCreateVarie: options?.inventoryItemId == null,
  })
);
