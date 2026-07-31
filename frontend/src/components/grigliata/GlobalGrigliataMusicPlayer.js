import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  labelFirestoreTarget,
  onSnapshot,
} from '../../performance/firestore';
import { withAsyncResourceOwner } from '../../performance/runtime';
import { db } from '../firebaseConfig';
import { useAuth } from '../../AuthContext';
import {
  loadTask07MediaMode,
  task07ModeReadsDerivatives,
} from '../../data/media/task07MediaControl';
import {
  computeGrigliataMusicPlaybackOffsetMs,
  EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE,
  GRIGLIATA_MUSIC_MUTED_FIELD,
  GRIGLIATA_MUSIC_PLAYBACK_COLLECTION,
  GRIGLIATA_MUSIC_PLAYBACK_DOC_ID,
  GRIGLIATA_MUSIC_PLAYBACK_SESSION_COLLECTION,
  GRIGLIATA_MUSIC_PLAYBACK_STATUSES,
  normalizeGrigliataMusicPlaybackSession,
  normalizeGrigliataMusicPlaybackState,
  normalizeGrigliataMusicVolume,
  sortGrigliataMusicPlaybackSessions,
} from './music';
import { timestampToMillis } from './boardUtils';

export const GRIGLIATA_MUSIC_STREAM_COLLECTION = 'grigliata_music_stream';
export const GRIGLIATA_MUSIC_STREAM_DOC_ID = 'current';
export const MAX_GLOBAL_GRIGLIATA_MUSIC_SESSIONS = 4;
export const MAX_GLOBAL_GRIGLIATA_MUSIC_AUDIO_NODES = MAX_GLOBAL_GRIGLIATA_MUSIC_SESSIONS;
export const GRIGLIATA_MUSIC_STREAM_SCHEMA_VERSION = 1;

const MAX_GLOBAL_GRIGLIATA_MUSIC_DURATION_MS = 60 * 60 * 1000;
const MUSIC_STREAM_HASH_PATTERN = /^[a-f0-9]{64}$/;

export const EMPTY_GRIGLIATA_MUSIC_STREAM = Object.freeze({
  schemaVersion: 0,
  revision: 0,
  volume: normalizeGrigliataMusicVolume(undefined),
  sessions: Object.freeze([]),
  sourceHash: '',
  updatedAt: null,
});

const reportMusicStreamDiagnostic = (reason, sessionCount) => {
  console.error('Rejected invalid Grigliata music stream.', {
    reason,
    sessionCount: Number.isFinite(sessionCount) ? sessionCount : 0,
    maxSessions: MAX_GLOBAL_GRIGLIATA_MUSIC_SESSIONS,
  });
};

const isFiniteNumberBetween = (value, minimum, maximum) => (
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= minimum
  && value <= maximum
);

const isIntegerBetween = (value, minimum, maximum) => (
  Number.isSafeInteger(value)
  && value >= minimum
  && value <= maximum
);

const isSafeMusicAudioUrl = (value) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return false;
  try {
    const parsed = new URL(value.trim());
    if (parsed.username || parsed.password) return false;
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  } catch {
    return false;
  }
};

const isValidMusicStreamSession = (session) => {
  if (!session || typeof session !== 'object' || Array.isArray(session)) return false;
  const isActiveStatus = session.status === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING
    || session.status === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PAUSED;
  const hasValidIdentity = typeof session.id === 'string'
    && session.id.trim().length > 0
    && session.id.length <= 128
    && typeof session.trackId === 'string'
    && session.trackId.trim().length > 0
    && session.trackId.length <= 128;
  const hasValidTrackName = typeof session.trackName === 'string'
    && session.trackName.trim().length > 0
    && session.trackName.length <= 256;
  const hasValidDuration = isIntegerBetween(
    session.durationMs,
    1,
    MAX_GLOBAL_GRIGLIATA_MUSIC_DURATION_MS
  );
  const hasValidOffset = hasValidDuration
    && isIntegerBetween(session.offsetMs, 0, session.durationMs);
  const hasValidStartedAt = session.status === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING
    ? isIntegerBetween(session.startedAtMs, 1, Number.MAX_SAFE_INTEGER)
    : session.startedAtMs === 0;
  return isActiveStatus
    && hasValidIdentity
    && hasValidTrackName
    && isSafeMusicAudioUrl(session.audioUrl)
    && hasValidDuration
    && hasValidOffset
    && typeof session.loop === 'boolean'
    && hasValidStartedAt
    && isIntegerBetween(session.updatedAtMs, 1, Number.MAX_SAFE_INTEGER);
};

