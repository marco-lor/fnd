import { useEffect, useMemo, useRef, useState } from 'react';
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
  buildCurrentFogMemoryPolygons,
  buildCurrentFogRenderPolygons,
  buildGrigliataFogOfWarDocId,
  GRIGLIATA_FOG_OF_WAR_COLLECTION,
  GRIGLIATA_FOG_OF_WAR_SCHEMA_VERSION,
  mergeFogCellKeys,
} from './fogOfWar';
import {
  applyFogMemoryPolygonReveal,
  encodeFogMemoryPolygonsForFirestore,
} from './fogPolygonGeometry';

export const GRIGLIATA_FOG_OF_WAR_WRITE_DEBOUNCE_MS = 350;
export const DEFAULT_FOG_VISION_RAY_COUNT = 256;

const buildRenderableTokensForFog = ({ tokens = [], grid }) => (
  (Array.isArray(tokens) ? tokens : []).map((token) => ({
    ...token,
    renderPosition: token?.renderPosition || getTokenPositionPx(token, grid),
  }))
);

export const buildViewerFogCurrentVisibleCells = ({
  ...args
} = {}) => buildViewerFogCurrentVisibility(args).currentVisibleCells;

export const buildViewerFogCurrentVisibility = ({
  tokens = [],
  currentUserId = '',
  isManager = false,
  grid,
  lightingRenderInput = null,
  rayCount,
} = {}) => {
  if (!lightingRenderInput || isManager) {
    return {
      currentVisibleCells: [],
      currentVisiblePolygons: [],
      currentPersistencePolygons: [],
    };
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
    return {
      currentVisibleCells: [],
      currentVisiblePolygons: [],
      currentPersistencePolygons: [],
    };
  }

  const wallSegments = normalizeLightingWallSegments(lightingRenderInput.walls);
  const fogRayCount = Number.isFinite(Number(rayCount))
    ? rayCount
    : DEFAULT_FOG_VISION_RAY_COUNT;
  const tokenVisionPolygons = buildTokenVisionPolygons({
    tokens: visionSources,
    visionRadiusPx: normalizedGrid.cellSizePx * DEFAULT_TOKEN_VISION_RADIUS_SQUARES,
    segments: wallSegments,
    rayCount: fogRayCount,
  });

  return {
    currentVisibleCells: buildCurrentFogCellKeys({
      tokenVisionPolygons,
      grid: normalizedGrid,
    }),
    currentVisiblePolygons: buildCurrentFogRenderPolygons({
      tokenVisionPolygons,
    }),
    currentPersistencePolygons: buildCurrentFogMemoryPolygons({
      tokenVisionPolygons,
    }),
  };
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
  const disabledPrecisionFogDocIdsRef = useRef(new Set());
  const [disabledPrecisionFogDocIds, setDisabledPrecisionFogDocIds] = useState(() => new Set());
  const fogDocId = useMemo(
    () => buildGrigliataFogOfWarDocId(backgroundId, currentUserId),
    [backgroundId, currentUserId]
  );
  const isPrecisionFogFallbackActive = !!fogDocId && disabledPrecisionFogDocIds.has(fogDocId);
  const currentVisibility = useMemo(
    () => (isEnabled
      ? buildViewerFogCurrentVisibility({
        tokens,
        currentUserId,
        isManager,
        grid: normalizedGrid,
        lightingRenderInput,
        rayCount,
      })
      : { currentVisibleCells: [], currentVisiblePolygons: [], currentPersistencePolygons: [] }),
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
  const currentVisibleCells = currentVisibility.currentVisibleCells;
  const currentVisiblePolygons = currentVisibility.currentVisiblePolygons;
  const currentPersistencePolygons = currentVisibility.currentPersistencePolygons;

  useEffect(() => {
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
    const isPrecisionPersistenceDisabled = disabledPrecisionFogDocIdsRef.current.has(fogDocId);
    const existingCellSet = new Set(hasMatchingCellSize ? fogOfWar.exploredCells || [] : []);
    const newVisibleCells = currentVisibleCells.filter((cellKey) => !existingCellSet.has(cellKey));
    const precisionFallbackCells = mergeFogCellKeys(
      hasMatchingCellSize ? fogOfWar.exploredCells || [] : [],
      currentVisibleCells
    );
    const existingPolygons = hasMatchingCellSize ? fogOfWar?.exploredPolygons || [] : [];
    const nextExploredPolygons = currentPersistencePolygons.length > 0
      ? applyFogMemoryPolygonReveal({
        existingPolygons,
        revealPolygons: currentPersistencePolygons,
      })
      : existingPolygons;
    const normalizedNextExploredPolygons = Array.isArray(nextExploredPolygons)
      ? nextExploredPolygons
      : [];
    const firestoreExploredPolygons = encodeFogMemoryPolygonsForFirestore(
      normalizedNextExploredPolygons
    );
    const hasPolygonChange = (
      JSON.stringify(existingPolygons) !== JSON.stringify(normalizedNextExploredPolygons)
    );

    const shouldPersistPolygons = !isPrecisionPersistenceDisabled
      && firestoreExploredPolygons.length > 0
      && hasPolygonChange;

    if (newVisibleCells.length < 1 && !shouldPersistPolygons) {
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
      const writePrecisionPolygons = (afterWritePromise = Promise.resolve()) => {
        if (!shouldPersistPolygons) {
          return;
        }

        const precisionPayload = {
          ...basePayload,
          exploredCells: precisionFallbackCells,
          exploredPolygons: firestoreExploredPolygons,
        };

        void afterWritePromise
          .then(() => setDoc(fogDocRef, precisionPayload, { merge: true }).catch((error) => {
            if (error?.code === 'permission-denied') {
              disabledPrecisionFogDocIdsRef.current.add(fogDocId);
              setDisabledPrecisionFogDocIds((currentDocIds) => {
                if (currentDocIds.has(fogDocId)) {
                  return currentDocIds;
                }
                const nextDocIds = new Set(currentDocIds);
                nextDocIds.add(fogDocId);
                return nextDocIds;
              });
              console.warn(
                'Precision Grigliata fog persistence was denied; continuing with cell fog fallback.',
                error
              );
              return;
            }
            console.error('Failed to persist Grigliata precision fog of war:', error);
          }))
          .catch(() => {});
      };

      if (hasMatchingCellSize) {
        if (newVisibleCells.length < 1) {
          writePrecisionPolygons();
          return;
        }

        const cellMergePayload = {
          ...basePayload,
          exploredCells: arrayUnion(...newVisibleCells),
        };

        const cellWritePromise = setDoc(fogDocRef, {
          ...cellMergePayload,
        }, { merge: true }).catch((error) => {
          console.error('Failed to persist Grigliata fog of war:', error);
          throw error;
        });
        writePrecisionPolygons(cellWritePromise);
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
      writePrecisionPolygons(writePromise);
    }, GRIGLIATA_FOG_OF_WAR_WRITE_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [
    backgroundId,
    currentUserId,
    currentVisibleCells,
    currentPersistencePolygons,
    fogDocId,
    fogOfWar,
    isEnabled,
    isManager,
    lightingRenderInput,
    normalizedGrid.cellSizePx,
  ]);

  return {
    currentVisibleCells,
    currentVisiblePolygons,
    isPrecisionFogFallbackActive,
  };
}
