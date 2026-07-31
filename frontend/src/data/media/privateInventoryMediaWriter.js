import { auth } from '../../components/firebaseConfig';
import { mutateInventory } from '../userData/userDataCommands';
import {
  readUserDataRole,
  readUserOwnedDataDocument,
} from '../userData/userDataRepository';
import {
  buildTask07PrepareRetryKey,
  runTask07ControlledWriterUpload,
} from './mediaWriterAdapter';
import { isTask07MediaV1WriteEnabled } from './mediaFeatureFlags';

const stableInventoryId = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(normalized)
    ? normalized
    : null;
};

const stripTask07InventoryTransport = (value) => {
  const source = value && typeof value === 'object' ? value : {};
  const output = { ...source };
  delete output.media;
  delete output.mediaUpdatedAt;
  delete output.task07MediaRevision;
  if (output.General && typeof output.General === 'object') {
    output.General = { ...output.General };
    delete output.General.media;
  }
  return output;
};

const recordTargetRollback = (error, result) => {
  if (error && typeof error === 'object') error.targetRollback = result;
};

/**
 * Adopts only command-owned V2 inventory targets. An edit without a stable
 * inventory ID or without the corresponding subdocument returns null before
 * mutation so legacy root-array entries stay on their existing path.
 */
export const tryPersistTask07VarieMedia = async ({
  userId,
  inventoryItemId = null,
  snapshot,
  quantity = 1,
  file,
  signal,
}) => {
  const actorUid = auth.currentUser?.uid || '';
  if (!actorUid || !file || !signal) return null;
  const role = await readUserDataRole(actorUid);
  if (!role || !await isTask07MediaV1WriteEnabled({
    purpose: 'item',
    role,
    uid: actorUid,
  })) {
    return null;
  }

  const requestedInventoryId = stableInventoryId(inventoryItemId);
  let before = null;
  if (inventoryItemId != null) {
    if (!requestedInventoryId) return null;
    const existing = await readUserOwnedDataDocument(
      userId,
      'inventory',
      requestedInventoryId
    );
    if (!existing) return null;
    before = existing.data;
  }

  const retryKey = buildTask07PrepareRetryKey({
    kind: 'item',
    ownerUid: userId,
    entityHint: requestedInventoryId || snapshot?.name || snapshot?.Nome,
    file,
  });
  const safeSnapshot = stripTask07InventoryTransport(snapshot);
  let resolvedInventoryId = requestedInventoryId;
  let preparationChanged = false;

  const rollbackPreparedEntity = async () => {
    if (!preparationChanged) return;
    if (requestedInventoryId) {
      await mutateInventory({
        userId,
        action: 'edit',
        inventoryId: requestedInventoryId,
        patch: stripTask07InventoryTransport(
          before.currentSnapshot || before.acquisitionSnapshot || {}
        ),
        retryKey: `${retryKey}:rollback-edit`,
      });
      const beforeQuantity = Number(before.quantity);
      if (
        Number.isSafeInteger(beforeQuantity)
        && beforeQuantity >= 1
        && beforeQuantity <= 9999
      ) {
        await mutateInventory({
          userId,
          action: 'setQuantity',
          inventoryId: requestedInventoryId,
          quantity: beforeQuantity,
          retryKey: `${retryKey}:rollback-quantity`,
        });
      }
    } else {
      await mutateInventory({
        userId,
        action: 'remove',
        inventoryId: resolvedInventoryId,
        retryKey: `${retryKey}:rollback-create`,
      });
    }
    preparationChanged = false;
  };

  try {
    if (requestedInventoryId) {
      await mutateInventory({
        userId,
        action: 'edit',
        inventoryId: requestedInventoryId,
        patch: safeSnapshot,
        retryKey: `${retryKey}:prepare-edit`,
      });
      preparationChanged = true;
      const currentQuantity = Number(before.quantity);
      if (
        Number.isSafeInteger(quantity)
        && quantity >= 1
        && quantity <= 9999
        && quantity !== currentQuantity
      ) {
        await mutateInventory({
          userId,
          action: 'setQuantity',
          inventoryId: requestedInventoryId,
          quantity,
          retryKey: `${retryKey}:prepare-quantity`,
        });
      }
    } else {
      const prepared = await mutateInventory({
        userId,
        action: 'createVarie',
        quantity,
        snapshot: safeSnapshot,
        retryKey: `${retryKey}:prepare-create`,
      });
      resolvedInventoryId = stableInventoryId(prepared?.inventoryId);
      if (!resolvedInventoryId) {
        throw new Error('Task 05 returned an invalid inventory identity.');
      }
      preparationChanged = true;
    }
  } catch (error) {
    if (preparationChanged) {
      try {
        await rollbackPreparedEntity();
        recordTargetRollback(error, { ok: true });
      } catch (rollbackError) {
        recordTargetRollback(error, {
          ok: false,
          error: rollbackError,
        });
      }
    }
    throw error;
  }

  let pipelineStarted = false;
  try {
    const outcome = await runTask07ControlledWriterUpload({
      actorUid,
      role,
      ownerUid: userId,
      entityId: resolvedInventoryId,
      kind: 'item',
      referenceScope: 'user-inventory',
      file,
      target: before || {},
      enabled: true,
      signal,
      prepareEntity: async () => {
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
        recordTargetRollback(error, {
          ok: false,
          error: rollbackError,
        });
      }
    }
    throw error;
  }
};
