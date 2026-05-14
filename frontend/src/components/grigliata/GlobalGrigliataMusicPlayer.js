import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { useAuth } from '../../AuthContext';
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
  sortGrigliataMusicPlaybackSessions,
} from './music';

const clearAudioSource = (audio) => {
  if (!audio) return;

  try {
    audio.pause();
  } catch (error) {
    // Ignore cleanup failures in browsers that disallow controlling detached media.
  }

  try {
    audio.currentTime = 0;
  } catch (error) {
    // Ignore cleanup failures in browsers that disallow seeking detached media.
  }

  if (audio.dataset.grigliataAudioUrl) {
    delete audio.dataset.grigliataAudioUrl;
  }
  audio.removeAttribute('src');
  try {
    audio.load();
  } catch (error) {
    // Ignore cleanup failures in browsers that disallow loading detached media.
  }
};

const clearAudioSources = (audioMap) => {
  audioMap.forEach((audio) => clearAudioSource(audio));
  audioMap.clear();
};

const getPlaybackSessionId = (session) => session?.id || session?.trackId || '';

const ensureAudioSource = async (audio, audioUrl) => {
  if (!audio || !audioUrl) return;

  if (audio.dataset.grigliataAudioUrl === audioUrl) {
    return;
  }

  audio.dataset.grigliataAudioUrl = audioUrl;
  audio.src = audioUrl;
  try {
    audio.load();
  } catch (error) {
    throw createAudioLoadError('Unable to load the shared music source.', error);
  }
};

const applyAudioVolume = (audio, volume) => {
  if (!audio) return;

  audio.volume = Math.min(1, Math.max(0, Number(volume || 0)));
};

const applyAudioMuted = (audio, isMuted) => {
  if (!audio) return;

  audio.muted = isMuted === true;
};

const isAutoplayBlockedError = (error) => {
  const errorMessage = String(error?.message || '').toLowerCase();
  return error?.name === 'NotAllowedError'
    || errorMessage.includes('autoplay')
    || errorMessage.includes('user gesture');
};

const createAudioLoadError = (message, cause) => {
  const error = new Error(message);
  error.name = 'GrigliataAudioLoadError';
  if (cause) {
    error.cause = cause;
  }
  return error;
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

  if (audio.readyState >= 1) {
    if (!trySeekImmediately()) {
      throw createAudioLoadError('Unable to seek the shared music source.');
    }
    return;
  }

  if (trySeekImmediately()) {
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

export const subscribeToGrigliataMusicPlayback = (onPlaybackState, onError) => onSnapshot(
  doc(db, GRIGLIATA_MUSIC_PLAYBACK_COLLECTION, GRIGLIATA_MUSIC_PLAYBACK_DOC_ID),
  (snapshot) => {
    onPlaybackState(
      snapshot.exists()
        ? normalizeGrigliataMusicPlaybackState(snapshot.data({ serverTimestamps: 'estimate' }))
        : EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE
    );
  },
  onError
);

export const subscribeToGrigliataMusicPlaybackSessions = (onPlaybackSessions, onError) => onSnapshot(
  collection(db, GRIGLIATA_MUSIC_PLAYBACK_SESSION_COLLECTION),
  (snapshot) => {
    const nextSessions = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data({ serverTimestamps: 'estimate' }),
    }));
    onPlaybackSessions(sortGrigliataMusicPlaybackSessions(nextSessions));
  },
  onError
);