export const normalizeGrigliataMusicStream = (
  stream,
  reportDiagnostic = reportMusicStreamDiagnostic
) => {
  if (!stream || typeof stream !== 'object') return EMPTY_GRIGLIATA_MUSIC_STREAM;
  const sessionCount = Array.isArray(stream.sessions) ? stream.sessions.length : 0;
  if (
    stream.schemaVersion !== GRIGLIATA_MUSIC_STREAM_SCHEMA_VERSION
    || !isIntegerBetween(stream.revision, 1, Number.MAX_SAFE_INTEGER)
    || typeof stream.sourceHash !== 'string'
    || !MUSIC_STREAM_HASH_PATTERN.test(stream.sourceHash)
    || stream.updatedAt == null
    || !isFiniteNumberBetween(stream.volume, 0, 1)
  ) {
    reportDiagnostic('invalid-envelope', sessionCount);
    return EMPTY_GRIGLIATA_MUSIC_STREAM;
  }
  if (!Array.isArray(stream.sessions)) {
    reportDiagnostic('malformed-sessions', 0);
    return EMPTY_GRIGLIATA_MUSIC_STREAM;
  }
  if (stream.sessions.length > MAX_GLOBAL_GRIGLIATA_MUSIC_SESSIONS) {
    reportDiagnostic('over-cap', stream.sessions.length);
    return EMPTY_GRIGLIATA_MUSIC_STREAM;
  }

  const seenSessionIds = new Set();
  const sessions = [];
  for (const rawSession of stream.sessions) {
    if (!isValidMusicStreamSession(rawSession)) {
      reportDiagnostic('malformed-session', stream.sessions.length);
      return EMPTY_GRIGLIATA_MUSIC_STREAM;
    }
    const session = normalizeGrigliataMusicPlaybackSession(rawSession);
    if (
      !session.id
      || !session.trackId
      || !session.trackName
      || !session.audioUrl
      || seenSessionIds.has(session.id)
    ) {
      reportDiagnostic('malformed-session', stream.sessions.length);
      return EMPTY_GRIGLIATA_MUSIC_STREAM;
    }
    seenSessionIds.add(session.id);
    sessions.push({
      ...session,
      updatedAtMs: rawSession.updatedAtMs,
    });
  }

  return {
    schemaVersion: stream.schemaVersion,
    revision: stream.revision,
    volume: normalizeGrigliataMusicVolume(stream.volume),
    sessions,
    sourceHash: stream.sourceHash,
    updatedAt: stream.updatedAt,
  };
};

export const isTask07MusicStreamRevisionAccepted = (
  previousStream,
  nextStream
) => {
  if (!previousStream || previousStream.revision < 1) return true;
  if (!nextStream || nextStream.revision < previousStream.revision) return false;
  return nextStream.revision !== previousStream.revision
    || nextStream.sourceHash === previousStream.sourceHash;
};

export const subscribeToGrigliataMusicPlayback = (onPlaybackState, onError) => (
  withAsyncResourceOwner('shell', () => onSnapshot(
    labelFirestoreTarget(
      doc(db, GRIGLIATA_MUSIC_PLAYBACK_COLLECTION, GRIGLIATA_MUSIC_PLAYBACK_DOC_ID),
      'grigliata.music-playback.subscribe.v1',
      'shell'
    ),
    (snapshot) => {
      onPlaybackState(
        snapshot.exists()
          ? snapshot.data({ serverTimestamps: 'estimate' })
          : EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE
      );
    },
    onError
  ))
);

export const subscribeToGrigliataMusicPlaybackSessions = (
  onPlaybackSessions,
  onError
) => withAsyncResourceOwner('shell', () => onSnapshot(
  labelFirestoreTarget(
    collection(db, GRIGLIATA_MUSIC_PLAYBACK_SESSION_COLLECTION),
    'grigliata.music-sessions.subscribe.v1',
    'shell'
  ),
  (snapshot) => {
    onPlaybackSessions(snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data({ serverTimestamps: 'estimate' }),
    })));
  },
  onError
));

