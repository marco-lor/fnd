export const GRIGLIATA_WALL_STATE_COLLECTION = 'grigliata_wall_state';

const VALID_SEGMENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const INTERACTIVE_WALL_TYPES = new Set(['door', 'window']);

const isPlainObject = (value) => (
  !!value
  && typeof value === 'object'
  && !Array.isArray(value)
);

const normalizeBoolean = (value, fallback = false) => (
  typeof value === 'boolean' ? value : fallback
);

export const classifyImportedWallSegment = (wall = {}) => {
  if (wall?.wallType === 'door' || wall?.type === 'door') {
    return 'door';
  }

  if (wall?.wallType === 'window' || wall?.type === 'window' || wall?.isWindow === true) {
    return 'window';
  }

  if (Number(wall?.doorType) === 1 || Number(wall?.door) === 1) {
    return 'door';
  }

  return 'wall';
};

export const normalizeGrigliataWallRuntimeState = (data) => {
  if (!isPlainObject(data)) {
    return null;
  }

  const backgroundId = typeof data.backgroundId === 'string' ? data.backgroundId.trim() : '';
  if (!backgroundId) {
    return null;
  }

  const rawSegments = isPlainObject(data.segments) ? data.segments : {};
  const segments = {};

  for (const [segmentId, segmentState] of Object.entries(rawSegments)) {
    if (!VALID_SEGMENT_ID_PATTERN.test(segmentId)) {
      continue;
    }

    if (!isPlainObject(segmentState) || typeof segmentState.isOpen !== 'boolean') {
      return null;
    }

    segments[segmentId] = {
      isOpen: segmentState.isOpen,
      updatedAt: segmentState.updatedAt || null,
      updatedBy: typeof segmentState.updatedBy === 'string' ? segmentState.updatedBy : '',
    };
  }

  return {
    backgroundId,
    segments,
    updatedAt: data.updatedAt || null,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
  };
};

export const isInteractiveWallSegment = (wall) => (
  INTERACTIVE_WALL_TYPES.has(classifyImportedWallSegment(wall))
);

export const buildEffectiveLightingRenderInput = ({
  lightingRenderInput = null,
  wallRuntimeState = null,
} = {}) => {
  if (!lightingRenderInput) {
    return null;
  }

  const runtimeState = normalizeGrigliataWallRuntimeState(wallRuntimeState);
  const shouldUseRuntimeState = runtimeState?.backgroundId === lightingRenderInput.backgroundId;
  const runtimeSegments = shouldUseRuntimeState ? runtimeState.segments : {};

  return {
    ...lightingRenderInput,
    walls: (Array.isArray(lightingRenderInput.walls) ? lightingRenderInput.walls : []).map((wall) => {
      const wallType = classifyImportedWallSegment(wall);
      const runtimeSegment = runtimeSegments[wall.id];
      const isOpen = INTERACTIVE_WALL_TYPES.has(wallType) && runtimeSegment?.isOpen === true;
      const baseBlocksVision = normalizeBoolean(wall.blocksVision, wall.blocksSight === true);
      const baseBlocksLight = normalizeBoolean(wall.blocksLight, wall.blocksSight === true);
      const blocksVision = isOpen ? false : baseBlocksVision;
      const blocksLight = isOpen ? false : baseBlocksLight;

      return {
        ...wall,
        wallType,
        ...(INTERACTIVE_WALL_TYPES.has(wallType) ? { isOpen } : {}),
        blocksVision,
        blocksLight,
        blocksSight: blocksVision || blocksLight,
      };
    }),
  };
};
