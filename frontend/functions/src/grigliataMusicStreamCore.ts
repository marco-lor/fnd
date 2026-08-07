import {createHash} from "crypto";
import {
  MEDIA_CONTRACTS,
  MEDIA_CONTRACT_VERSION,
  MEDIA_SCHEMA_VERSION,
  parseCanonicalMediaPath,
} from "./mediaContracts";

export const TASK07_MUSIC_STREAM_SCHEMA_VERSION = 2;
export const TASK07_MUSIC_STREAM_MAX_SESSIONS = 4;
export const TASK07_MUSIC_STREAM_QUERY_LIMIT =
  TASK07_MUSIC_STREAM_MAX_SESSIONS + 1;
export const TASK07_MUSIC_STREAM_DEFAULT_VOLUME = 0.65;

export type Task07MusicProjectionControlMode =
  "shadow" | "derivative-read" | "v1-write" | "canonical-only";

const MAX_SESSION_ID_LENGTH = 128;
const MAX_TRACK_NAME_LENGTH = 256;
const MAX_MUSIC_DURATION_MS =
  MEDIA_CONTRACTS.music.source.maxDurationMs ?? 60 * 60 * 1000;
const CANONICAL_ASSET_ID = /^m_[a-f0-9]{40}$/;
const STORAGE_GENERATION = /^[1-9][0-9]*$/;
const MUSIC_CONTENT_TYPES = new Set(
  MEDIA_CONTRACTS.music.source.contentTypes
);

type UnknownRecord = Record<string, unknown>;

export interface Task07MusicProjectionSource {
  id: string;
  data: unknown;
}

export interface Task07MusicProjectionTrack {
  id: string;
  data: unknown;
}

export interface Task07MusicProjectionAudio {
  path: string;
  contentType: string;
  bytes: number;
  durationMs: number;
  width: number;
  height: number;
  generation: string;
}

export interface Task07MusicProjectionMedia {
  schemaVersion: 1;
  contractVersion: 1;
  assetId: string;
  kind: "music";
  state: "ready";
  generation: string;
  audience: "signed-in";
  ownerUid: string;
  original: Task07MusicProjectionAudio;
}

export interface Task07MusicProjectionSession {
  id: string;
  status: "playing" | "paused";
  trackId: string;
  trackName: string;
  mediaAssetId: string;
  media: Task07MusicProjectionMedia;
  durationMs: number;
  offsetMs: number;
  loop: boolean;
  startedAtMs: number;
  updatedAtMs: number;
}

export interface Task07MusicProjection {
  schemaVersion: 2;
  controlMode: Task07MusicProjectionControlMode;
  volume: number;
  sessions: Task07MusicProjectionSession[];
  sourceHash: string;
}

export interface Task07MusicProjectionResult {
  projection: Task07MusicProjection;
  diagnosticCode: string | null;
  sourceCount: number;
}

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const asTrimmedText = (
  value: unknown,
  maxLength: number
): string | null => {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result && result.length <= maxLength ? result : null;
};