export const buildLegacyGrigliataMusicStream = ({
  playbackState,
  playbackSessions,
}) => {
  const state = normalizeGrigliataMusicPlaybackState(playbackState);
  const activeSessions = sortGrigliataMusicPlaybackSessions(playbackSessions);
  const legacyFallback = activeSessions.length === 0
    && state.status !== GRIGLIATA_MUSIC_PLAYBACK_STATUSES.STOPPED
    && state.trackId
    && state.trackName
    && state.audioUrl
    ? [{ ...state, id: 'legacy-current', loop: false }]
    : [];
  const sessions = (activeSessions.length > 0 ? activeSessions : legacyFallback)
    .map((session) => {
      const normalized = normalizeGrigliataMusicPlaybackSession(session);
      return {
        ...normalized,
        id: session.id || session.trackId,
        trackId: typeof session.trackId === 'string' && session.trackId.trim()
          ? session.trackId.trim()
          : normalized.trackId,
        startedAtMs: Number.isSafeInteger(session.startedAtMs)
          ? session.startedAtMs
          : timestampToMillis(session.startedAt),
        updatedAtMs: timestampToMillis(session.updatedAt),
      };
    });
  if (sessions.length > MAX_GLOBAL_GRIGLIATA_MUSIC_SESSIONS) {
    reportMusicStreamDiagnostic('legacy-over-cap', sessions.length);
    return {
      volume: state.volume,
      sessions: [],
    };
  }
  return {
    volume: state.volume,
    sessions,
  };
};

const comparableMusicStream = (stream) => ({
  volume: stream.volume,
  sessions: stream.sessions.map((session) => ({
    id: session.id,
    status: session.status,
    trackId: session.trackId,
    trackName: session.trackName,
    audioUrl: session.audioUrl,
    durationMs: session.durationMs,
    offsetMs: session.offsetMs,
    loop: session.loop === true,
    startedAtMs: session.startedAtMs,
    updatedAtMs: session.updatedAtMs,
  })),
});

export const task07MusicStreamsMatch = (legacyStream, projectedStream) => (
  JSON.stringify(comparableMusicStream(legacyStream))
  === JSON.stringify(comparableMusicStream(projectedStream))
);

export const subscribeToGrigliataMusicStream = (onMusicStream, onError) => (
  withAsyncResourceOwner('shell', () => onSnapshot(
    labelFirestoreTarget(
      doc(db, GRIGLIATA_MUSIC_STREAM_COLLECTION, GRIGLIATA_MUSIC_STREAM_DOC_ID),
      'grigliata.music-stream.subscribe.v1',
      'shell'
    ),
    (snapshot) => {
      onMusicStream(
        snapshot.exists()
          ? snapshot.data({ serverTimestamps: 'estimate' })
          : null
      );
    },
    onError
  ))
);

const clearAudioSource = (audio) => {
  if (!audio) return;
  try { audio.pause(); } catch { /* detached media cleanup */ }
  try { audio.currentTime = 0; } catch { /* detached media cleanup */ }
  if (audio.dataset.grigliataAudioUrl) delete audio.dataset.grigliataAudioUrl;
  audio.removeAttribute('src');
  try { audio.load(); } catch { /* detached media cleanup */ }
};

const clearAudioSources = (audioMap) => {
  audioMap.forEach((audio) => clearAudioSource(audio));
  audioMap.clear();
};

const getPlaybackSessionId = (session) => session?.id || session?.trackId || '';
const getPlaybackSessionKey = (session) => [
  getPlaybackSessionId(session),
  session?.status || '',
  session?.startedAtMs || 0,
  session?.offsetMs || 0,
].join(':');

const createAudioLoadError = (message, cause) => {
  const error = new Error(message);
  error.name = 'GrigliataAudioLoadError';
  if (cause) error.cause = cause;
  return error;
};

