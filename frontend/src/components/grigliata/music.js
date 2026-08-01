import { timestampToMillis } from './boardUtils';
import { withObjectUrl } from '../common/useObjectUrl';
import { normalizePrivateAudioDescriptor } from '../common/privateMediaAssets';

export const GRIGLIATA_MUSIC_TRACK_COLLECTION = 'grigliata_music_tracks';
export const GRIGLIATA_MUSIC_PLAYBACK_COLLECTION = 'grigliata_music_playback';
export const GRIGLIATA_MUSIC_PLAYBACK_DOC_ID = 'current';
export const GRIGLIATA_MUSIC_PLAYBACK_SESSION_COLLECTION = 'grigliata_music_playback_sessions';
export const GRIGLIATA_MUSIC_PLAYBACK_STATUSES = {
  PLAYING: 'playing',
  PAUSED: 'paused',
  STOPPED: 'stopped',
};
export const GRIGLIATA_MUSIC_MUTED_FIELD = 'grigliata_music_muted';
export const MAX_GRIGLIATA_MUSIC_FILE_BYTES = 25 * 1024 * 1024;
export const MIN_GRIGLIATA_MUSIC_VOLUME = 0;
export const MAX_GRIGLIATA_MUSIC_VOLUME = 1;
export const DEFAULT_GRIGLIATA_MUSIC_VOLUME = 0.65;
export const GRIGLIATA_MUSIC_VOLUME_STEP = 0.01;

const PLAYBACK_STATUS_SET = new Set(Object.values(GRIGLIATA_MUSIC_PLAYBACK_STATUSES));

const asFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const CANONICAL_MUSIC_ASSET_ID = /^m_[a-f0-9]{40}$/;

const normalizeMusicAssetId = (value) => {
  const result = isNonEmptyString(value) ? value.trim() : '';
  return CANONICAL_MUSIC_ASSET_ID.test(result) ? result : '';
};

export const normalizeGrigliataMusicMedia = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const assetId = normalizeMusicAssetId(value.assetId);
  const ownerUid = isNonEmptyString(value.ownerUid) ? value.ownerUid.trim() : '';
  const generation = String(value.generation || '').trim();
  const original = normalizePrivateAudioDescriptor(value.original);
  const pathParts = original?.path?.split('/') || [];
  if (
    value.schemaVersion !== 1
    || value.contractVersion !== 1
    || value.kind !== 'music'
    || value.state !== 'ready'
    || value.audience !== 'signed-in'
    || !assetId
    || !ownerUid
    || !/^[1-9][0-9]*$/.test(generation)
    || !original
    || pathParts.length !== 7
    || pathParts[2] !== 'signed-in'
    || pathParts[3] !== ownerUid
    || pathParts[4] !== assetId
    || pathParts[5] !== generation
    || pathParts[6] !== 'original'
  ) return null;
  return {
    schemaVersion: 1,
    contractVersion: 1,
    assetId,
    kind: 'music',
    state: 'ready',
    generation,
    audience: 'signed-in',
    ownerUid,
    original,
  };
};

const resolvePlaybackStatus = (status) => (
  PLAYBACK_STATUS_SET.has(status)
    ? status
    : GRIGLIATA_MUSIC_PLAYBACK_STATUSES.STOPPED
);

const resolveTrackId = (track) => {
  if (isNonEmptyString(track?.id)) return track.id.trim();
  if (isNonEmptyString(track?.trackId)) return track.trackId.trim();
  return '';
};

export const normalizeGrigliataMusicVolume = (
  volume,
  fallback = DEFAULT_GRIGLIATA_MUSIC_VOLUME,
) => clamp(
  asFiniteNumber(volume, fallback),
  MIN_GRIGLIATA_MUSIC_VOLUME,
  MAX_GRIGLIATA_MUSIC_VOLUME,
);

export const EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE = {
  status: GRIGLIATA_MUSIC_PLAYBACK_STATUSES.STOPPED,
  trackId: '',
  trackName: '',
  audioUrl: '',
  mediaAssetId: '',
  media: null,
  durationMs: 0,
  offsetMs: 0,
  volume: DEFAULT_GRIGLIATA_MUSIC_VOLUME,
  startedAt: null,
  commandId: '',
  updatedAt: null,
  updatedBy: '',
};

