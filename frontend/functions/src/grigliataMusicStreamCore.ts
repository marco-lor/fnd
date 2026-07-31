import {createHash} from "crypto";
import {MEDIA_CONTRACTS} from "./mediaContracts";

export const TASK07_MUSIC_STREAM_SCHEMA_VERSION = 1;
export const TASK07_MUSIC_STREAM_MAX_SESSIONS = 4;
export const TASK07_MUSIC_STREAM_QUERY_LIMIT =
  TASK07_MUSIC_STREAM_MAX_SESSIONS + 1;
export const TASK07_MUSIC_STREAM_DEFAULT_VOLUME = 0.65;

const MAX_SESSION_ID_LENGTH = 128;
const MAX_TRACK_NAME_LENGTH = 256;
const MAX_AUDIO_URL_LENGTH = 2048;
const MAX_MUSIC_DURATION_MS =
  MEDIA_CONTRACTS.music.source.maxDurationMs ?? 60 * 60 * 1000;
const SAFE_SESSION_ID = /^[^/\\\u0000-\u001f\u007f]{1,128}$/;

type UnknownRecord = Record<string, unknown>;

export interface Task07MusicProjectionSource {
  id: string;
  data: unknown;
}

export interface Task07MusicProjectionSession {
  id: string;
  status: "playing" | "paused";
  trackId: string;
  trackName: string;
  audioUrl: string;
  durationMs: number;
  offsetMs: number;
  loop: boolean;
  startedAtMs: number;
  updatedAtMs: number;
}

export interface Task07MusicProjection {
  schemaVersion: 1;
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
  return result && SAFE_SESSION_ID.test(result) ? result : null;
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

const isSafeAudioUrl = (value: unknown): value is string => {
  const text = asTrimmedText(value, MAX_AUDIO_URL_LENGTH);
  if (!text) return false;
  try {
    const parsed = new URL(text);
    if (parsed.username || parsed.password) return false;
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
};

const projectionHash = (input: {
  volume: number;
  sessions: readonly Task07MusicProjectionSession[];
}): string => createHash("sha256")
  .update(JSON.stringify({
    schemaVersion: TASK07_MUSIC_STREAM_SCHEMA_VERSION,
    volume: input.volume,
    sessions: input.sessions,
  }))
  .digest("hex");

const safeProjection = (input: {
  volume: number;
  sessions: Task07MusicProjectionSession[];
}): Task07MusicProjection => ({
  schemaVersion: TASK07_MUSIC_STREAM_SCHEMA_VERSION,
  volume: input.volume,
  sessions: input.sessions,
  sourceHash: projectionHash(input),
});

type NormalizedSession =
  {kind: "ignored"} |
  {kind: "invalid"} |
  {kind: "valid"; session: Task07MusicProjectionSession};

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
  if (!id || !trackId || id !== trackId || !trackName ||
    !isSafeAudioUrl(source.data.audioUrl) || durationMs === null ||
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
      audioUrl: source.data.audioUrl.trim(),
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
  if (!trackId || !trackName || !isSafeAudioUrl(playback.audioUrl) ||
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
      audioUrl: playback.audioUrl.trim(),
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

export const buildTask07MusicProjection = (input: {
  playback: unknown;
  sessions: readonly Task07MusicProjectionSource[];
}): Task07MusicProjectionResult => {
  let playback: UnknownRecord | null = null;
  if (input.playback != null) {
    if (!isRecord(input.playback)) {
      return {
        projection: safeProjection({
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
      projection: safeProjection({
        volume: TASK07_MUSIC_STREAM_DEFAULT_VOLUME,
        sessions: [],
      }),
      diagnosticCode: "invalid-volume",
      sourceCount: input.sessions.length,
    };
  }

  const sessions: Task07MusicProjectionSession[] = [];
  const seenIds = new Set<string>();
  for (const source of input.sessions) {
    const normalized = normalizeSession(source);
    if (normalized.kind === "ignored") continue;
    if (normalized.kind === "invalid" ||
      seenIds.has(normalized.session.id)) {
      return {
        projection: safeProjection({volume, sessions: []}),
        diagnosticCode: normalized.kind === "invalid" ?
          "invalid-session" :
          "duplicate-session",
        sourceCount: input.sessions.length,
      };
    }
    seenIds.add(normalized.session.id);
    sessions.push(normalized.session);
    if (sessions.length > TASK07_MUSIC_STREAM_MAX_SESSIONS) {
      return {
        projection: safeProjection({volume, sessions: []}),
        diagnosticCode: "over-cap",
        sourceCount: input.sessions.length,
      };
    }
  }
  if (sessions.length === 0 && playback !== null) {
    const fallback = normalizePlaybackFallback(playback);
    if (fallback.kind === "invalid") {
      return {
        projection: safeProjection({volume, sessions: []}),
        diagnosticCode: "invalid-playback-fallback",
        sourceCount: input.sessions.length,
      };
    }
    if (fallback.kind === "valid") sessions.push(fallback.session);
  }
  sessions.sort(compareSessions);
  return {
    projection: safeProjection({volume, sessions}),
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