const ensureAudioSource = async (audio, audioUrl) => {
  if (!audio || !audioUrl || audio.dataset.grigliataAudioUrl === audioUrl) return;
  audio.dataset.grigliataAudioUrl = audioUrl;
  audio.src = audioUrl;
  try {
    audio.load();
  } catch (error) {
    throw createAudioLoadError('Unable to load the shared music source.', error);
  }
};

const seekAudio = async (audio, targetSeconds) => {
  if (!audio) return;
  const resolvedSeconds = Math.max(0, Number(targetSeconds || 0));
  const trySeekImmediately = () => {
    try {
      audio.currentTime = resolvedSeconds;
      return true;
    } catch (error) {
      return false;
    }
  };

  if (audio.readyState >= 1 || trySeekImmediately()) {
    if (audio.readyState >= 1 && !trySeekImmediately()) {
      throw createAudioLoadError('Unable to seek the shared music source.');
    }
    return;
  }

  await new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('error', handleError);
    };
    const handleLoadedMetadata = () => {
      cleanup();
      try {
        audio.currentTime = resolvedSeconds;
        resolve();
      } catch (error) {
        reject(createAudioLoadError('Unable to seek the shared music source.', error));
      }
    };
    const handleError = () => {
      cleanup();
      reject(createAudioLoadError('Unable to load the shared music source.'));
    };
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('error', handleError);
  });
};

const isAutoplayBlockedError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return error?.name === 'NotAllowedError'
    || message.includes('autoplay')
    || message.includes('user gesture');
};

const TASK07_MUSIC_MODES = new Set([
  'legacy',
  'shadow',
  'derivative-read',
  'v1-write',
]);

const normalizeTask07MusicMode = (mode) => (
  TASK07_MUSIC_MODES.has(mode) ? mode : 'legacy'
);