export default function GlobalGrigliataMusicPlayer({
  subscribeToPlaybackState = subscribeToGrigliataMusicPlayback,
  subscribeToPlaybackSessions = subscribeToGrigliataMusicPlaybackSessions,
}) {
  const { user, userData } = useAuth();
  const audioRefs = useRef(new Map());
  const [playbackState, setPlaybackState] = useState(EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE);
  const [playbackSessions, setPlaybackSessions] = useState([]);
  const [blockedPlaybackSessionIds, setBlockedPlaybackSessionIds] = useState([]);
  const isMusicMuted = userData?.settings?.[GRIGLIATA_MUSIC_MUTED_FIELD] === true;

  useEffect(() => {
    if (!user?.uid) {
      setPlaybackState(EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE);
      setPlaybackSessions([]);
      setBlockedPlaybackSessionIds([]);
      clearAudioSources(audioRefs.current);
      return undefined;
    }

    const unsubscribePlaybackState = subscribeToPlaybackState(
      (nextPlaybackState) => {
        setPlaybackState(nextPlaybackState || EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE);
      },
      (error) => {
        console.error('Failed to load Grigliata music playback state:', error);
        setPlaybackState(EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE);
      }
    );

    const unsubscribePlaybackSessions = subscribeToPlaybackSessions(
      (nextPlaybackSessions) => {
        setPlaybackSessions(sortGrigliataMusicPlaybackSessions(nextPlaybackSessions));
      },
      (error) => {
        console.error('Failed to load Grigliata music playback sessions:', error);
        setPlaybackSessions([]);
      }
    );

    return () => {
      if (typeof unsubscribePlaybackState === 'function') {
        unsubscribePlaybackState();
      }
      if (typeof unsubscribePlaybackSessions === 'function') {
        unsubscribePlaybackSessions();
      }
    };
  }, [subscribeToPlaybackSessions, subscribeToPlaybackState, user?.uid]);

  const normalizedPlaybackState = useMemo(
    () => normalizeGrigliataMusicPlaybackState(playbackState),
    [playbackState]
  );
  const normalizedPlaybackSessions = useMemo(() => {
    if (!user?.uid) {
      return [];
    }

    const activeSessions = sortGrigliataMusicPlaybackSessions(playbackSessions);
    if (activeSessions.length > 0) {
      return activeSessions;
    }

    return [{
      ...normalizeGrigliataMusicPlaybackSession(normalizedPlaybackState),
      id: 'legacy-current',
    }];
  }, [normalizedPlaybackState, playbackSessions, user?.uid]);
  const isUnlockPromptVisible = blockedPlaybackSessionIds.length > 0;

  const markPlaybackSessionBlocked = useCallback((sessionId) => {
    if (!sessionId) return;

    setBlockedPlaybackSessionIds((currentIds) => (
      currentIds.includes(sessionId) ? currentIds : [...currentIds, sessionId]
    ));
  }, []);

  const clearBlockedPlaybackSession = useCallback((sessionId) => {
    if (!sessionId) return;

    setBlockedPlaybackSessionIds((currentIds) => currentIds.filter((currentId) => currentId !== sessionId));
  }, []);

  const registerPlaybackSessionAudio = useCallback((sessionId, audio) => {
    if (!sessionId) return;

    if (audio) {
      audioRefs.current.set(sessionId, audio);
    }
  }, []);

  useEffect(() => () => {
    clearAudioSources(audioRefs.current);
  }, []);

  const applyPlaybackSession = useCallback(async (nextPlaybackSession) => {
    const normalizedSession = normalizeGrigliataMusicPlaybackSession(nextPlaybackSession);
    const sessionId = getPlaybackSessionId(normalizedSession);
    const audio = audioRefs.current.get(sessionId);
    if (!audio) return;

    applyAudioVolume(audio, normalizedPlaybackState.volume);
    applyAudioMuted(audio, isMusicMuted);
    audio.loop = normalizedSession.loop === true;

    try {
      if (
        normalizedSession.status === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.STOPPED
        || !normalizedSession.audioUrl
      ) {
        clearBlockedPlaybackSession(sessionId);
        clearAudioSource(audio);
        return;
      }

      await ensureAudioSource(audio, normalizedSession.audioUrl);

      if (normalizedSession.status === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PAUSED) {
        await seekAudio(audio, normalizedSession.offsetMs / 1000);
        audio.pause();
        clearBlockedPlaybackSession(sessionId);
        return;
      }

      const targetOffsetMs = computeGrigliataMusicPlaybackOffsetMs(normalizedSession);
      if (
        !normalizedSession.loop
        && normalizedSession.durationMs > 0
        && targetOffsetMs >= normalizedSession.durationMs
      ) {
        await seekAudio(audio, normalizedSession.durationMs / 1000);
        audio.pause();
        clearBlockedPlaybackSession(sessionId);
        return;
      }

      await seekAudio(audio, targetOffsetMs / 1000);
      await audio.play();
      clearBlockedPlaybackSession(sessionId);
    } catch (error) {
      if (error?.name === 'AbortError') {
        return;
      }

      if (isAutoplayBlockedError(error)) {
        if (!isMusicMuted) {
          markPlaybackSessionBlocked(sessionId);
        }
        return;
      }

      if (error?.name === 'GrigliataAudioLoadError') {
        console.error('Failed to prepare Grigliata music playback:', error);
        clearAudioSource(audio);
      } else {
        console.error('Failed to start Grigliata music playback:', error);
      }

      clearBlockedPlaybackSession(sessionId);
    }
  }, [clearBlockedPlaybackSession, isMusicMuted, markPlaybackSessionBlocked, normalizedPlaybackState.volume]);

  useEffect(() => {
    const activeSessionIds = new Set(normalizedPlaybackSessions.map(getPlaybackSessionId).filter(Boolean));

    audioRefs.current.forEach((audio, sessionId) => {
      if (!activeSessionIds.has(sessionId)) {
        clearAudioSource(audio);
        audioRefs.current.delete(sessionId);
      }
    });

    setBlockedPlaybackSessionIds((currentIds) => currentIds.filter((sessionId) => activeSessionIds.has(sessionId)));
  }, [normalizedPlaybackSessions]);

  useEffect(() => {
    let cancelled = false;

    const syncPlayback = async () => {
      if (cancelled) return;
      await Promise.all(normalizedPlaybackSessions.map((session) => applyPlaybackSession(session)));
    };

    void syncPlayback();

    return () => {
      cancelled = true;
    };
  }, [applyPlaybackSession, normalizedPlaybackSessions]);

  const handlePlaybackSessionEnded = useCallback((sessionId) => {
    clearBlockedPlaybackSession(sessionId);
  }, [clearBlockedPlaybackSession]);

  const handleUnlockAudio = useCallback(async () => {
    await Promise.all(normalizedPlaybackSessions.map((session) => applyPlaybackSession(session)));
  }, [applyPlaybackSession, normalizedPlaybackSessions]);

  return (
    <>
      {normalizedPlaybackSessions.map((session) => {
        const sessionId = getPlaybackSessionId(session);
        if (!sessionId) return null;

        return (
          <audio
            key={sessionId}
            ref={(audio) => registerPlaybackSessionAudio(sessionId, audio)}
            preload="auto"
            className="hidden"
            aria-hidden="true"
            onEnded={() => handlePlaybackSessionEnded(sessionId)}
          />
        );
      })}

      {isUnlockPromptVisible
        && !isMusicMuted
        && normalizedPlaybackSessions.some((session) => session.status === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING) && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl border border-amber-400/40 bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur">
          <p className="text-sm font-semibold text-amber-200">Enable audio</p>
          <p className="mt-1 text-xs text-slate-300">
            Your browser blocked the shared Grigliata music. Enable audio to hear what the DM is playing.
          </p>
          <button
            type="button"
            onClick={handleUnlockAudio}
            className="mt-3 rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-black transition-colors hover:bg-amber-300"
          >
            Enable Audio
          </button>
        </div>
      )}
    </>
  );
}