export const EMPTY_GRIGLIATA_MUSIC_PLAYBACK_SESSION = {
  id: '',
  status: GRIGLIATA_MUSIC_PLAYBACK_STATUSES.STOPPED,
  trackId: '',
  trackName: '',
  audioUrl: '',
  mediaAssetId: '',
  media: null,
  durationMs: 0,
  offsetMs: 0,
  loop: false,
  startedAt: null,
  startedAtMs: 0,
  commandId: '',
  updatedAt: null,
  updatedBy: '',
};

export const createGrigliataMusicCommandId = () => (
  `music_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
);

export const normalizeGrigliataMusicTrack = (track) => {
  const media = normalizeGrigliataMusicMedia(track?.media);
  return {
    id: resolveTrackId(track),
    name: isNonEmptyString(track?.name) ? track.name.trim() : '',
    fileName: isNonEmptyString(track?.fileName) ? track.fileName.trim() : '',
    audioUrl: isNonEmptyString(track?.audioUrl) ? track.audioUrl.trim() : '',
    audioPath: isNonEmptyString(track?.audioPath) ? track.audioPath.trim() : '',
    mediaAssetId: media?.assetId || normalizeMusicAssetId(track?.mediaAssetId),
    media,
    contentType: isNonEmptyString(track?.contentType) ? track.contentType.trim() : '',
    sizeBytes: Math.max(0, Math.round(asFiniteNumber(track?.sizeBytes, 0))),
    durationMs: Math.max(0, Math.round(asFiniteNumber(track?.durationMs, 0))),
    musicFolderId: isNonEmptyString(track?.musicFolderId) ? track.musicFolderId.trim() : '',
    musicFolderAssignedAt: track?.musicFolderAssignedAt || null,
    musicFolderAssignedBy: isNonEmptyString(track?.musicFolderAssignedBy) ? track.musicFolderAssignedBy.trim() : '',
    createdAt: track?.createdAt || null,
    createdBy: isNonEmptyString(track?.createdBy) ? track.createdBy.trim() : '',
    updatedAt: track?.updatedAt || null,
    updatedBy: isNonEmptyString(track?.updatedBy) ? track.updatedBy.trim() : '',
  };
};

export const sortGrigliataMusicTracks = (tracks) => (
  [...(tracks || [])]
    .map((track) => normalizeGrigliataMusicTrack(track))
    .sort((left, right) => {
      const rightMillis = timestampToMillis(right.updatedAt || right.createdAt);
      const leftMillis = timestampToMillis(left.updatedAt || left.createdAt);
      if (rightMillis !== leftMillis) return rightMillis - leftMillis;
      return left.name.localeCompare(right.name);
    })
);

export const normalizeGrigliataMusicPlaybackState = (state) => {
  const status = resolvePlaybackStatus(state?.status);
  const durationMs = Math.max(0, Math.round(asFiniteNumber(state?.durationMs, 0)));
  const offsetMs = Math.max(0, Math.round(asFiniteNumber(state?.offsetMs, 0)));
  const volume = normalizeGrigliataMusicVolume(state?.volume);

  return {
    ...(() => {
      const media = normalizeGrigliataMusicMedia(state?.media);
      return {media, mediaAssetId: media?.assetId || normalizeMusicAssetId(state?.mediaAssetId)};
    })(),
    status,
    trackId: isNonEmptyString(state?.trackId) ? state.trackId.trim() : '',
    trackName: isNonEmptyString(state?.trackName) ? state.trackName.trim() : '',
    audioUrl: isNonEmptyString(state?.audioUrl) ? state.audioUrl.trim() : '',
    durationMs,
    offsetMs: durationMs > 0 ? clamp(offsetMs, 0, durationMs) : offsetMs,
    volume,
    startedAt: state?.startedAt || null,
    commandId: isNonEmptyString(state?.commandId) ? state.commandId.trim() : '',
    updatedAt: state?.updatedAt || null,
    updatedBy: isNonEmptyString(state?.updatedBy) ? state.updatedBy.trim() : '',
  };
};

export const normalizeGrigliataMusicPlaybackSession = (session) => {
  const status = resolvePlaybackStatus(session?.status);
  const durationMs = Math.max(0, Math.round(asFiniteNumber(session?.durationMs, 0)));
  const offsetMs = Math.max(0, Math.round(asFiniteNumber(session?.offsetMs, 0)));
  const trackId = resolveTrackId(session);

  return {
    ...(() => {
      const media = normalizeGrigliataMusicMedia(session?.media);
      return {media, mediaAssetId: media?.assetId || normalizeMusicAssetId(session?.mediaAssetId)};
    })(),
    id: isNonEmptyString(session?.id) ? session.id.trim() : trackId,
    status,
    trackId,
    trackName: isNonEmptyString(session?.trackName) ? session.trackName.trim() : '',
    audioUrl: isNonEmptyString(session?.audioUrl) ? session.audioUrl.trim() : '',
    durationMs,
    offsetMs: durationMs > 0 ? clamp(offsetMs, 0, durationMs) : offsetMs,
    loop: session?.loop === true,
    startedAt: session?.startedAt || null,
    startedAtMs: Math.max(0, Math.round(asFiniteNumber(session?.startedAtMs, 0))),
    commandId: isNonEmptyString(session?.commandId) ? session.commandId.trim() : '',
    updatedAt: session?.updatedAt || null,
    updatedBy: isNonEmptyString(session?.updatedBy) ? session.updatedBy.trim() : '',
  };
};

export const sortGrigliataMusicPlaybackSessions = (sessions) => (
  [...(sessions || [])]
    .map((session) => normalizeGrigliataMusicPlaybackSession(session))
    .filter((session) => (
      session.status !== GRIGLIATA_MUSIC_PLAYBACK_STATUSES.STOPPED
      && session.trackId
      && session.trackName
      && (session.audioUrl || session.mediaAssetId)
    ))
    .sort((left, right) => {
      const rightMillis = timestampToMillis(right.updatedAt || right.startedAt);
      const leftMillis = timestampToMillis(left.updatedAt || left.startedAt);
      if (rightMillis !== leftMillis) return rightMillis - leftMillis;
      return left.trackName.localeCompare(right.trackName);
    })
);

export const computeGrigliataMusicPlaybackOffsetMs = (state, now = Date.now()) => {
  const normalizedState = normalizeGrigliataMusicPlaybackState(state);
  const baseOffsetMs = normalizedState.offsetMs;
  const isLooping = state?.loop === true;

  if (normalizedState.status !== GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING) {
    return baseOffsetMs;
  }

  const startedAtMs = Math.max(0, Math.round(asFiniteNumber(state?.startedAtMs, 0)))
    || timestampToMillis(normalizedState.startedAt);
  const elapsedMs = startedAtMs > 0 ? Math.max(0, now - startedAtMs) : 0;
  const nextOffsetMs = baseOffsetMs + elapsedMs;

  if (normalizedState.durationMs > 0) {
    if (isLooping) {
      return nextOffsetMs % normalizedState.durationMs;
    }

    return clamp(nextOffsetMs, 0, normalizedState.durationMs);
  }

  return nextOffsetMs;
};

export const buildGrigliataMusicPlaybackSession = ({
  status,
  track = null,
  offsetMs = 0,
  loop = false,
  startedAt = null,
  startedAtMs = 0,
  updatedAt = null,
  updatedBy = '',
  commandId = createGrigliataMusicCommandId(),
  canonicalOnly = false,
}) => {
  const resolvedStatus = resolvePlaybackStatus(status);
  const normalizedTrack = normalizeGrigliataMusicTrack(track);
  const resolvedDurationMs = normalizedTrack.durationMs;
  const resolvedOffsetMs = Math.max(0, Math.round(asFiniteNumber(offsetMs, 0)));
  const clampedOffsetMs = resolvedDurationMs > 0
    ? clamp(resolvedOffsetMs, 0, resolvedDurationMs)
    : resolvedOffsetMs;
  const mediaAssetId = normalizedTrack.mediaAssetId;
  if (resolvedStatus !== GRIGLIATA_MUSIC_PLAYBACK_STATUSES.STOPPED
    && canonicalOnly
    && !mediaAssetId) {
    throw new TypeError('Canonical music media is required for playback.');
  }

  if (resolvedStatus === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.STOPPED) {
    return {
      ...EMPTY_GRIGLIATA_MUSIC_PLAYBACK_SESSION,
      id: normalizedTrack.id,
      trackId: normalizedTrack.id,
      commandId,
      updatedAt,
      updatedBy: isNonEmptyString(updatedBy) ? updatedBy.trim() : '',
    };
  }

  return {
    id: normalizedTrack.id,
    status: resolvedStatus,
    trackId: normalizedTrack.id,
    trackName: normalizedTrack.name,
    audioUrl: canonicalOnly ? '' : normalizedTrack.audioUrl,
    mediaAssetId,
    durationMs: resolvedDurationMs,
    offsetMs: clampedOffsetMs,
    loop: loop === true,
    startedAt: resolvedStatus === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING ? startedAt || null : null,
    startedAtMs: resolvedStatus === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING
      ? Math.max(0, Math.round(asFiniteNumber(startedAtMs, 0)))
      : 0,
    commandId,
    updatedAt,
    updatedBy: isNonEmptyString(updatedBy) ? updatedBy.trim() : '',
  };
};

export const buildGrigliataMusicPlaybackState = ({
  status,
  track = null,
  offsetMs = 0,
  volume = DEFAULT_GRIGLIATA_MUSIC_VOLUME,
  startedAt = null,
  updatedAt = null,
  updatedBy = '',
  commandId = createGrigliataMusicCommandId(),
  canonicalOnly = false,
}) => {
  const resolvedStatus = resolvePlaybackStatus(status);
  const normalizedTrack = normalizeGrigliataMusicTrack(track);
  const resolvedDurationMs = normalizedTrack.durationMs;
  const resolvedOffsetMs = Math.max(0, Math.round(asFiniteNumber(offsetMs, 0)));
  const clampedOffsetMs = resolvedDurationMs > 0
    ? clamp(resolvedOffsetMs, 0, resolvedDurationMs)
    : resolvedOffsetMs;
  const resolvedVolume = normalizeGrigliataMusicVolume(volume);
  const mediaAssetId = normalizedTrack.mediaAssetId;
  if (resolvedStatus !== GRIGLIATA_MUSIC_PLAYBACK_STATUSES.STOPPED
    && canonicalOnly
    && !mediaAssetId) {
    throw new TypeError('Canonical music media is required for playback.');
  }

  if (resolvedStatus === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.STOPPED) {
    return {
      ...EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE,
      volume: resolvedVolume,
      commandId,
      updatedAt,
      updatedBy: isNonEmptyString(updatedBy) ? updatedBy.trim() : '',
    };
  }

  return {
    status: resolvedStatus,
    trackId: normalizedTrack.id,
    trackName: normalizedTrack.name,
    audioUrl: canonicalOnly ? '' : normalizedTrack.audioUrl,
    mediaAssetId,
    durationMs: resolvedDurationMs,
    offsetMs: clampedOffsetMs,
    volume: resolvedVolume,
    startedAt: resolvedStatus === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING ? startedAt || null : null,
    commandId,
    updatedAt,
    updatedBy: isNonEmptyString(updatedBy) ? updatedBy.trim() : '',
  };
};

export const readAudioFileMetadata = (file) => {
  if (!file) {
    return Promise.reject(new Error('Audio file is required.'));
  }

  return withObjectUrl(file, (objectUrl) => new Promise((resolve, reject) => {
    const audio = document.createElement('audio');

    const cleanup = () => {
      audio.removeAttribute('src');
      try {
        audio.load();
      } catch (error) {
        // Ignore cleanup failures from detached audio elements.
      }
    };

    audio.preload = 'metadata';

    audio.onloadedmetadata = () => {
      const durationSeconds = Number(audio.duration);
      cleanup();

      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        reject(new Error('Unable to determine the audio duration.'));
        return;
      }

      resolve({
        durationMs: Math.round(durationSeconds * 1000),
      });
    };

    audio.onerror = () => {
      cleanup();
      reject(new Error('Unable to read the selected audio file.'));
    };

    audio.src = objectUrl;
  }));
};