const asSafeSessionId = (value: unknown): string | null => {
  const result = asTrimmedText(value, MAX_SESSION_ID_LENGTH);
  if (!result || result.includes("/") || result.includes("\\")) return null;
  const hasControlCharacter = Array.from(result).some((character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  return hasControlCharacter ? null : result;
};

const asInteger = (
  value: unknown,
  minimum: number,
  maximum: number
): number | null => (
  Number.isSafeInteger(value) &&
  (value as number) >= minimum &&
  (value as number) <= maximum ?
    value as number :
    null
);

const timestampMillis = (value: unknown): number | null => {
  let milliseconds: unknown = value;
  if (value instanceof Date) {
    milliseconds = value.getTime();
  } else if (isRecord(value) && typeof value.toMillis === "function") {
    try {
      milliseconds = (value.toMillis as () => unknown).call(value);
    } catch {
      return null;
    }
  }
  return asInteger(milliseconds, 1, Number.MAX_SAFE_INTEGER);
};

const asCanonicalAssetId = (value: unknown): string | null => {
  const result = asTrimmedText(value, 42);
  return result && CANONICAL_ASSET_ID.test(result) ? result : null;
};

const optionalCanonicalAssetId = (value: unknown): string | null => {
  if (value == null || value === "") return "";
  return asCanonicalAssetId(value);
};

const normalizeCanonicalTrack = (
  source: Task07MusicProjectionTrack
): {name: string; durationMs: number; media: Task07MusicProjectionMedia} |
null => {
  const id = asSafeSessionId(source.id);
  if (!id || !isRecord(source.data)) return null;
  const name = asTrimmedText(source.data.name, MAX_TRACK_NAME_LENGTH);
  const durationMs = asInteger(
    source.data.durationMs,
    1,
    MAX_MUSIC_DURATION_MS
  );
  const media = isRecord(source.data.media) ? source.data.media : null;
  const original = media && isRecord(media.original) ? media.original : null;
  const assetId = media ? asCanonicalAssetId(media.assetId) : null;
  const ownerUid = media ? asSafeSessionId(media.ownerUid) : null;
  const sourceGeneration = media ?
    asTrimmedText(media.generation, 32) :
    null;
  const path = original ? asTrimmedText(original.path, 1024) : null;
  const parsedPath = parseCanonicalMediaPath(path);
  const contentType = original ?
    asTrimmedText(original.contentType, 128)?.toLowerCase() ?? null :
    null;
  const bytes = original ? asInteger(
    original.bytes,
    1,
    MEDIA_CONTRACTS.music.source.maxBytes
  ) : null;
  const originalDurationMs = original ? asInteger(
    original.durationMs,
    1,
    MAX_MUSIC_DURATION_MS
  ) : null;
  const width = original ? asInteger(original.width, 0, 0) : null;
  const height = original ? asInteger(original.height, 0, 0) : null;
  const objectGeneration = original ?
    asTrimmedText(original.generation, 32) :
    null;
  if (!name || durationMs === null || !media || !original || !assetId ||
    !ownerUid || !sourceGeneration || !STORAGE_GENERATION.test(sourceGeneration) ||
    media.schemaVersion !== MEDIA_SCHEMA_VERSION ||
    media.contractVersion !== MEDIA_CONTRACT_VERSION ||
    media.kind !== "music" || media.state !== "ready" ||
    media.audience !== "signed-in" ||
    !parsedPath || parsedPath.role !== "original" ||
    parsedPath.audienceScope !== "signed-in" ||
    parsedPath.ownerKey !== ownerUid || parsedPath.assetId !== assetId ||
    parsedPath.sourceGeneration !== sourceGeneration ||
    !contentType || !MUSIC_CONTENT_TYPES.has(contentType) || bytes === null ||
    originalDurationMs !== durationMs || width === null || height === null ||
    !objectGeneration || !STORAGE_GENERATION.test(objectGeneration)) {
    return null;
  }
  return {
    name,
    durationMs,
    media: {
      schemaVersion: 1,
      contractVersion: 1,
      assetId,
      kind: "music",
      state: "ready",
      generation: sourceGeneration,
      audience: "signed-in",
      ownerUid,
      original: {
        path: parsedPath.path,
        contentType,
        bytes,
        durationMs,
        width,
        height,
        generation: objectGeneration,
      },
    },
  };
};

const projectionHash = (input: {
  controlMode: Task07MusicProjectionControlMode;
  volume: number;
  sessions: readonly Task07MusicProjectionSession[];
}): string => createHash("sha256")
  .update(JSON.stringify({
    schemaVersion: TASK07_MUSIC_STREAM_SCHEMA_VERSION,
    controlMode: input.controlMode,
    volume: input.volume,
    sessions: input.sessions,
  }))
  .digest("hex");

const safeProjection = (input: {
  controlMode: Task07MusicProjectionControlMode;
  volume: number;
  sessions: Task07MusicProjectionSession[];
}): Task07MusicProjection => ({
  schemaVersion: TASK07_MUSIC_STREAM_SCHEMA_VERSION,
  controlMode: input.controlMode,
  volume: input.volume,
  sessions: input.sessions,
  sourceHash: projectionHash(input),
});

type Task07MusicSourceSession = Omit<
  Task07MusicProjectionSession,
  "trackName" | "mediaAssetId" | "media" | "durationMs"
> & {
  trackName: string;
  mediaAssetId: string;
  durationMs: number;
};

type NormalizedSession =
  {kind: "ignored"} |
  {kind: "invalid"} |
  {kind: "valid"; session: Task07MusicSourceSession};

const normalizeSession = (
  source: Task07MusicProjectionSource
): NormalizedSession => {
  if (!isRecord(source.data)) return {kind: "invalid"};
  if (source.data.status === "stopped") return {kind: "ignored"};
  if (source.data.status !== "playing" && source.data.status !== "paused") {
    return {kind: "invalid"};
  }
  const id = asSafeSessionId(source.id);
  const trackId = asSafeSessionId(source.data.trackId);
  const trackName = asTrimmedText(
    source.data.trackName,
    MAX_TRACK_NAME_LENGTH
  );
  const durationMs = asInteger(
    source.data.durationMs,
    1,
    MAX_MUSIC_DURATION_MS
  );
  const offsetMs = durationMs === null ? null : asInteger(
    source.data.offsetMs,
    0,
    durationMs
  );
  const startedAtMs = source.data.status === "playing" ?
    asInteger(source.data.startedAtMs, 1, Number.MAX_SAFE_INTEGER) :
    source.data.startedAtMs === 0 ? 0 : null;
  const updatedAtMs = timestampMillis(source.data.updatedAt);
  const mediaAssetId = optionalCanonicalAssetId(source.data.mediaAssetId);
  if (!id || !trackId || id !== trackId || !trackName ||
    mediaAssetId === null || durationMs === null ||
    offsetMs === null || typeof source.data.loop !== "boolean" ||
    startedAtMs === null || updatedAtMs === null) {
    return {kind: "invalid"};
  }
  return {
    kind: "valid",
    session: {
      id,
      status: source.data.status,
      trackId,
      trackName,
      mediaAssetId,
      durationMs,
      offsetMs,
      loop: source.data.loop,
      startedAtMs,
      updatedAtMs,
    },
  };
};

const normalizePlaybackFallback = (
  playback: UnknownRecord
): NormalizedSession => {
  if (playback.status === "stopped" || playback.status == null) {
    return {kind: "ignored"};
  }
  if (playback.status !== "playing" && playback.status !== "paused") {
    return {kind: "invalid"};
  }
  const trackId = asSafeSessionId(playback.trackId);
  const trackName = asTrimmedText(playback.trackName, MAX_TRACK_NAME_LENGTH);
  const durationMs = asInteger(
    playback.durationMs,
    1,
    MAX_MUSIC_DURATION_MS
  );
  const offsetMs = durationMs === null ? null : asInteger(
    playback.offsetMs,
    0,
    durationMs
  );
  const startedAtMs = playback.status === "playing" ?
    timestampMillis(playback.startedAt) :
    playback.startedAt == null ? 0 : null;
  const updatedAtMs = timestampMillis(playback.updatedAt);
  const mediaAssetId = optionalCanonicalAssetId(playback.mediaAssetId);
  if (!trackId || !trackName || mediaAssetId === null ||
    durationMs === null || offsetMs === null || startedAtMs === null ||
    updatedAtMs === null) {
    return {kind: "invalid"};
  }
  return {
    kind: "valid",
    session: {
      id: "legacy-current",
      status: playback.status,
      trackId,
      trackName,
      mediaAssetId,
      durationMs,
      offsetMs,
      loop: false,
      startedAtMs,
      updatedAtMs,
    },
  };
};

const compareSessions = (
  left: Task07MusicProjectionSession,
  right: Task07MusicProjectionSession
): number => (
  right.updatedAtMs - left.updatedAtMs || left.id.localeCompare(right.id)
);

export const task07MusicProjectionTrackIds = (input: {
  playback: unknown;
  sessions: readonly Task07MusicProjectionSource[];
}): string[] => {
  if (input.sessions.length > TASK07_MUSIC_STREAM_QUERY_LIMIT) return [];
  const ids = new Set<string>();
  input.sessions.forEach((source) => {
    if (!isRecord(source.data) ||
      !["playing", "paused"].includes(String(source.data.status))) return;
    const id = asSafeSessionId(source.data.trackId);
    if (id) ids.add(id);
  });
  if (ids.size === 0 && isRecord(input.playback) &&
    ["playing", "paused"].includes(String(input.playback.status))) {
    const id = asSafeSessionId(input.playback.trackId);
    if (id) ids.add(id);
  }
  return [...ids].sort().slice(0, TASK07_MUSIC_STREAM_MAX_SESSIONS);
};

export const buildTask07MusicProjection = (input: {
  controlMode: Task07MusicProjectionControlMode;
  playback: unknown;
  sessions: readonly Task07MusicProjectionSource[];
  tracks: readonly Task07MusicProjectionTrack[];
}): Task07MusicProjectionResult => {
  const projectSafely = (value: {
    volume: number;
    sessions: Task07MusicProjectionSession[];
  }) => safeProjection({controlMode: input.controlMode, ...value});
  let playback: UnknownRecord | null = null;
  if (input.playback != null) {
    if (!isRecord(input.playback)) {
      return {
        projection: projectSafely({
          volume: TASK07_MUSIC_STREAM_DEFAULT_VOLUME,
          sessions: [],
        }),
        diagnosticCode: "invalid-volume",
        sourceCount: input.sessions.length,
      };
    }
    playback = input.playback;
  }
  const volume = playback === null ?
    TASK07_MUSIC_STREAM_DEFAULT_VOLUME :
    typeof playback.volume === "number" &&
      Number.isFinite(playback.volume) && playback.volume >= 0 &&
      playback.volume <= 1 ?
      playback.volume :
      null;
  if (volume === null) {
    return {
      projection: projectSafely({
        volume: TASK07_MUSIC_STREAM_DEFAULT_VOLUME,
        sessions: [],
      }),
      diagnosticCode: "invalid-volume",
      sourceCount: input.sessions.length,
    };
  }

  const sourceSessions: Task07MusicSourceSession[] = [];
  const seenIds = new Set<string>();
  for (const source of input.sessions) {
    const normalized = normalizeSession(source);
    if (normalized.kind === "ignored") continue;
    if (normalized.kind === "invalid" ||
      seenIds.has(normalized.session.id)) {
      return {
        projection: projectSafely({volume, sessions: []}),
        diagnosticCode: normalized.kind === "invalid" ?
          "invalid-session" :
          "duplicate-session",
        sourceCount: input.sessions.length,
      };
    }
    seenIds.add(normalized.session.id);
    sourceSessions.push(normalized.session);
    if (sourceSessions.length > TASK07_MUSIC_STREAM_MAX_SESSIONS) {
      return {
        projection: projectSafely({volume, sessions: []}),
        diagnosticCode: "over-cap",
        sourceCount: input.sessions.length,
      };
    }
  }
  if (sourceSessions.length === 0 && playback !== null) {
    const fallback = normalizePlaybackFallback(playback);
    if (fallback.kind === "invalid") {
      return {
        projection: projectSafely({volume, sessions: []}),
        diagnosticCode: "invalid-playback-fallback",
        sourceCount: input.sessions.length,
      };
    }
    if (fallback.kind === "valid") sourceSessions.push(fallback.session);
  }
  const tracks = new Map<string, ReturnType<typeof normalizeCanonicalTrack>>();
  for (const source of input.tracks) {
    if (tracks.has(source.id)) {
      return {
        projection: projectSafely({volume, sessions: []}),
        diagnosticCode: "duplicate-track",
        sourceCount: input.sessions.length,
      };
    }
    const track = normalizeCanonicalTrack(source);
    if (!track) {
      return {
        projection: projectSafely({volume, sessions: []}),
        diagnosticCode: "invalid-track",
        sourceCount: input.sessions.length,
      };
    }
    tracks.set(source.id, track);
  }
  const sessions: Task07MusicProjectionSession[] = [];
  for (const session of sourceSessions) {
    const track = tracks.get(session.trackId);
    if (!track) {
      return {
        projection: projectSafely({volume, sessions: []}),
        diagnosticCode: "missing-track",
        sourceCount: input.sessions.length,
      };
    }
    if ((session.mediaAssetId &&
      session.mediaAssetId !== track.media.assetId) ||
      session.durationMs !== track.durationMs ||
      session.offsetMs > track.durationMs) {
      return {
        projection: projectSafely({volume, sessions: []}),
        diagnosticCode: "session-track-mismatch",
        sourceCount: input.sessions.length,
      };
    }
    sessions.push({
      ...session,
      trackName: track.name,
      mediaAssetId: track.media.assetId,
      media: track.media,
      durationMs: track.durationMs,
    });
  }
  sessions.sort(compareSessions);
  return {
    projection: projectSafely({volume, sessions}),
    diagnosticCode: null,
    sourceCount: input.sessions.length,
  };
};

export const nextTask07MusicStreamWrite = (
  current: unknown,
  projection: Task07MusicProjection
): (Task07MusicProjection & {revision: number}) | null => {
  const currentData = isRecord(current) ? current : {};
  const currentRevision = asInteger(
    currentData.revision,
    1,
    Number.MAX_SAFE_INTEGER
  );
  if (currentData.schemaVersion === TASK07_MUSIC_STREAM_SCHEMA_VERSION &&
    currentRevision !== null &&
    currentData.sourceHash === projection.sourceHash) {
    return null;
  }
  return {
    ...projection,
    revision: currentRevision === null ||
      currentRevision === Number.MAX_SAFE_INTEGER ?
      1 :
      currentRevision + 1,
  };
};
