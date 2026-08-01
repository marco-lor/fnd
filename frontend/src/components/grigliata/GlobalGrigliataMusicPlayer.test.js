import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import GlobalGrigliataMusicPlayer, {
  buildLegacyGrigliataMusicStream,
  EMPTY_GRIGLIATA_MUSIC_STREAM,
  GRIGLIATA_MUSIC_STREAM_COLLECTION,
  GRIGLIATA_MUSIC_STREAM_DOC_ID,
  MAX_GLOBAL_GRIGLIATA_MUSIC_AUDIO_NODES,
  MAX_GLOBAL_GRIGLIATA_MUSIC_SESSIONS,
  isTask07MusicStreamRevisionAccepted,
  normalizeGrigliataMusicStream,
  subscribeToGrigliataMusicStream,
  task07MusicStreamsMatch,
} from './GlobalGrigliataMusicPlayer';
import { useAuth } from '../../AuthContext';
import * as firestoreRuntime from '../../performance/firestore';
import * as performanceRuntime from '../../performance/runtime';

jest.mock('../../AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../firebaseConfig', () => ({ db: { name: 'test-db' } }));
jest.mock('../../performance/firestore', () => ({
  collection: jest.fn(),
  doc: jest.fn(),
  labelFirestoreTarget: jest.fn((target) => target),
  onSnapshot: jest.fn(),
}));
jest.mock('../../performance/runtime', () => ({
  withAsyncResourceOwner: jest.fn((_owner, callback) => callback()),
}));

const makeSession = (id, overrides = {}) => {
  const mediaAssetId = `m_${'a'.repeat(40)}`;
  const ownerUid = `owner-${id}`;
  return {
    id,
    status: overrides.status || 'playing',
    trackId: id,
    trackName: `Track ${id}`,
    mediaAssetId,
    media: {
      schemaVersion: 1,
      contractVersion: 1,
      assetId: mediaAssetId,
      kind: 'music',
      state: 'ready',
      generation: '7',
      audience: 'signed-in',
      ownerUid,
      original: {
        path: `media_assets/v1/signed-in/${ownerUid}/${mediaAssetId}/7/original`,
        contentType: 'audio/mpeg',
        bytes: 4096,
        durationMs: 120000,
        width: 0,
        height: 0,
        generation: '9',
      },
    },
    durationMs: 120000,
    offsetMs: 2000,
    loop: false,
    startedAtMs: overrides.status === 'paused' || overrides.status === 'stopped' ? 0 : 9000,
    updatedAtMs: 9000,
    updatedAt: new Date(9000),
    ...overrides,
  };
};

const makeLegacySession = (id, overrides = {}) => {
  const { media, mediaAssetId, ...session } = makeSession(id, overrides);
  return {
    ...session,
    audioUrl: `https://example.com/audio/${id}.mp3`,
  };
};

const makeStream = (sessions = [], overrides = {}) => ({
  schemaVersion: 2,
  controlMode: 'canonical-only',
  revision: 1,
  volume: 0.4,
  sessions,
  sourceHash: 'a'.repeat(64),
  updatedAt: new Date('2026-07-27T00:00:00.000Z'),
  ...overrides,
});