export default function GlobalGrigliataMusicPlayer({
  musicModeOverride = null,
  resolveMusicMode = loadTask07MediaMode,
  subscribeToPlaybackSessions = subscribeToGrigliataMusicPlaybackSessions,
  subscribeToPlaybackState = subscribeToGrigliataMusicPlayback,
  subscribeToMusicStream = subscribeToGrigliataMusicStream,
}) {
  const { user, userData } = useAuth();
  const audioRefs = useRef(new Map());
  const audioRefCallbacks = useRef(new Map());
  const playbackGenerationRef = useRef(0);
  const projectedEnvelopeRef = useRef(null);
  const shadowComparisonRef = useRef('');
  const [musicMode, setMusicMode] = useState(null);
  const [projectedStream, setProjectedStream] = useState(EMPTY_GRIGLIATA_MUSIC_STREAM);
  const [legacyPlaybackState, setLegacyPlaybackState] = useState(
    EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE
  );
  const [legacyPlaybackSessions, setLegacyPlaybackSessions] = useState([]);
  const [legacyStateReady, setLegacyStateReady] = useState(false);
  const [legacySessionsReady, setLegacySessionsReady] = useState(false);
  const [projectedStreamReady, setProjectedStreamReady] = useState(false);
  const [blockedPlaybackSessionIds, setBlockedPlaybackSessionIds] = useState([]);
  const [endedPlaybackSessionKeys, setEndedPlaybackSessionKeys] = useState([]);
  const isMusicMuted = userData?.settings?.[GRIGLIATA_MUSIC_MUTED_FIELD] === true;
  const userRole = typeof userData?.role === 'string' ? userData.role : '';

  useEffect(() => {
    if (!user?.uid) {
      setMusicMode(null);
      return undefined;
    }
    if (musicModeOverride !== null) {
      setMusicMode(normalizeTask07MusicMode(musicModeOverride));
      return undefined;
    }
    let active = true;
    setMusicMode(null);
    resolveMusicMode({
      purpose: 'music',
      role: userRole,
      uid: user.uid,
    }).then((mode) => {
      if (active) setMusicMode(normalizeTask07MusicMode(mode));
    }).catch(() => {
      if (active) {
        console.error('Failed to resolve the Grigliata music rollout mode.');
        setMusicMode('legacy');
      }
    });
    return () => {
      active = false;
    };
  }, [musicModeOverride, resolveMusicMode, user?.uid, userRole]);

  useEffect(() => {
    setProjectedStream(EMPTY_GRIGLIATA_MUSIC_STREAM);
    setLegacyPlaybackState(EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE);
    setLegacyPlaybackSessions([]);
    setLegacyStateReady(false);
    setLegacySessionsReady(false);
    setProjectedStreamReady(false);
    projectedEnvelopeRef.current = null;
    shadowComparisonRef.current = '';
    playbackGenerationRef.current += 1;
    clearAudioSources(audioRefs.current);
    if (!user?.uid || !musicMode) {
      setBlockedPlaybackSessionIds([]);
      setEndedPlaybackSessionKeys([]);
      return undefined;
    }

    const unsubscribes = [];
    const readsProjectedStream = musicMode === 'shadow'
      || task07ModeReadsDerivatives(musicMode);
    const readsLegacyStream = !task07ModeReadsDerivatives(musicMode);
    if (readsLegacyStream) {
      unsubscribes.push(subscribeToPlaybackState(
        (nextState) => {
          setLegacyPlaybackState(
            nextState || EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE
          );
          setLegacyStateReady(true);
        },
        () => {
          console.error('Failed to load Grigliata music playback state.');
          setLegacyPlaybackState(EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE);
          setLegacyStateReady(true);
        }
      ));
      unsubscribes.push(subscribeToPlaybackSessions(
        (nextSessions) => {
          setLegacyPlaybackSessions(
            Array.isArray(nextSessions) ? nextSessions : []
          );
          setLegacySessionsReady(true);
        },
        () => {
          console.error('Failed to load Grigliata music playback sessions.');
          setLegacyPlaybackSessions([]);
          setLegacySessionsReady(true);
        }
      ));
    }
    if (readsProjectedStream) {
      unsubscribes.push(subscribeToMusicStream(
        (nextMusicStream) => {
          const normalized = normalizeGrigliataMusicStream(nextMusicStream);
          if (normalized.revision === 0) {
            setProjectedStream(EMPTY_GRIGLIATA_MUSIC_STREAM);
            setProjectedStreamReady(true);
            return;
          }
          if (!isTask07MusicStreamRevisionAccepted(
            projectedEnvelopeRef.current,
            normalized
          )) {
            reportMusicStreamDiagnostic(
              normalized.revision === projectedEnvelopeRef.current?.revision
                ? 'revision-conflict'
                : 'revision-regression',
              normalized.sessions.length
            );
            setProjectedStream(EMPTY_GRIGLIATA_MUSIC_STREAM);
            setProjectedStreamReady(true);
            return;
          }
          if (normalized.revision > 0) projectedEnvelopeRef.current = normalized;
          setProjectedStream(normalized);
          setProjectedStreamReady(true);
        },
        () => {
          console.error('Failed to load the Grigliata music stream.');
          setProjectedStream(EMPTY_GRIGLIATA_MUSIC_STREAM);
          setProjectedStreamReady(true);
          setBlockedPlaybackSessionIds([]);
        }
      ));
    }

    return () => {
      unsubscribes.forEach((unsubscribe) => {
        if (typeof unsubscribe === 'function') unsubscribe();
      });
    };
  }, [
    musicMode,
    subscribeToMusicStream,
    subscribeToPlaybackSessions,
    subscribeToPlaybackState,
    user?.uid,
  ]);

  const legacyStream = useMemo(() => buildLegacyGrigliataMusicStream({
    playbackState: legacyPlaybackState,
    playbackSessions: legacyPlaybackSessions,
  }), [legacyPlaybackSessions, legacyPlaybackState]);
  const musicStream = useMemo(() => (
    musicMode && task07ModeReadsDerivatives(musicMode)
      ? projectedStream
      : legacyStream
  ), [legacyStream, musicMode, projectedStream]);

  useEffect(() => {
    if (musicMode !== 'shadow'
      || !legacyStateReady
      || !legacySessionsReady
      || !projectedStreamReady) {
      return;
    }
    const matches = task07MusicStreamsMatch(legacyStream, projectedStream);
    const comparisonKey = JSON.stringify({
      matches,
      legacyCount: legacyStream.sessions.length,
      projectedCount: projectedStream.sessions.length,
      legacyVolume: legacyStream.volume,
      projectedVolume: projectedStream.volume,
    });
    if (shadowComparisonRef.current === comparisonKey) return;
    shadowComparisonRef.current = comparisonKey;
    const diagnostic = {
      matches,
      legacySessionCount: legacyStream.sessions.length,
      projectedSessionCount: projectedStream.sessions.length,
      volumeMatches: legacyStream.volume === projectedStream.volume,
    };
    if (matches) {
      console.info('Task07 music shadow parity.', diagnostic);
    } else {
      console.error('Task07 music shadow mismatch.', diagnostic);
    }
  }, [
    legacySessionsReady,
    legacyStateReady,
    legacyStream,
    musicMode,
    projectedStream,
    projectedStreamReady,
  ]);

  const playingSessions = useMemo(() => {
    if (!user?.uid || !musicMode || isMusicMuted) return [];
    if (musicStream.sessions.length > MAX_GLOBAL_GRIGLIATA_MUSIC_SESSIONS) return [];
    return musicStream.sessions.filter((session) => (
      session.status === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING
      && !endedPlaybackSessionKeys.includes(getPlaybackSessionKey(session))
      && (
        session.loop
        || session.durationMs <= 0
        || computeGrigliataMusicPlaybackOffsetMs(session) < session.durationMs
      )
    ));
  }, [
    endedPlaybackSessionKeys,
    isMusicMuted,
    musicMode,
    musicStream.sessions,
    user?.uid,
  ]);

  useEffect(() => {
    const currentKeys = new Set(musicStream.sessions.map(getPlaybackSessionKey));
    setEndedPlaybackSessionKeys((currentKeysState) => (
      currentKeysState.filter((key) => currentKeys.has(key))
    ));
  }, [musicStream.sessions]);

  const markPlaybackSessionBlocked = useCallback((sessionId) => {
    if (!sessionId) return;
    setBlockedPlaybackSessionIds((currentIds) => (
      currentIds.includes(sessionId)
        ? currentIds
        : [...currentIds, sessionId].slice(-MAX_GLOBAL_GRIGLIATA_MUSIC_SESSIONS)
    ));
  }, []);

  const clearBlockedPlaybackSession = useCallback((sessionId) => {
    if (!sessionId) return;
    setBlockedPlaybackSessionIds((currentIds) => (
      currentIds.filter((currentId) => currentId !== sessionId)
    ));
  }, []);

  const getAudioRefCallback = useCallback((sessionId) => {
    let callback = audioRefCallbacks.current.get(sessionId);
    if (!callback) {
      callback = (audio) => {
        const previousAudio = audioRefs.current.get(sessionId);
        if (audio) {
          if (previousAudio && previousAudio !== audio) clearAudioSource(previousAudio);
          audioRefs.current.set(sessionId, audio);
          return;
        }
        if (previousAudio) clearAudioSource(previousAudio);
        audioRefs.current.delete(sessionId);
        audioRefCallbacks.current.delete(sessionId);
      };
      audioRefCallbacks.current.set(sessionId, callback);
    }
    return callback;
  }, []);

  useEffect(() => () => {
    playbackGenerationRef.current += 1;
    clearAudioSources(audioRefs.current);
    audioRefCallbacks.current.clear();
  }, []);

  const applyPlaybackSession = useCallback(async (
    nextSession,
    generation = playbackGenerationRef.current
  ) => {
    const session = normalizeGrigliataMusicPlaybackSession(nextSession);
    const sessionId = getPlaybackSessionId(session);
    const audio = audioRefs.current.get(sessionId);
    if (!audio) return;

    audio.volume = normalizeGrigliataMusicVolume(musicStream.volume);
    audio.muted = false;
    audio.loop = session.loop === true;

    const isCurrentOwner = () => (
      playbackGenerationRef.current === generation
      && audioRefs.current.get(sessionId) === audio
    );
    const clearIfStale = () => {
      if (isCurrentOwner()) return false;
      if (audioRefs.current.get(sessionId) !== audio) clearAudioSource(audio);
      return true;
    };

    try {
      if (clearIfStale()) return;
      if (session.status !== GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING || !session.audioUrl) {
        clearBlockedPlaybackSession(sessionId);
        clearAudioSource(audio);
        return;
      }

      await ensureAudioSource(audio, session.audioUrl);
      if (clearIfStale()) return;
      const targetOffsetMs = computeGrigliataMusicPlaybackOffsetMs(session);
      if (!session.loop && session.durationMs > 0 && targetOffsetMs >= session.durationMs) {
        await seekAudio(audio, session.durationMs / 1000);
        if (clearIfStale()) return;
        audio.pause();
        clearBlockedPlaybackSession(sessionId);
        return;
      }

      await seekAudio(audio, targetOffsetMs / 1000);
      if (clearIfStale()) return;
      await audio.play();
      if (clearIfStale()) return;
      clearBlockedPlaybackSession(sessionId);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (isAutoplayBlockedError(error)) {
        markPlaybackSessionBlocked(sessionId);
        return;
      }
      if (error?.name === 'GrigliataAudioLoadError') {
        console.error('Failed to prepare Grigliata music playback.');
        clearAudioSource(audio);
      } else {
        console.error('Failed to start Grigliata music playback.');
      }
      clearBlockedPlaybackSession(sessionId);
    }
  }, [clearBlockedPlaybackSession, markPlaybackSessionBlocked, musicStream.volume]);

  useEffect(() => {
    const activeSessionIds = new Set(playingSessions.map(getPlaybackSessionId).filter(Boolean));
    audioRefs.current.forEach((audio, sessionId) => {
      if (!activeSessionIds.has(sessionId)) {
        clearAudioSource(audio);
        audioRefs.current.delete(sessionId);
      }
    });
    setBlockedPlaybackSessionIds((currentIds) => (
      currentIds.filter((sessionId) => activeSessionIds.has(sessionId))
    ));
  }, [playingSessions]);

  useEffect(() => {
    const generation = playbackGenerationRef.current + 1;
    playbackGenerationRef.current = generation;
    const syncPlayback = async () => {
      if (playbackGenerationRef.current !== generation) return;
      await Promise.all(playingSessions.map(
        (session) => applyPlaybackSession(session, generation)
      ));
    };
    void syncPlayback();
    return () => {
      if (playbackGenerationRef.current === generation) {
        playbackGenerationRef.current += 1;
      }
    };
  }, [applyPlaybackSession, playingSessions]);

  const handlePlaybackSessionEnded = useCallback((sessionId, sessionKey) => {
    const audio = audioRefs.current.get(sessionId);
    if (audio) clearAudioSource(audio);
    clearBlockedPlaybackSession(sessionId);
    setEndedPlaybackSessionKeys((currentKeys) => (
      currentKeys.includes(sessionKey)
        ? currentKeys
        : [...currentKeys, sessionKey].slice(-MAX_GLOBAL_GRIGLIATA_MUSIC_SESSIONS)
    ));
  }, [clearBlockedPlaybackSession]);

  const handleUnlockAudio = useCallback(async () => {
    await Promise.all(playingSessions.map((session) => applyPlaybackSession(session)));
  }, [applyPlaybackSession, playingSessions]);

  const isUnlockPromptVisible = blockedPlaybackSessionIds.length > 0;

  return (
    <>
      {playingSessions.map((session) => {
        const sessionId = getPlaybackSessionId(session);
        const sessionKey = getPlaybackSessionKey(session);
        return (
          <audio
            key={sessionId}
            ref={getAudioRefCallback(sessionId)}
            data-session-id={sessionId}
            preload={'none'}
            className={'hidden'}
            aria-hidden={true}
            onEnded={() => handlePlaybackSessionEnded(sessionId, sessionKey)}
          />
        );
      })}

      {isUnlockPromptVisible && playingSessions.length > 0 && (
        <div className={'fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl border border-amber-400/40 bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur'}>
          <p className={'text-sm font-semibold text-amber-200'}>Enable audio</p>
          <p className={'mt-1 text-xs text-slate-300'}>
            Your browser blocked the shared Grigliata music. Enable audio to hear what the DM is playing.
          </p>
          <button
            type={'button'}
            onClick={handleUnlockAudio}
            className={'mt-3 rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-black transition-colors hover:bg-amber-300'}
          >
            Enable Audio
          </button>
        </div>
      )}
    </>
  );
}
