import { useCallback } from 'react';
import {
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import {
  buildPlacementDocId,
  normalizeTokenSizeSquares,
} from './boardUtils';
import { normalizeTokenVisionRadiusSquares } from './lightingVisibility';
import {
  normalizeTurnCounter,
  normalizeTurnEffects,
} from './turnOrder';

const normalizeStatuses = (statuses) => (
  Array.isArray(statuses)
    ? statuses.filter((statusId) => typeof statusId === 'string' && statusId)
    : null
);

const normalizeOptionalVisionEnabled = (visionEnabled) => (
  typeof visionEnabled === 'boolean' ? visionEnabled : undefined
);

const normalizeOptionalVisionRadiusSquares = (visionRadiusSquares) => {
  const numericValue = Number(visionRadiusSquares);
  return Number.isFinite(numericValue)
    ? normalizeTokenVisionRadiusSquares(numericValue)
    : undefined;
};

export default function useGrigliataPlacementActions({
  activeBackgroundId = '',
  activePlacementsById,
  currentUserId = '',
  isManager = false,
  ownedTrayTokensById,
  buildHiddenPlacementSettingsPayload,
  isLegacyHiddenPlacementToken,
  isCustomTokenInstance,
  deleteCustomToken,
  placementRuleSafeBatchSize = 6,
  placementAndUserSettingsBatchSize = 4,
  placementDeleteBatchSize = 3,
}) {
  const buildPlacementWritePayload = useCallback(({
    backgroundId,
    tokenId,
    ownerUid,
    col,
    row,
    sizeSquares,
    isVisibleToPlayers,
    isDead,
    statuses,
    visionEnabled,
    visionRadiusSquares,
    isInTurnOrder,
    turnOrderInitiative,
    turnOrderJoinedAt,
    turnCounter,
    turnEffects,
  }) => {
    const resolvedTokenId = typeof tokenId === 'string' && tokenId ? tokenId : ownerUid;
    const placementId = buildPlacementDocId(backgroundId, resolvedTokenId);
    const existingPlacement = activePlacementsById.get(placementId);
    const resolvedIsVisibleToPlayers = typeof isVisibleToPlayers === 'boolean'
      ? isVisibleToPlayers
      : existingPlacement?.isVisibleToPlayers !== false;
    const resolvedIsDead = typeof isDead === 'boolean'
      ? isDead
      : existingPlacement?.isDead === true;
    const resolvedStatuses = normalizeStatuses(statuses)
      ?? normalizeStatuses(existingPlacement?.statuses);
    const resolvedIsInTurnOrder = typeof isInTurnOrder === 'boolean'
      ? isInTurnOrder
      : existingPlacement?.isInTurnOrder === true;
    const resolvedTurnOrderInitiative = Number.isInteger(turnOrderInitiative)
      ? turnOrderInitiative
      : (Number.isInteger(existingPlacement?.turnOrderInitiative) ? existingPlacement.turnOrderInitiative : null);
    const resolvedTurnOrderJoinedAt = turnOrderJoinedAt === undefined
      ? (existingPlacement?.turnOrderJoinedAt || null)
      : turnOrderJoinedAt;
    const resolvedTurnCounter = turnCounter === undefined
      ? normalizeTurnCounter(existingPlacement?.turnCounter, 0)
      : normalizeTurnCounter(turnCounter, 0);
    const resolvedTurnEffects = turnEffects === undefined
      ? normalizeTurnEffects(existingPlacement?.turnEffects)
      : normalizeTurnEffects(turnEffects);
    const resolvedSizeSquares = sizeSquares === undefined
      ? normalizeTokenSizeSquares(existingPlacement?.sizeSquares)
      : normalizeTokenSizeSquares(sizeSquares);
    const resolvedVisionEnabled = visionEnabled === undefined
      ? normalizeOptionalVisionEnabled(existingPlacement?.visionEnabled)
      : normalizeOptionalVisionEnabled(visionEnabled);
    const resolvedVisionRadiusSquares = visionRadiusSquares === undefined
      ? normalizeOptionalVisionRadiusSquares(existingPlacement?.visionRadiusSquares)
      : normalizeTokenVisionRadiusSquares(visionRadiusSquares);
    const ownedTrayToken = ownedTrayTokensById.get(resolvedTokenId) || null;
    const existingLabel = typeof existingPlacement?.label === 'string' ? existingPlacement.label.trim() : '';
    const ownedLabel = typeof ownedTrayToken?.label === 'string' ? ownedTrayToken.label.trim() : '';
    const existingImageUrl = typeof existingPlacement?.imageUrl === 'string' ? existingPlacement.imageUrl.trim() : '';
    const ownedImageUrl = typeof ownedTrayToken?.imageUrl === 'string' ? ownedTrayToken.imageUrl.trim() : '';
    const resolvedLabel = existingLabel || ownedLabel || ownerUid || 'Player';
    const resolvedImageUrl = existingImageUrl || ownedImageUrl;

    return {
      backgroundId,
      tokenId: resolvedTokenId,
      ownerUid,
      label: resolvedLabel,
      imageUrl: resolvedImageUrl,
      col,
      row,
      sizeSquares: resolvedSizeSquares,
      isVisibleToPlayers: resolvedIsVisibleToPlayers,
      isDead: resolvedIsDead,
      ...(resolvedStatuses !== null ? { statuses: resolvedStatuses } : {}),
      ...(resolvedVisionEnabled !== undefined ? { visionEnabled: resolvedVisionEnabled } : {}),
      ...(resolvedVisionRadiusSquares !== undefined ? { visionRadiusSquares: resolvedVisionRadiusSquares } : {}),
      ...(resolvedIsInTurnOrder ? { isInTurnOrder: true } : {}),
      ...(resolvedIsInTurnOrder && Number.isInteger(resolvedTurnOrderInitiative)
        ? { turnOrderInitiative: resolvedTurnOrderInitiative }
        : {}),
      ...(resolvedIsInTurnOrder && resolvedTurnOrderJoinedAt
        ? { turnOrderJoinedAt: resolvedTurnOrderJoinedAt }
        : {}),
      ...(resolvedIsInTurnOrder && resolvedTurnCounter > 0 ? { turnCounter: resolvedTurnCounter } : {}),
      ...(resolvedIsInTurnOrder && resolvedTurnEffects.length ? { turnEffects: resolvedTurnEffects } : {}),
      updatedAt: serverTimestamp(),
      updatedBy: currentUserId || null,
    };
  }, [activePlacementsById, currentUserId, ownedTrayTokensById]);

  const buildTurnOrderRemovalPlacementWrite = useCallback(({
    backgroundId,
    tokenId,
    ownerUid,
    col,
    row,
    sizeSquares,
    isVisibleToPlayers,
    isDead,
    statuses,
  }) => ({
    ...buildPlacementWritePayload({
      backgroundId,
      tokenId,
      ownerUid,
      col,
      row,
      sizeSquares,
      isVisibleToPlayers,
      isDead,
      statuses,
      isInTurnOrder: false,
      turnCounter: 0,
      turnEffects: [],
    }),
    isInTurnOrder: deleteField(),
    turnOrderInitiative: deleteField(),
    turnOrderJoinedAt: deleteField(),
    turnCounter: deleteField(),
    turnEffects: deleteField(),
  }), [buildPlacementWritePayload]);

  const getActiveMapPlacementContexts = useCallback((tokenIds) => {
    if (!activeBackgroundId) {
      return [];
    }

    return [...new Set((tokenIds || []).filter(Boolean))]
      .map((tokenId) => {
        const placementId = buildPlacementDocId(activeBackgroundId, tokenId);
        const placement = activePlacementsById.get(placementId);
        if (!placement) {
          return null;
        }

        return {
          tokenId,
          ownerUid: placement.ownerUid,
          placementId,
          col: Number.isFinite(placement?.col) ? placement.col : 0,
          row: Number.isFinite(placement?.row) ? placement.row : 0,
          sizeSquares: normalizeTokenSizeSquares(placement?.sizeSquares),
          isVisibleToPlayers: placement?.isVisibleToPlayers !== false,
          isDead: placement?.isDead === true,
          statuses: normalizeStatuses(placement?.statuses) || [],
          visionEnabled: normalizeOptionalVisionEnabled(placement?.visionEnabled),
          visionRadiusSquares: normalizeOptionalVisionRadiusSquares(placement?.visionRadiusSquares),
          isInTurnOrder: placement?.isInTurnOrder === true,
          turnOrderInitiative: Number.isInteger(placement?.turnOrderInitiative)
            ? placement.turnOrderInitiative
            : null,
          turnOrderJoinedAt: placement?.turnOrderJoinedAt || null,
          turnCounter: normalizeTurnCounter(placement?.turnCounter, 0),
          turnEffects: normalizeTurnEffects(placement?.turnEffects),
        };
      })
      .filter(Boolean);
  }, [activeBackgroundId, activePlacementsById]);

  const canCurrentUserManageTurnOrderPlacement = useCallback((placementContext) => {
    if (!placementContext || !currentUserId) {
      return false;
    }

    return isManager
      || placementContext.ownerUid === currentUserId
      || placementContext.tokenId === currentUserId;
  }, [currentUserId, isManager]);

  const upsertTokenPlacement = useCallback(async ({
    backgroundId,
    tokenId,
    ownerUid,
    col,
    row,
    sizeSquares,
    isVisibleToPlayers,
    isDead,
    statuses,
  }) => {
    const resolvedTokenId = typeof tokenId === 'string' && tokenId ? tokenId : ownerUid;
    const placementId = buildPlacementDocId(backgroundId, resolvedTokenId);
    const placementPayload = buildPlacementWritePayload({
      backgroundId,
      tokenId: resolvedTokenId,
      ownerUid,
      col,
      row,
      sizeSquares,
      isVisibleToPlayers,
      isDead,
      statuses,
    });
    const isHidden = placementPayload.isVisibleToPlayers === false;
    const batch = writeBatch(db);

    batch.set(doc(db, 'grigliata_token_placements', placementId), placementPayload, { merge: true });
    batch.set(
      doc(db, 'users', ownerUid),
      buildHiddenPlacementSettingsPayload({
        backgroundId,
        tokenId: resolvedTokenId,
        isHidden,
        includeLegacyBackgroundFallback: isLegacyHiddenPlacementToken({
          tokenId: resolvedTokenId,
          ownerUid,
        }),
      }),
      { merge: true }
    );

    await batch.commit();
  }, [
    buildHiddenPlacementSettingsPayload,
    buildPlacementWritePayload,
    isLegacyHiddenPlacementToken,
  ]);

  const commitPlacementMoves = useCallback(async (moves) => {
    const normalizedMoves = [...new Map(
      (moves || [])
        .map((move) => {
          const resolvedTokenId = move?.tokenId || move?.ownerUid || '';
          if (!move?.backgroundId || !move?.ownerUid || !resolvedTokenId) {
            return null;
          }

          return [
            buildPlacementDocId(move.backgroundId, resolvedTokenId),
            {
              ...move,
              tokenId: resolvedTokenId,
            },
          ];
        })
        .filter(Boolean)
    ).values()];

    for (let index = 0; index < normalizedMoves.length; index += placementAndUserSettingsBatchSize) {
      const batch = writeBatch(db);
      normalizedMoves.slice(index, index + placementAndUserSettingsBatchSize).forEach((move) => {
        const placementPayload = buildPlacementWritePayload(move);
        const isHidden = placementPayload.isVisibleToPlayers === false;
        batch.set(
          doc(db, 'grigliata_token_placements', buildPlacementDocId(move.backgroundId, move.tokenId)),
          placementPayload,
          { merge: true }
        );
        batch.set(
          doc(db, 'users', move.ownerUid),
          buildHiddenPlacementSettingsPayload({
            backgroundId: move.backgroundId,
            tokenId: move.tokenId,
            isHidden,
            includeLegacyBackgroundFallback: isLegacyHiddenPlacementToken({
              tokenId: move.tokenId,
              ownerUid: move.ownerUid,
            }),
          }),
          { merge: true }
        );
      });
      await batch.commit();
    }
  }, [
    buildHiddenPlacementSettingsPayload,
    buildPlacementWritePayload,
    isLegacyHiddenPlacementToken,
    placementAndUserSettingsBatchSize,
  ]);

  const deleteActiveMapPlacements = useCallback(async (tokenIds) => {
    const targetPlacements = getActiveMapPlacementContexts(tokenIds);
    if (!targetPlacements.length) return;

    for (let index = 0; index < targetPlacements.length; index += placementDeleteBatchSize) {
      const placementChunk = targetPlacements.slice(index, index + placementDeleteBatchSize);
      const tokenProfileEntries = await Promise.all(
        placementChunk
          .filter(({ tokenId, ownerUid }) => tokenId && tokenId !== ownerUid)
          .map(async ({ tokenId }) => {
            const tokenSnapshot = await getDoc(doc(db, 'grigliata_tokens', tokenId));
            return [tokenId, tokenSnapshot.exists() ? tokenSnapshot.data() : null];
          })
      );
      const deleteTargetTokenProfiles = new Map(tokenProfileEntries);
      const customInstanceTokenIds = [...new Set(
        placementChunk
          .filter(({ tokenId }) => isCustomTokenInstance(deleteTargetTokenProfiles.get(tokenId) || null))
          .map(({ tokenId }) => tokenId)
      )];

      for (const customInstanceTokenId of customInstanceTokenIds) {
        await deleteCustomToken?.({ tokenId: customInstanceTokenId });
      }

      const customInstanceTokenIdSet = new Set(customInstanceTokenIds);
      const directDeletePlacements = placementChunk.filter(
        ({ tokenId }) => !customInstanceTokenIdSet.has(tokenId)
      );

      if (!directDeletePlacements.length) {
        continue;
      }

      const batch = writeBatch(db);
      directDeletePlacements.forEach(({ ownerUid, placementId, tokenId }) => {
        const tokenProfile = deleteTargetTokenProfiles.get(tokenId) || null;
        batch.delete(doc(db, 'grigliata_token_placements', placementId));
        if (tokenProfile?.tokenType === 'foe') {
          batch.delete(doc(db, 'grigliata_tokens', tokenId));
        }
        batch.set(
          doc(db, 'users', ownerUid),
          buildHiddenPlacementSettingsPayload({
            backgroundId: activeBackgroundId,
            tokenId,
            isHidden: false,
            includeLegacyBackgroundFallback: isLegacyHiddenPlacementToken({ tokenId, ownerUid }),
          }),
          { merge: true }
        );
      });
      await batch.commit();
    }
  }, [
    activeBackgroundId,
    buildHiddenPlacementSettingsPayload,
    deleteCustomToken,
    getActiveMapPlacementContexts,
    isCustomTokenInstance,
    isLegacyHiddenPlacementToken,
    placementDeleteBatchSize,
  ]);

  const setSelectedTokensVisibility = useCallback(async (tokenIds, nextIsVisibleToPlayers) => {
    if (
      !isManager
      || !currentUserId
      || !activeBackgroundId
      || typeof nextIsVisibleToPlayers !== 'boolean'
    ) {
      return;
    }

    const targetPlacements = getActiveMapPlacementContexts(tokenIds);
    if (!targetPlacements.length) {
      return;
    }

    for (let index = 0; index < targetPlacements.length; index += placementAndUserSettingsBatchSize) {
      const batch = writeBatch(db);

      targetPlacements.slice(index, index + placementAndUserSettingsBatchSize).forEach((placement) => {
        batch.set(
          doc(db, 'grigliata_token_placements', placement.placementId),
          buildPlacementWritePayload({
            backgroundId: activeBackgroundId,
            tokenId: placement.tokenId,
            ownerUid: placement.ownerUid,
            col: placement.col,
            row: placement.row,
            sizeSquares: placement.sizeSquares,
            isVisibleToPlayers: nextIsVisibleToPlayers,
          }),
          { merge: true }
        );
        batch.set(
          doc(db, 'users', placement.ownerUid),
          buildHiddenPlacementSettingsPayload({
            backgroundId: activeBackgroundId,
            tokenId: placement.tokenId,
            isHidden: nextIsVisibleToPlayers === false,
            includeLegacyBackgroundFallback: isLegacyHiddenPlacementToken(placement),
          }),
          { merge: true }
        );
      });

      await batch.commit();
    }
  }, [
    activeBackgroundId,
    buildHiddenPlacementSettingsPayload,
    buildPlacementWritePayload,
    currentUserId,
    getActiveMapPlacementContexts,
    isLegacyHiddenPlacementToken,
    isManager,
    placementAndUserSettingsBatchSize,
  ]);

  const setSelectedTokensDeadState = useCallback(async (tokenIds, nextIsDead) => {
    if (
      !isManager
      || !currentUserId
      || !activeBackgroundId
      || typeof nextIsDead !== 'boolean'
    ) {
      return;
    }

    const targetPlacements = getActiveMapPlacementContexts(tokenIds);
    if (!targetPlacements.length) {
      return;
    }

    for (let index = 0; index < targetPlacements.length; index += placementRuleSafeBatchSize) {
      const batch = writeBatch(db);

      targetPlacements.slice(index, index + placementRuleSafeBatchSize).forEach((placement) => {
        batch.set(
          doc(db, 'grigliata_token_placements', placement.placementId),
          buildPlacementWritePayload({
            backgroundId: activeBackgroundId,
            tokenId: placement.tokenId,
            ownerUid: placement.ownerUid,
            col: placement.col,
            row: placement.row,
            sizeSquares: placement.sizeSquares,
            isDead: nextIsDead,
          }),
          { merge: true }
        );
      });

      await batch.commit();
    }
  }, [
    activeBackgroundId,
    buildPlacementWritePayload,
    currentUserId,
    getActiveMapPlacementContexts,
    isManager,
    placementRuleSafeBatchSize,
  ]);

  const updateTokenStatuses = useCallback(async (tokenId, nextStatuses) => {
    if (!currentUserId || !activeBackgroundId || !tokenId || !Array.isArray(nextStatuses)) {
      return;
    }

    const targetPlacement = getActiveMapPlacementContexts([tokenId])[0];
    if (!targetPlacement) {
      return;
    }

    await setDoc(
      doc(db, 'grigliata_token_placements', targetPlacement.placementId),
      buildPlacementWritePayload({
        backgroundId: activeBackgroundId,
        tokenId,
        ownerUid: targetPlacement.ownerUid,
        col: targetPlacement.col,
        row: targetPlacement.row,
        sizeSquares: targetPlacement.sizeSquares,
        statuses: nextStatuses,
      }),
      { merge: true }
    );
  }, [
    activeBackgroundId,
    buildPlacementWritePayload,
    currentUserId,
    getActiveMapPlacementContexts,
  ]);

  const setSelectedTokenSize = useCallback(async (tokenId, sizeSquares) => {
    if (!currentUserId || !activeBackgroundId || !tokenId) {
      return false;
    }

    const targetPlacement = getActiveMapPlacementContexts([tokenId])[0];
    if (!targetPlacement) {
      return false;
    }

    if (
      !isManager
      && targetPlacement.ownerUid !== currentUserId
      && targetPlacement.tokenId !== currentUserId
    ) {
      return false;
    }

    await setDoc(
      doc(db, 'grigliata_token_placements', targetPlacement.placementId),
      buildPlacementWritePayload({
        backgroundId: activeBackgroundId,
        tokenId,
        ownerUid: targetPlacement.ownerUid,
        col: targetPlacement.col,
        row: targetPlacement.row,
        sizeSquares,
      }),
      { merge: true }
    );

    return true;
  }, [
    activeBackgroundId,
    buildPlacementWritePayload,
    currentUserId,
    getActiveMapPlacementContexts,
    isManager,
  ]);

  const setSelectedTokenVision = useCallback(async (tokenId, visionSettings) => {
    if (
      !isManager
      || !currentUserId
      || !activeBackgroundId
      || !tokenId
      || typeof visionSettings?.visionEnabled !== 'boolean'
    ) {
      return false;
    }

    const targetPlacement = getActiveMapPlacementContexts([tokenId])[0];
    if (!targetPlacement) {
      return false;
    }

    await setDoc(
      doc(db, 'grigliata_token_placements', targetPlacement.placementId),
      buildPlacementWritePayload({
        backgroundId: activeBackgroundId,
        tokenId,
        ownerUid: targetPlacement.ownerUid,
        col: targetPlacement.col,
        row: targetPlacement.row,
        sizeSquares: targetPlacement.sizeSquares,
        visionEnabled: visionSettings.visionEnabled,
        visionRadiusSquares: visionSettings.visionRadiusSquares,
      }),
      { merge: true }
    );

    return true;
  }, [
    activeBackgroundId,
    buildPlacementWritePayload,
    currentUserId,
    getActiveMapPlacementContexts,
    isManager,
  ]);

  return {
    buildPlacementWritePayload,
    buildTurnOrderRemovalPlacementWrite,
    getActiveMapPlacementContexts,
    canCurrentUserManageTurnOrderPlacement,
    upsertTokenPlacement,
    commitPlacementMoves,
    deleteActiveMapPlacements,
    setSelectedTokensVisibility,
    setSelectedTokensDeadState,
    updateTokenStatuses,
    setSelectedTokenSize,
    setSelectedTokenVision,
  };
}