describe('GlobalGrigliataMusicPlayer', () => {
  let authState;
  let streamHandlers;
  let subscribeToMusicStream;
  let unsubscribe;
  let playSpy;
  let pauseSpy;
  let loadSpy;
  let dateNowSpy;
  let originalReadyState;
  let originalCurrentTime;
  let mediaTimes;
  let acquireAudioAsset;
  let audioLeaseReleases;

  const candidatePlayer = () => (
    <GlobalGrigliataMusicPlayer
      acquireAudioAsset={acquireAudioAsset}
      musicModeOverride="derivative-read"
      subscribeToMusicStream={subscribeToMusicStream}
    />
  );

  const emitStream = async (stream) => {
    await act(async () => {
      streamHandlers.onMusicStream(stream);
    });
  };

  beforeEach(() => {
    audioLeaseReleases = [];
    acquireAudioAsset = jest.fn((descriptor) => {
      const release = jest.fn();
      audioLeaseReleases.push(release);
      return {
        promise: Promise.resolve({url: `blob:private-${descriptor.path}`}),
        release,
      };
    });
    authState = { user: { uid: 'user-1' }, userData: { settings: {} } };
    useAuth.mockImplementation(() => authState);
    unsubscribe = jest.fn();
    streamHandlers = null;
    subscribeToMusicStream = jest.fn((onMusicStream, onError) => {
      streamHandlers = { onMusicStream, onError };
      onMusicStream(makeStream());
      return unsubscribe;
    });

    firestoreRuntime.doc.mockReset();
    firestoreRuntime.labelFirestoreTarget.mockReset();
    firestoreRuntime.labelFirestoreTarget.mockImplementation((target) => target);
    firestoreRuntime.onSnapshot.mockReset();
    performanceRuntime.withAsyncResourceOwner.mockClear();
    performanceRuntime.withAsyncResourceOwner.mockImplementation((_owner, callback) => callback());

    mediaTimes = new WeakMap();
    originalReadyState = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState');
    originalCurrentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get: () => 4,
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get() { return mediaTimes.get(this) || 0; },
      set(value) { mediaTimes.set(this, value); },
    });
    playSpy = jest.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    pauseSpy = jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    loadSpy = jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(10000);
  });

  afterEach(() => {
    playSpy.mockRestore();
    pauseSpy.mockRestore();
    loadSpy.mockRestore();
    dateNowSpy.mockRestore();
    if (originalReadyState) {
      Object.defineProperty(HTMLMediaElement.prototype, 'readyState', originalReadyState);
    } else {
      delete HTMLMediaElement.prototype.readyState;
    }
    if (originalCurrentTime) {
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', originalCurrentTime);
    } else {
      delete HTMLMediaElement.prototype.currentTime;
    }
  });

  test('owns exactly one authenticated-shell listener on the compact stream document', () => {
    const target = { path: 'grigliata_music_stream/current' };
    const onMusicStream = jest.fn();
    const snapshotUnsubscribe = jest.fn();
    firestoreRuntime.doc.mockReturnValue(target);
    firestoreRuntime.onSnapshot.mockReturnValue(snapshotUnsubscribe);

    const result = subscribeToGrigliataMusicStream(onMusicStream, jest.fn());

    expect(firestoreRuntime.doc).toHaveBeenCalledWith(
      expect.any(Object),
      GRIGLIATA_MUSIC_STREAM_COLLECTION,
      GRIGLIATA_MUSIC_STREAM_DOC_ID
    );
    expect(firestoreRuntime.labelFirestoreTarget).toHaveBeenCalledWith(
      target,
      'grigliata.music-stream.subscribe.v1',
      'shell'
    );
    expect(firestoreRuntime.onSnapshot).toHaveBeenCalledTimes(1);
    expect(performanceRuntime.withAsyncResourceOwner).toHaveBeenCalledTimes(1);
    expect(performanceRuntime.withAsyncResourceOwner).toHaveBeenCalledWith('shell', expect.any(Function));
    expect(result).toBe(snapshotUnsubscribe);
  });

  test('requires the exact versioned envelope and rejects revision downgrade or conflict', () => {
    const diagnostic = jest.fn();
    const invalidStreams = [
      makeStream([], { schemaVersion: 1 }),
      makeStream([], { revision: 0 }),
      makeStream([], { sourceHash: 'not-a-hash' }),
      makeStream([], { updatedAt: null }),
      makeStream([], { volume: '0.4' }),
    ];
    invalidStreams.forEach((stream) => {
      expect(normalizeGrigliataMusicStream(stream, diagnostic))
        .toBe(EMPTY_GRIGLIATA_MUSIC_STREAM);
    });
    expect(diagnostic).toHaveBeenCalledTimes(invalidStreams.length);
    expect(diagnostic).toHaveBeenCalledWith('invalid-envelope', 0);

    const revisionTwo = normalizeGrigliataMusicStream(makeStream([], {
      revision: 2,
      sourceHash: 'b'.repeat(64),
    }), diagnostic);
    const same = normalizeGrigliataMusicStream(makeStream([], {
      revision: 2,
      sourceHash: 'b'.repeat(64),
    }), diagnostic);
    const conflict = normalizeGrigliataMusicStream(makeStream([], {
      revision: 2,
      sourceHash: 'c'.repeat(64),
    }), diagnostic);
    const rollback = normalizeGrigliataMusicStream(makeStream([], {
      revision: 1,
      sourceHash: 'a'.repeat(64),
    }), diagnostic);
    expect(isTask07MusicStreamRevisionAccepted(revisionTwo, same)).toBe(true);
    expect(isTask07MusicStreamRevisionAccepted(revisionTwo, conflict)).toBe(false);
    expect(isTask07MusicStreamRevisionAccepted(revisionTwo, rollback)).toBe(false);
  });

  test('legacy compatibility preserves session precedence and matches the projection', () => {
    const playbackState = {
      status: 'playing',
      trackId: 'legacy-track',
      trackName: 'Legacy track',
      audioUrl: 'https://example.com/audio/legacy.mp3',
      durationMs: 120000,
      offsetMs: 2000,
      volume: 0.4,
      startedAt: new Date(8000),
      updatedAt: new Date(9000),
    };
    const activeSession = makeLegacySession('session-track');
    const legacy = buildLegacyGrigliataMusicStream({
      playbackState,
      playbackSessions: [activeSession],
    });
    expect(legacy.sessions.map(({ id }) => id)).toEqual(['session-track']);
    const projected = normalizeGrigliataMusicStream(
      makeStream([makeSession('session-track')])
    );
    expect(task07MusicStreamsMatch(legacy, projected)).toBe(true);
    expect(task07MusicStreamsMatch(legacy, {
      ...projected,
      volume: 0.5,
    })).toBe(false);

    const fallback = buildLegacyGrigliataMusicStream({
      playbackState,
      playbackSessions: [],
    });
    expect(fallback.sessions).toEqual([
      expect.objectContaining({
        id: 'legacy-current',
        trackId: 'legacy-track',
        startedAtMs: 8000,
        updatedAtMs: 9000,
      }),
    ]);
  });

  test('rollout modes retain legacy playback, compare in shadow, and switch to one stream', async () => {
    const legacyState = jest.fn((onValue) => {
      onValue({ status: 'stopped', volume: 0.4 });
      return jest.fn();
    });
    const legacySessions = jest.fn((onValue) => {
      onValue([makeLegacySession('legacy')]);
      return jest.fn();
    });
    const stream = jest.fn((onValue) => {
      onValue(makeStream([makeSession('legacy')]));
      return jest.fn();
    });
    const paritySpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    const { rerender } = render(
      <GlobalGrigliataMusicPlayer
        acquireAudioAsset={acquireAudioAsset}
        musicModeOverride="legacy"
        subscribeToPlaybackState={legacyState}
        subscribeToPlaybackSessions={legacySessions}
        subscribeToMusicStream={stream}
      />
    );
    expect(legacyState).toHaveBeenCalledTimes(1);
    expect(legacySessions).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();

    rerender(
      <GlobalGrigliataMusicPlayer
        acquireAudioAsset={acquireAudioAsset}
        musicModeOverride="shadow"
        subscribeToPlaybackState={legacyState}
        subscribeToPlaybackSessions={legacySessions}
        subscribeToMusicStream={stream}
      />
    );
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(paritySpy).toHaveBeenCalledWith(
      'Task07 music shadow parity.',
      expect.objectContaining({ matches: true })
    ));

    rerender(
      <GlobalGrigliataMusicPlayer
        acquireAudioAsset={acquireAudioAsset}
        musicModeOverride="derivative-read"
        subscribeToPlaybackState={legacyState}
        subscribeToPlaybackSessions={legacySessions}
        subscribeToMusicStream={stream}
      />
    );
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
    expect(legacyState).toHaveBeenCalledTimes(2);
    expect(legacySessions).toHaveBeenCalledTimes(2);
    paritySpy.mockRestore();
  });

  test('renders zero audio nodes for empty, paused, stopped, and locally muted playback', async () => {
    const { container, rerender } = render(
      candidatePlayer()
    );
    expect(container.querySelectorAll('audio')).toHaveLength(0);

    await emitStream(makeStream([makeSession('paused', { status: 'paused' })]));
    expect(container.querySelectorAll('audio')).toHaveLength(0);
    expect(playSpy).not.toHaveBeenCalled();

    await emitStream(makeStream());
    expect(container.querySelectorAll('audio')).toHaveLength(0);

    await emitStream(makeStream([
      makeSession('finished', { durationMs: 1000, offsetMs: 1000, startedAtMs: 1000 }),
    ]));
    expect(container.querySelectorAll('audio')).toHaveLength(0);

    authState = {
      user: { uid: 'user-1' },
      userData: { settings: { grigliata_music_muted: true } },
    };
    rerender(candidatePlayer());
    await emitStream(makeStream([makeSession('muted')]));
    expect(container.querySelectorAll('audio')).toHaveLength(0);
    expect(playSpy).not.toHaveBeenCalled();
    expect(subscribeToMusicStream).toHaveBeenCalledTimes(1);
  });

  test('renders and plays up to four preload-none sessions with authoritative offsets and loop state', async () => {
    const sessions = [
      makeSession('track-1'),
      makeSession('track-2', { loop: true, durationMs: 2500 }),
      makeSession('track-3', { offsetMs: 7000 }),
      makeSession('track-4', { offsetMs: 0 }),
    ];
    const { container } = render(
      candidatePlayer()
    );
    await emitStream(makeStream(sessions, { volume: 0.27 }));

    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(4));
    const audioNodes = container.querySelectorAll('audio');
    expect(audioNodes).toHaveLength(MAX_GLOBAL_GRIGLIATA_MUSIC_AUDIO_NODES);
    expect(MAX_GLOBAL_GRIGLIATA_MUSIC_AUDIO_NODES).toBe(MAX_GLOBAL_GRIGLIATA_MUSIC_SESSIONS);
    audioNodes.forEach((audio) => {
      expect(audio.getAttribute('preload')).toBe('none');
      expect(audio.volume).toBeCloseTo(0.27);
      expect(audio.dataset.grigliataAudioUrl).toMatch(/^blob:private-media_assets\//);
      expect(audio.src).toMatch(/^blob:private-media_assets\//);
    });

    const firstAudio = container.querySelector('audio[data-session-id=track-1]');
    const loopingAudio = container.querySelector('audio[data-session-id=track-2]');
    expect(firstAudio.currentTime).toBe(3);
    expect(firstAudio.loop).toBe(false);
    expect(loopingAudio.currentTime).toBe(0.5);
    expect(loopingAudio.loop).toBe(true);
  });

  test('fails closed above the cap with a count-only diagnostic and clears owned sources', async () => {
    const diagnosticSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { container } = render(
        candidatePlayer()
      );
      await emitStream(makeStream([makeSession('owned')]));
      await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1));
      const previousAudio = container.querySelector('audio');
      expect(previousAudio.dataset.grigliataAudioUrl).toContain('/owner-owned/');

      const overCapSessions = Array.from(
        { length: MAX_GLOBAL_GRIGLIATA_MUSIC_SESSIONS + 1 },
        (_, index) => makeSession(`secret-${index}`)
      );
      await emitStream(makeStream(overCapSessions));

      await waitFor(() => expect(container.querySelectorAll('audio')).toHaveLength(0));
      expect(previousAudio.getAttribute('src')).toBe(null);
      expect(previousAudio.dataset.grigliataAudioUrl).toBeUndefined();
      expect(diagnosticSpy).toHaveBeenCalledWith(
        'Rejected invalid Grigliata music stream.',
        { reason: 'over-cap', sessionCount: 5, maxSessions: 4 }
      );
      expect(JSON.stringify(diagnosticSpy.mock.calls)).not.toContain('secret-');
    } finally {
      diagnosticSpy.mockRestore();
    }
  });

  test('removes the node and source when a playing session becomes paused', async () => {
    const { container } = render(
      candidatePlayer()
    );
    await emitStream(makeStream([makeSession('pause-me')]));
    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1));
    const previousAudio = container.querySelector('audio');

    await emitStream(makeStream([makeSession('pause-me', { status: 'paused', offsetMs: 8000 })]));

    await waitFor(() => expect(container.querySelectorAll('audio')).toHaveLength(0));
    expect(previousAudio.getAttribute('src')).toBe(null);
    expect(previousAudio.currentTime).toBe(0);
    expect(pauseSpy).toHaveBeenCalled();
  });

  test('natural completion removes the node and clears its source ownership', async () => {
    const { container } = render(candidatePlayer());
    await emitStream(makeStream([makeSession('ended')]));
    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1));
    const audio = container.querySelector('audio');
    fireEvent.ended(audio);
    await waitFor(() => expect(container.querySelectorAll('audio')).toHaveLength(0));
    expect(audio.getAttribute('src')).toBe(null);
    expect(audio.dataset.grigliataAudioUrl).toBeUndefined();
  });

  test('mute fences an in-flight play and releases the pending source', async () => {
    let resolvePlay;
    playSpy.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePlay = resolve;
    }));
    const { container, rerender } = render(candidatePlayer());
    await emitStream(makeStream([makeSession('pending')]));
    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1));
    const audio = container.querySelector('audio');

    authState = {
      user: { uid: 'user-1' },
      userData: { settings: { grigliata_music_muted: true } },
    };
    rerender(candidatePlayer());
    await waitFor(() => expect(container.querySelectorAll('audio')).toHaveLength(0));
    await act(async () => resolvePlay());
    expect(audio.getAttribute('src')).toBe(null);
    expect(audio.dataset.grigliataAudioUrl).toBeUndefined();
  });

  test('keeps audio nodes stable across shell rerenders without resubscribing or restarting', async () => {
    const { container, rerender } = render(
      candidatePlayer()
    );
    await emitStream(makeStream([makeSession('navigation')]));
    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1));
    const audioBeforeNavigation = container.querySelector('audio');
    const offsetBeforeNavigation = audioBeforeNavigation.currentTime;
    playSpy.mockClear();

    rerender(candidatePlayer());

    expect(container.querySelector('audio')).toBe(audioBeforeNavigation);
    expect(audioBeforeNavigation.currentTime).toBe(offsetBeforeNavigation);
    expect(subscribeToMusicStream).toHaveBeenCalledTimes(1);
    expect(playSpy).not.toHaveBeenCalled();
  });

  test('loads no node while muted and computes the current offset after unmuting', async () => {
    authState = {
      user: { uid: 'user-1' },
      userData: { settings: { grigliata_music_muted: true } },
    };
    const { container, rerender } = render(
      candidatePlayer()
    );
    await emitStream(makeStream([makeSession('resume', { offsetMs: 4000, startedAtMs: 8000 })]));
    expect(container.querySelectorAll('audio')).toHaveLength(0);
    expect(playSpy).not.toHaveBeenCalled();

    authState = { user: { uid: 'user-1' }, userData: { settings: {} } };
    rerender(candidatePlayer());

    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1));
    const audio = container.querySelector('audio');
    expect(audio.currentTime).toBe(6);
    expect(audio.getAttribute('preload')).toBe('none');
    expect(subscribeToMusicStream).toHaveBeenCalledTimes(1);
  });

  test('shows one unlock prompt for blocked autoplay and retries every playing session', async () => {
    const autoplayError = new Error('Autoplay blocked');
    autoplayError.name = 'NotAllowedError';
    playSpy.mockRejectedValueOnce(autoplayError);
    const { container } = render(
      candidatePlayer()
    );
    await emitStream(makeStream([makeSession('blocked-1'), makeSession('blocked-2')]));

    await waitFor(() => expect(screen.getByRole('button', { name: /enable audio/i })).toBeInTheDocument());
    expect(container.querySelectorAll('audio')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /enable audio/i }));

    await waitFor(() => expect(playSpy.mock.calls.length).toBeGreaterThanOrEqual(4));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /enable audio/i })).not.toBeInTheDocument();
    });
  });

  test('sign-out disconnects the one listener and clears node ownership and source state', async () => {
    const { container, rerender } = render(
      candidatePlayer()
    );
    await emitStream(makeStream([makeSession('sign-out')]));
    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1));
    const previousAudio = container.querySelector('audio');

    authState = { user: null, userData: null };
    rerender(candidatePlayer());

    await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
    expect(container.querySelectorAll('audio')).toHaveLength(0);
    expect(previousAudio.getAttribute('src')).toBe(null);
    expect(previousAudio.dataset.grigliataAudioUrl).toBeUndefined();
    expect(audioLeaseReleases.some((release) => release.mock.calls.length > 0)).toBe(true);
  });

  test('fails closed and clears playback when the compact stream listener disconnects', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { container } = render(
        candidatePlayer()
      );
      await emitStream(makeStream([makeSession('disconnect')]));
      await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1));

      await act(async () => {
        streamHandlers.onError(new Error('private details'));
      });

      await waitFor(() => expect(container.querySelectorAll('audio')).toHaveLength(0));
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to load the Grigliata music stream.');
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain('private details');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
