import { buildGridMeasurementPath } from './boardUtils';
import { resolveGrigliataDrawColorKey } from './constants';

export const GRIGLIATA_LIVE_INTERACTION_COLLECTION = 'grigliata_live_interactions';
export const GRIGLIATA_LIVE_INTERACTION_THROTTLE_MS = 100;
export const GRIGLIATA_LIVE_INTERACTION_STALE_MS = 2 * 60 * 1000;
export const MAX_GRIGLIATA_LIVE_INTERACTION_ANCHOR_CELLS = 16;
export const GRIGLIATA_LIVE_INTERACTION_TYPES = ['measure'];
export const GRIGLIATA_LIVE_INTERACTION_SOURCES = ['free', 'token-drag'];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const normalizeGridCell = (cell) => {
  if (!Number.isInteger(cell?.col) || !Number.isInteger(cell?.row)) {
    return null;
  }

  return {
    col: cell.col,
    row: cell.row,
  };
};

const normalizeTimestampMillis = (timestamp) => {
  if (!timestamp) return 0;

  if (typeof timestamp?.toMillis === 'function') {
    return timestamp.toMillis();
  }

  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }

  if (Number.isFinite(timestamp)) {
    return timestamp;
  }

  if (Number.isFinite(timestamp?.seconds)) {
    const nanoseconds = Number.isFinite(timestamp?.nanoseconds) ? timestamp.nanoseconds : 0;
    return (timestamp.seconds * 1000) + Math.floor(nanoseconds / 1e6);
  }

  return 0;
};

export const buildGrigliataLiveInteractionDocId = (backgroundId, ownerUid) => (
  isNonEmptyString(backgroundId) && isNonEmptyString(ownerUid)
    ? `${backgroundId.trim()}__${ownerUid.trim()}`
    : ''
);

export const normalizeGrigliataLiveInteractionDraft = (draft) => {
  if (!draft || !GRIGLIATA_LIVE_INTERACTION_TYPES.includes(draft.type)) {
    return null;
  }

  if (!GRIGLIATA_LIVE_INTERACTION_SOURCES.includes(draft.source)) {
    return null;
  }

  const anchorCells = Array.isArray(draft.anchorCells)
    ? draft.anchorCells.map(normalizeGridCell).filter(Boolean)
    : [];
  const liveEndCell = normalizeGridCell(draft.liveEndCell);

  if (!anchorCells.length || !liveEndCell || anchorCells.length > MAX_GRIGLIATA_LIVE_INTERACTION_ANCHOR_CELLS) {
    return null;
  }

  return {
    type: draft.type,
    source: draft.source,
    anchorCells,
    liveEndCell,
  };
};

export const normalizeGrigliataLiveInteraction = (interaction) => {
  const draft = normalizeGrigliataLiveInteractionDraft(interaction);
  if (!draft) {
    return null;
  }

  if (!isNonEmptyString(interaction?.backgroundId) || !isNonEmptyString(interaction?.ownerUid)) {
    return null;
  }

  return {
    backgroundId: interaction.backgroundId.trim(),
    ownerUid: interaction.ownerUid.trim(),
    type: draft.type,
    source: draft.source,
    colorKey: resolveGrigliataDrawColorKey(interaction?.colorKey),
    anchorCells: draft.anchorCells,
    liveEndCell: draft.liveEndCell,
    updatedAt: interaction?.updatedAt || null,
    updatedBy: isNonEmptyString(interaction?.updatedBy) ? interaction.updatedBy.trim() : '',
  };
};

export const buildGrigliataLiveInteractionDoc = ({
  backgroundId,
  ownerUid,
  colorKey,
  draft,
  updatedBy,
  updatedAt,
}) => {
  const normalizedDraft = normalizeGrigliataLiveInteractionDraft(draft);
  if (!normalizedDraft || !isNonEmptyString(backgroundId) || !isNonEmptyString(ownerUid)) {
    return null;
  }

  return {
    backgroundId: backgroundId.trim(),
    ownerUid: ownerUid.trim(),
    type: normalizedDraft.type,
    source: normalizedDraft.source,
    colorKey: resolveGrigliataDrawColorKey(colorKey),
    anchorCells: normalizedDraft.anchorCells,
    liveEndCell: normalizedDraft.liveEndCell,
    updatedAt: updatedAt || null,
    updatedBy: isNonEmptyString(updatedBy) ? updatedBy.trim() : '',
  };
};

export const isGrigliataLiveInteractionStale = (
  interaction,
  now = Date.now(),
  staleMs = GRIGLIATA_LIVE_INTERACTION_STALE_MS
) => {
  const updatedAtMillis = normalizeTimestampMillis(interaction?.updatedAt);
  if (!updatedAtMillis) {
    return true;
  }

  return (now - updatedAtMillis) > staleMs;
};

export const filterActiveGrigliataLiveInteractions = (
  interactions,
  now = Date.now(),
  staleMs = GRIGLIATA_LIVE_INTERACTION_STALE_MS
) => (
  (interactions || [])
    .map((interaction) => normalizeGrigliataLiveInteraction(interaction))
    .filter(Boolean)
    .filter((interaction) => !isGrigliataLiveInteractionStale(interaction, now, staleMs))
);

export const buildMeasurementFromGrigliataLiveInteraction = ({ interaction, grid }) => {
  const normalizedInteraction = normalizeGrigliataLiveInteraction(interaction);
  if (!normalizedInteraction || normalizedInteraction.type !== 'measure') {
    return null;
  }

  return buildGridMeasurementPath({
    anchorCells: normalizedInteraction.anchorCells,
    liveEndCell: normalizedInteraction.liveEndCell,
    grid,
  });
};
