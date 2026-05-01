import { useEffect, useMemo } from 'react';
import {
  arrayUnion,
  doc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import {
  getTokenPositionPx,
  normalizeGridConfig,
} from './boardUtils';
import {
  buildTokenVisionPolygons,
  normalizeLightingWallSegments,
} from './lightingGeometry';
import {
  DEFAULT_TOKEN_VISION_RADIUS_SQUARES,
  resolveViewerTokenVisionSources,
} from './lightingVisibility';
import {
  buildCurrentFogCellKeys,
  buildGrigliataFogOfWarDocId,
  GRIGLIATA_FOG_OF_WAR_COLLECTION,
  GRIGLIATA_FOG_OF_WAR_SCHEMA_VERSION,
  mergeFogCellKeys,
} from './fogOfWar';

export const GRIGLIATA_FOG_OF_WAR_WRITE_DEBOUNCE_MS = 350;

const buildRenderableTokensForFog = ({ tokens = [], grid }) => (
  (Array.isArray(tokens) ? tokens : []).map((token) => ({
    ...token,
    renderPosition: token?.renderPosition || getTokenPositionPx(token, grid),
  }))
);

export const buildViewerFogCurrentVisibleCells = ({
  tokens = [],
  currentUserId = '',
  isManager = false,
  grid,
  lightingRenderInput = null,
  rayCount,
} = {}) => {
  if (!lightingRenderInput || isManager) {
    return [];
  }

  const normalizedGrid = normalizeGridConfig(grid);
  const renderableTokens = buildRenderableTokensForFog({
    tokens,
    grid: normalizedGrid,
  });
  const visionSources = resolveViewerTokenVisionSources({
    tokens: renderableTokens,
    currentUserId,
    isManager,
    cellSizePx: normalizedGrid.cellSizePx,
  });

  if (!visionSources.length) {
    return [];
  }

  const wallSegments = normalizeLightingWallSegments(lightingRenderInput.walls);
  const tokenVisionPolygons = buildTokenVisionPolygons({
    tokens: visionSources,
    visionRadiusPx: normalizedGrid.cellSizePx * DEFAULT_TOKEN_VISION_RADIUS_SQUARES,
    segments: wallSegments,
    rayCount,
  });

  return buildCurrentFogCellKeys({
    tokenVisionPolygons,
    grid: normalizedGrid,
  });
};

export default function useGrigliataFogOfWarPersistence({
  backgroundId = '',
  currentUserId = '',
  isManager = false,
  grid,
  tokens = [],
  lightingRenderInput = null,
  fogOfWar = null,
  isEnabled = true,
  rayCount,
}) {
  const normalizedGrid = useMemo(() => normalizeGridConfig(grid), [grid]);
  const currentVisibleCells = useMemo(
    () => (isEnabled
      ? buildViewerFogCurrentVisibleCells({
        tokens,
        currentUserId,
        isManager,
        grid: normalizedGrid,
        lightingRenderInput,
        rayCount,
      })
      : []),
    [
      currentUserId,
      isEnabled,
      isManager,
      lightingRenderInput,
      normalizedGrid,
      rayCount,
      tokens,
    ]
  );

  useEffect(() => {
    const fogDocId = buildGrigliataFogOfWarDocId(backgroundId, currentUserId);
    if (
      !isEnabled
      || isManager
      || !fogDocId
      || !lightingRenderInput
      || currentVisibleCells.length < 1
    ) {
      return undefined;
    }

    const hasMatchingCellSize = fogOfWar?.cellSizePx === normalizedGrid.cellSizePx;
    const existingCellSet = new Set(hasMatchingCellSize ? fogOfWar.exploredCells || [] : []);
    const newVisibleCells = currentVisibleCells.filter((cellKey) => !existingCellSet.has(cellKey));

    if (newVisibleCells.length < 1) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      const basePayload = {
        schemaVersion: GRIGLIATA_FOG_OF_WAR_SCHEMA_VERSION,
        backgroundId,
        ownerUid: currentUserId,
        cellSizePx: normalizedGrid.cellSizePx,
        updatedAt: serverTimestamp(),
        updatedBy: currentUserId,
      };
      const fogDocRef = doc(db, GRIGLIATA_FOG_OF_WAR_COLLECTION, fogDocId);

      if (hasMatchingCellSize) {
        void setDoc(fogDocRef, {
          ...basePayload,
          exploredCells: arrayUnion(...newVisibleCells),
        }, { merge: true }).catch((error) => {
          console.error('Failed to persist Grigliata fog of war:', error);
        });
        return;
      }

      const replacementPayload = {
        ...basePayload,
        exploredCells: mergeFogCellKeys(currentVisibleCells),
      };
      const writePromise = fogOfWar
        ? setDoc(fogDocRef, replacementPayload)
        : setDoc(fogDocRef, replacementPayload, { merge: true });

      void writePromise.catch((error) => {
        console.error('Failed to persist Grigliata fog of war:', error);
      });
    }, GRIGLIATA_FOG_OF_WAR_WRITE_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [
    backgroundId,
    currentUserId,
    currentVisibleCells,
    fogOfWar,
    isEnabled,
    isManager,
    lightingRenderInput,
    normalizedGrid.cellSizePx,
  ]);

  return {
    currentVisibleCells,
  };
}
