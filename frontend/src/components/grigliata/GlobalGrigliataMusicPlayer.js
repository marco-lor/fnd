import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { useAuth } from '../../AuthContext';
import {
  computeGrigliataMusicPlaybackOffsetMs,
  EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE,
  GRIGLIATA_MUSIC_PLAYBACK_COLLECTION,
  GRIGLIATA_MUSIC_PLAYBACK_DOC_ID,
  GRIGLIATA_MUSIC_PLAYBACK_STATUSES,
  normalizeGrigliataMusicPlaybackState,
} from './music';

const clearAudioSource = (audio) => {
  if (!audio) return;

  audio.pause();
  audio.currentTime = 0;
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
    // Ignore load errors here and let audio.play surface them if needed.
  }
};

const applyAudioVolume = (audio, volume) => {
  if (!audio) return;

  audio.volume = Math.min(1, Math.max(0, Number(volume || 0)));
};

const isAutoplayBlockedError = (error) => {
  const errorMessage = String(error?.message || '').toLowerCase();
  return error?.name === 'NotAllowedError'
    || errorMessage.includes('autoplay')
    || errorMessage.includes('user gesture');
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
    trySeekImmediately();
    return;
  }

  if (trySeekImmediately()) {
    return;
  }

  await new Promise((resolve) => {
    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('error', handleError);
    };

    const handleLoadedMetadata = () => {
      cleanup();
      audio.currentTime = resolvedSeconds;
      resolve();
    };

    const handleError = () => {
      cleanup();
      resolve();
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
        ? normalizeGrigliataMusicPlaybackState(snapshot.data())
        : EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE
    );
  },
  onError
);

export default function GlobalGrigliataMusicPlayer({
  subscribeToPlaybackState = subscribeToGrigliataMusicPlayback,
}) {
  const { user } = useAuth();
  const audioRef = useRef(null);
  const [playbackState, setPlaybackState] = useState(EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE);
  const [isUnlockPromptVisible, setIsUnlockPromptVisible] = useState(false);

  useEffect(() => {
    if (!user?.uid) {
      setPlaybackState(EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE);
      setIsUnlockPromptVisible(false);
      clearAudioSource(audioRef.current);
      return undefined;
    }

    const unsubscribe = subscribeToPlaybackState(
      (nextPlaybackState) => {
        setPlaybackState(nextPlaybackState || EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE);
      },
      (error) => {
        console.error('Failed to load Grigliata music playback state:', error);
        setPlaybackState(EMPTY_GRIGLIATA_MUSIC_PLAYBACK_STATE);
      }
    );

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [subscribeToPlaybackState, user?.uid]);

  const normalizedPlaybackState = useMemo(
    () => normalizeGrigliataMusicPlaybackState(playbackState),
    [playbackState]
  );

  const applyPlaybackState = useCallback(async (nextPlaybackState) => {
    const audio = audioRef.current;
    if (!audio) return;

    const normalizedState = normalizeGrigliataMusicPlaybackState(nextPlaybackState);
    applyAudioVolume(audio, normalizedState.volume);

    if (
      normalizedState.status === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.STOPPED
      || !normalizedState.audioUrl
    ) {
      setIsUnlockPromptVisible(false);
      clearAudioSource(audio);
      return;
    }

    await ensureAudioSource(audio, normalizedState.audioUrl);

    if (normalizedState.status === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PAUSED) {
      await seekAudio(audio, normalizedState.offsetMs / 1000);
      audio.pause();
      setIsUnlockPromptVisible(false);
      return;
    }

    const targetOffsetMs = computeGrigliataMusicPlaybackOffsetMs(normalizedState);
    if (normalizedState.durationMs > 0 && targetOffsetMs >= normalizedState.durationMs) {
      await seekAudio(audio, normalizedState.durationMs / 1000);
      audio.pause();
      setIsUnlockPromptVisible(false);
      return;
    }

    await seekAudio(audio, targetOffsetMs / 1000);

    try {
      await audio.play();
      setIsUnlockPromptVisible(false);
    } catch (error) {
      if (error?.name === 'AbortError') {
        return;
      }

      if (isAutoplayBlockedError(error)) {
        console.error('Grigliata music playback was blocked by the browser:', error);
        setIsUnlockPromptVisible(true);
        return;
      }

      console.error('Failed to start Grigliata music playback:', error);
      setIsUnlockPromptVisible(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const syncPlayback = async () => {
      if (cancelled) return;
      await applyPlaybackState(normalizedPlaybackState);
    };

    void syncPlayback();

    return () => {
      cancelled = true;
    };
  }, [applyPlaybackState, normalizedPlaybackState]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const handleEnded = () => {
      setIsUnlockPromptVisible(false);
    };

    audio.addEventListener('ended', handleEnded);
    return () => audio.removeEventListener('ended', handleEnded);
  }, []);

  const handleUnlockAudio = useCallback(async () => {
    await applyPlaybackState(normalizedPlaybackState);
  }, [applyPlaybackState, normalizedPlaybackState]);

  return (
    <>
      <audio
        ref={audioRef}
        preload="auto"
        className="hidden"
        aria-hidden="true"
      />

      {isUnlockPromptVisible && normalizedPlaybackState.status === GRIGLIATA_MUSIC_PLAYBACK_STATUSES.PLAYING && (
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
