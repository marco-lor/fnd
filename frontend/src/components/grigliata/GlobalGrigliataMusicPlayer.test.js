import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import GlobalGrigliataMusicPlayer, {
  MAX_GLOBAL_GRIGLIATA_MUSIC_AUDIO_NODES,
  MAX_GLOBAL_GRIGLIATA_MUSIC_SESSIONS,
  subscribeToGrigliataMusicPlayback,
  subscribeToGrigliataMusicPlaybackSessions,
} from './GlobalGrigliataMusicPlayer';
import { useAuth } from '../../AuthContext';
import * as firestoreRuntime from '../../performance/firestore';
import * as performanceRuntime from '../../performance/runtime';

const mockDocs = {};
const mockListeners = [];
let mockPlaybackSessions = [];
const mockSessionListeners = [];

const mockNotifyListeners = () => {
  mockListeners.forEach((listener) => {
    listener.onPlaybackState(mockDocs['grigliata_music_playback/current']);
  });
};

const setPlaybackDoc = (value) => {
  mockDocs['grigliata_music_playback/current'] = value;
  mockNotifyListeners();
};

const mockNotifySessionListeners = () => {
  mockSessionListeners.forEach((listener) => {
    listener.onPlaybackSessions(mockPlaybackSessions);
  });
};

const setPlaybackSessions = (value) => {
  mockPlaybackSessions = value;
  mockNotifySessionListeners();
};

const prepareAudioElement = (audio) => {
  let currentTime = 0;

  Object.defineProperty(audio, 'readyState', {
    configurable: true,
    get: () => 4,
  });

  Object.defineProperty(audio, 'currentTime', {
    configurable: true,
    get: () => currentTime,
    set: (value) => {
      currentTime = value;
    },
  });
};

jest.mock('../../AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../firebaseConfig', () => ({
  db: {},
}));

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  doc: jest.fn(),
  limit: jest.fn(),
  onSnapshot: jest.fn(),
  orderBy: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
}));

describe('GlobalGrigliataMusicPlayer', () => {
  let playSpy;
  let pauseSpy;
  let loadSpy;
  let dateNowSpy;
  let subscribeToPlaybackState;
  let subscribeToPlaybackSessions;

  beforeEach(() => {
    mockListeners.splice(0, mockListeners.length);
    mockSessionListeners.splice(0, mockSessionListeners.length);
    mockPlaybackSessions = [];
    mockDocs['grigliata_music_playback/current'] = {
      status: 'stopped',
      trackId: '',
      trackName: '',
      audioUrl: '',
      durationMs: 0,
      offsetMs: 0,
      volume: 0.65,
      startedAt: null,
      commandId: '',
      updatedBy: '',
    };

    useAuth.mockReturnValue({
      user: {
        uid: 'user-1',
      },
      userData: {
        settings: {},
      },
    });

    subscribeToPlaybackState = jest.fn((onPlaybackState) => {
      const listener = { onPlaybackState };
      mockListeners.push(listener);
      onPlaybackState(mockDocs['grigliata_music_playback/current']);

      return () => {
        const listenerIndex = mockListeners.indexOf(listener);
        if (listenerIndex >= 0) {
          mockListeners.splice(listenerIndex, 1);
        }
      };
    });

    subscribeToPlaybackSessions = jest.fn((onPlaybackSessions) => {
      const listener = { onPlaybackSessions };
      mockSessionListeners.push(listener);
      onPlaybackSessions(mockPlaybackSessions);

      return () => {
        const listenerIndex = mockSessionListeners.indexOf(listener);
        if (listenerIndex >= 0) {
          mockSessionListeners.splice(listenerIndex, 1);
        }
      };
    });

    playSpy = jest.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    pauseSpy = jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    loadSpy = jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(10_000);
  });

  afterEach(() => {
    playSpy.mockRestore();
    pauseSpy.mockRestore();
    loadSpy.mockRestore();
    dateNowSpy.mockRestore();
  });

  test('owns its global Firestore subscriptions as shell resources', () => {
    const playbackTarget = { path: 'grigliata_music_playback/current' };
    const sessionsTarget = { path: 'grigliata_music_playback_sessions' };
    const statusConstraint = { type: 'where-status-active' };
    const newestConstraint = { type: 'order-updated-desc' };
    const sessionLimitConstraint = { type: 'limit-active-sessions' };
    const sessionsQuery = { path: 'grigliata_music_playback_sessions?active' };
    firestoreRuntime.doc.mockReturnValueOnce(playbackTarget);
    firestoreRuntime.collection.mockReturnValueOnce(sessionsTarget);
    firestoreRuntime.where.mockReturnValueOnce(statusConstraint);
    firestoreRuntime.orderBy.mockReturnValueOnce(newestConstraint);
    firestoreRuntime.limit.mockReturnValueOnce(sessionLimitConstraint);
    firestoreRuntime.query.mockReturnValueOnce(sessionsQuery);
    const snapshotSpy = jest.spyOn(firestoreRuntime, 'onSnapshot').mockReturnValue(jest.fn());
    const ownerSpy = jest.spyOn(performanceRuntime, 'withAsyncResourceOwner');
    const labelSpy = jest.spyOn(firestoreRuntime, 'labelFirestoreTarget');

    try {
      subscribeToGrigliataMusicPlayback(jest.fn(), jest.fn());
      subscribeToGrigliataMusicPlaybackSessions(jest.fn(), jest.fn());

      expect(firestoreRuntime.where).toHaveBeenCalledWith('status', 'in', ['playing', 'paused']);
      expect(firestoreRuntime.orderBy).toHaveBeenCalledWith('updatedAt', 'desc');
      expect(firestoreRuntime.limit).toHaveBeenCalledWith(MAX_GLOBAL_GRIGLIATA_MUSIC_SESSIONS);
      expect(firestoreRuntime.query).toHaveBeenCalledWith(
        sessionsTarget,
        statusConstraint,
        newestConstraint,
        sessionLimitConstraint
      );
      expect(ownerSpy).toHaveBeenCalledTimes(2);
      expect(ownerSpy.mock.calls.every(([owner]) => owner === 'shell')).toBe(true);
      expect(labelSpy).toHaveBeenNthCalledWith(
        1,
        playbackTarget,
        'grigliata.music-playback.subscribe.v1',
        'shell'
      );
      expect(labelSpy).toHaveBeenNthCalledWith(
        2,
        sessionsQuery,
        'grigliata.music-sessions.subscribe.v1',
        'shell'
      );
    } finally {
      ownerSpy.mockRestore();
      labelSpy.mockRestore();
      snapshotSpy.mockRestore();
    }
  });

  test('reacts to playing, paused, and stopped playback states', async () => {
    const { container } = render(
      <GlobalGrigliataMusicPlayer subscribeToPlaybackState={subscribeToPlaybackState} />
    );
    const audio = container.querySelector('audio');
    prepareAudioElement(audio);

    await waitFor(() => {
      expect(subscribeToPlaybackState).toHaveBeenCalledTimes(1);
    });

    playSpy.mockClear();
    pauseSpy.mockClear();

    await act(async () => {
      setPlaybackDoc({
        status: 'playing',
        trackId: 'track-1',
        trackName: 'Battle Theme',
        audioUrl: 'https://example.com/audio/battle-theme.mp3',
        durationMs: 120_000,
        offsetMs: 2_000,
        volume: 0.35,
        startedAt: { toMillis: () => 7_000 },
        commandId: 'cmd-play',
        updatedBy: 'user-1',
      });
    });

    await waitFor(() => {
      expect(playSpy).toHaveBeenCalled();
    });

    expect(audio.currentTime).toBe(5);
    expect(audio.volume).toBeCloseTo(0.35);

    await act(async () => {
      setPlaybackDoc({
        status: 'paused',
        trackId: 'track-1',
        trackName: 'Battle Theme',
        audioUrl: 'https://example.com/audio/battle-theme.mp3',
        durationMs: 120_000,
        offsetMs: 9_000,
        volume: 0.48,
        startedAt: null,
        commandId: 'cmd-pause',
        updatedBy: 'user-1',
      });
    });

    await waitFor(() => {
      expect(audio.currentTime).toBe(9);
    });

    expect(pauseSpy).toHaveBeenCalled();
    expect(audio.volume).toBeCloseTo(0.48);

    await act(async () => {
      setPlaybackDoc({
        status: 'stopped',
        trackId: '',
        trackName: '',
        audioUrl: '',
        durationMs: 0,
        offsetMs: 0,
        volume: 0.2,
        startedAt: null,
        commandId: 'cmd-stop',
        updatedBy: 'user-1',
      });
    });

    await waitFor(() => {
      expect(audio.getAttribute('src')).toBe(null);
    });

    expect(audio.currentTime).toBe(0);
    expect(audio.volume).toBeCloseTo(0.2);
  });

  test('caps shared playback at one audio node and selects the newest bounded session', async () => {
    setPlaybackDoc({
      status: 'stopped',
      trackId: '',
      trackName: '',
      audioUrl: '',
      durationMs: 0,
      offsetMs: 0,
      volume: 0.4,
      startedAt: null,
      commandId: 'cmd-volume',
      updatedBy: 'user-1',
    });

    const { container } = render(
      <GlobalGrigliataMusicPlayer
        subscribeToPlaybackState={subscribeToPlaybackState}
        subscribeToPlaybackSessions={subscribeToPlaybackSessions}
      />
    );

    await waitFor(() => {
      expect(subscribeToPlaybackState).toHaveBeenCalledTimes(1);
      expect(subscribeToPlaybackSessions).toHaveBeenCalledTimes(1);
    });

    const activeSessions = [
      {
        id: 'track-1',
        status: 'playing',
        trackId: 'track-1',
        trackName: 'Battle Theme',
        audioUrl: 'https://example.com/audio/battle-theme.mp3',
        durationMs: 120_000,
        offsetMs: 2_000,
        loop: false,
        startedAt: { toMillis: () => 7_000 },
        commandId: 'cmd-battle',
        updatedBy: 'user-1',
      },
      {
        id: 'track-2',
        status: 'playing',
        trackId: 'track-2',
        trackName: 'Cavern Drone',
        audioUrl: 'https://example.com/audio/cavern-drone.mp3',
        durationMs: 240_000,
        offsetMs: 4_000,
        loop: true,
        startedAt: { toMillis: () => 9_000 },
        commandId: 'cmd-drone',
        updatedBy: 'user-1',
      },
    ];

    await act(async () => {
      setPlaybackSessions(activeSessions);
    });

    await waitFor(() => {
      expect(container.querySelectorAll('audio')).toHaveLength(MAX_GLOBAL_GRIGLIATA_MUSIC_AUDIO_NODES);
    });

    const audio = container.querySelector('audio');
    prepareAudioElement(audio);
    playSpy.mockClear();
    pauseSpy.mockClear();

    await act(async () => {
      setPlaybackSessions(activeSessions.map((session) => ({
        ...session,
        commandId: `${session.commandId}-resync`,
      })));
    });

    await waitFor(() => {
      expect(playSpy).toHaveBeenCalledTimes(1);
    });

    expect(audio.dataset.grigliataAudioUrl).toBe('https://example.com/audio/cavern-drone.mp3');
    expect(audio.currentTime).toBe(5);
    expect(audio.loop).toBe(true);
    expect(audio.volume).toBeCloseTo(0.4);

    await act(async () => {
      setPlaybackDoc({
        status: 'stopped',
        trackId: '',
        trackName: '',
        audioUrl: '',
        durationMs: 0,
        offsetMs: 0,
        volume: 0.22,
        startedAt: null,
        commandId: 'cmd-volume-2',
        updatedBy: 'user-1',
      });
    });

    await waitFor(() => {
      expect(audio.volume).toBeCloseTo(0.22);
    });

    await act(async () => {
      setPlaybackSessions([activeSessions[0]]);
    });

    await waitFor(() => {
      expect(container.querySelectorAll('audio')).toHaveLength(MAX_GLOBAL_GRIGLIATA_MUSIC_AUDIO_NODES);
    });
    expect(audio.getAttribute('src')).toBe(null);
    expect(container.querySelector('audio').dataset.grigliataAudioUrl).toBe(
      'https://example.com/audio/battle-theme.mp3'
    );
  });

  test('preserves the audio node across shell rerenders and disconnects it on sign-out', async () => {
    const { container, rerender } = render(
      <GlobalGrigliataMusicPlayer
        subscribeToPlaybackState={subscribeToPlaybackState}
        subscribeToPlaybackSessions={subscribeToPlaybackSessions}
      />
    );
    const audio = container.querySelector('audio');
    prepareAudioElement(audio);

    await waitFor(() => {
      expect(subscribeToPlaybackState).toHaveBeenCalledTimes(1);
      expect(subscribeToPlaybackSessions).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      setPlaybackDoc({
        status: 'playing',
        trackId: 'track-route',
        trackName: 'Persistent Theme',
        audioUrl: 'https://example.com/audio/persistent-theme.mp3',
        durationMs: 120_000,
        offsetMs: 3_000,
        volume: 0.5,
        startedAt: { toMillis: () => 9_000 },
        commandId: 'cmd-route',
        updatedBy: 'user-1',
      });
    });

    await waitFor(() => {
      expect(playSpy).toHaveBeenCalled();
    });

    const sourceBeforeRerender = audio.dataset.grigliataAudioUrl;
    const offsetBeforeRerender = audio.currentTime;
    rerender(
      <GlobalGrigliataMusicPlayer
        subscribeToPlaybackState={subscribeToPlaybackState}
        subscribeToPlaybackSessions={subscribeToPlaybackSessions}
      />
    );

    expect(container.querySelector('audio')).toBe(audio);
    expect(audio.dataset.grigliataAudioUrl).toBe(sourceBeforeRerender);
    expect(audio.currentTime).toBe(offsetBeforeRerender);
    expect(subscribeToPlaybackState).toHaveBeenCalledTimes(1);
    expect(subscribeToPlaybackSessions).toHaveBeenCalledTimes(1);

    useAuth.mockReturnValue({
      user: null,
      userData: null,
    });
    rerender(
      <GlobalGrigliataMusicPlayer
        subscribeToPlaybackState={subscribeToPlaybackState}
        subscribeToPlaybackSessions={subscribeToPlaybackSessions}
      />
    );

    await waitFor(() => {
      expect(container.querySelectorAll('audio')).toHaveLength(0);
    });
    expect(audio.getAttribute('src')).toBe(null);
    expect(mockListeners).toHaveLength(0);
    expect(mockSessionListeners).toHaveLength(0);
  });

  test('does not attach to an already finished playback session for late joiners', async () => {
    const { container } = render(
      <GlobalGrigliataMusicPlayer subscribeToPlaybackState={subscribeToPlaybackState} />
    );
    const audio = container.querySelector('audio');
    prepareAudioElement(audio);

    await waitFor(() => {
      expect(subscribeToPlaybackState).toHaveBeenCalledTimes(1);
    });

    playSpy.mockClear();
    pauseSpy.mockClear();

    await act(async () => {
      setPlaybackDoc({
        status: 'playing',
        trackId: 'track-1',
        trackName: 'Battle Theme',
        audioUrl: 'https://example.com/audio/battle-theme.mp3',
        durationMs: 6_000,
        offsetMs: 4_000,
        volume: 0.72,
        startedAt: { toMillis: () => 1_000 },
        commandId: 'cmd-expired',
        updatedBy: 'user-1',
      });
    });

    await waitFor(() => {
      expect(audio.currentTime).toBe(6);
    });

    expect(playSpy).not.toHaveBeenCalled();
    expect(pauseSpy).toHaveBeenCalled();
    expect(audio.volume).toBeCloseTo(0.72);
  });

  test('shows an unlock prompt when autoplay is blocked and retries on demand', async () => {
    const playError = new Error('Autoplay blocked');
    playError.name = 'NotAllowedError';
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    playSpy.mockImplementationOnce(() => Promise.reject(playError));

    try {
      const { container } = render(
        <GlobalGrigliataMusicPlayer subscribeToPlaybackState={subscribeToPlaybackState} />
      );
      const audio = container.querySelector('audio');
      prepareAudioElement(audio);

      await waitFor(() => {
        expect(subscribeToPlaybackState).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        setPlaybackDoc({
          status: 'playing',
          trackId: 'track-1',
          trackName: 'Battle Theme',
          audioUrl: 'https://example.com/audio/battle-theme.mp3',
          durationMs: 120_000,
          offsetMs: 0,
          volume: 0.28,
          startedAt: { toMillis: () => 9_000 },
          commandId: 'cmd-blocked',
          updatedBy: 'user-1',
        });
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /enable audio/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /enable audio/i }));

      await waitFor(() => {
        expect(playSpy).toHaveBeenCalledTimes(2);
      });

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /enable audio/i })).not.toBeInTheDocument();
      });

      expect(audio.volume).toBeCloseTo(0.28);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  test('loads zero audio bytes while muted and resumes at the shared offset after unmuting', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      useAuth.mockReturnValue({
        user: {
          uid: 'user-1',
        },
        userData: {
          settings: {
            grigliata_music_muted: true,
          },
        },
      });

      const { container, rerender } = render(
        <GlobalGrigliataMusicPlayer subscribeToPlaybackState={subscribeToPlaybackState} />
      );
      const audio = container.querySelector('audio');
      prepareAudioElement(audio);

      await waitFor(() => {
        expect(subscribeToPlaybackState).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        setPlaybackDoc({
          status: 'playing',
          trackId: 'track-1',
          trackName: 'Battle Theme',
          audioUrl: 'https://example.com/audio/battle-theme.mp3',
          durationMs: 120_000,
          offsetMs: 0,
          volume: 0.28,
          startedAt: { toMillis: () => 9_000 },
          commandId: 'cmd-muted',
          updatedBy: 'user-1',
        });
      });

      expect(playSpy).not.toHaveBeenCalled();
      expect(audio.muted).toBe(true);
      expect(audio.dataset.grigliataAudioUrl).toBeUndefined();
      expect(audio.getAttribute('src')).toBe(null);
      expect(audio.currentTime).toBe(0);
      expect(screen.queryByRole('button', { name: /enable audio/i })).not.toBeInTheDocument();

      useAuth.mockReturnValue({
        user: {
          uid: 'user-1',
        },
        userData: {
          settings: {
            grigliata_music_muted: false,
          },
        },
      });

      rerender(<GlobalGrigliataMusicPlayer subscribeToPlaybackState={subscribeToPlaybackState} />);

      await waitFor(() => {
        expect(playSpy).toHaveBeenCalledTimes(1);
      });

      expect(audio.muted).toBe(false);
      expect(audio.dataset.grigliataAudioUrl).toBe('https://example.com/audio/battle-theme.mp3');
      expect(audio.currentTime).toBe(1);
      expect(screen.queryByRole('button', { name: /enable audio/i })).not.toBeInTheDocument();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  test('logs and clears the shared audio source when loading fails during seek', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { container } = render(
        <GlobalGrigliataMusicPlayer subscribeToPlaybackState={subscribeToPlaybackState} />
      );
      const audio = container.querySelector('audio');
      let currentTime = 0;
      let canSeek = false;

      Object.defineProperty(audio, 'readyState', {
        configurable: true,
        get: () => 0,
      });

      Object.defineProperty(audio, 'currentTime', {
        configurable: true,
        get: () => currentTime,
        set: (value) => {
          if (!canSeek) {
            throw new Error('metadata unavailable');
          }

          currentTime = value;
        },
      });

      await waitFor(() => {
        expect(subscribeToPlaybackState).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        setPlaybackDoc({
          status: 'playing',
          trackId: 'track-1',
          trackName: 'Battle Theme',
          audioUrl: 'https://example.com/audio/battle-theme.mp3',
          durationMs: 120_000,
          offsetMs: 9_000,
          volume: 0.48,
          startedAt: null,
          commandId: 'cmd-load-failed',
          updatedBy: 'user-1',
        });
      });

      canSeek = true;

      await act(async () => {
        audio.dispatchEvent(new Event('error'));
      });

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to prepare Grigliata music playback:',
          expect.objectContaining({ name: 'GrigliataAudioLoadError' })
        );
      });

      expect(audio.getAttribute('src')).toBe(null);
      expect(screen.queryByRole('button', { name: /enable audio/i })).not.toBeInTheDocument();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  test('ignores interrupted play requests without showing the unlock prompt', async () => {
    const playError = new Error('The play() request was interrupted by a call to pause().');
    playError.name = 'AbortError';
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    playSpy.mockImplementationOnce(() => Promise.reject(playError));

    try {
      const { container } = render(
        <GlobalGrigliataMusicPlayer subscribeToPlaybackState={subscribeToPlaybackState} />
      );
      const audio = container.querySelector('audio');
      prepareAudioElement(audio);

      await waitFor(() => {
        expect(subscribeToPlaybackState).toHaveBeenCalledTimes(1);
      });

      await act(async () => {
        setPlaybackDoc({
          status: 'playing',
          trackId: 'track-1',
          trackName: 'Battle Theme',
          audioUrl: 'https://example.com/audio/battle-theme.mp3',
          durationMs: 120_000,
          offsetMs: 0,
          volume: 0.45,
          startedAt: { toMillis: () => 9_000 },
          commandId: 'cmd-aborted',
          updatedBy: 'user-1',
        });
      });

      await waitFor(() => {
        expect(playSpy).toHaveBeenCalled();
      });

      expect(screen.queryByRole('button', { name: /enable audio/i })).not.toBeInTheDocument();
      expect(audio.volume).toBeCloseTo(0.45);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
