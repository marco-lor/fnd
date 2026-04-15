import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import GlobalGrigliataMusicPlayer from './GlobalGrigliataMusicPlayer';
import { useAuth } from '../../AuthContext';

const mockDocs = {};
const mockListeners = [];

const mockNotifyListeners = () => {
  mockListeners.forEach((listener) => {
    listener.onPlaybackState(mockDocs['grigliata_music_playback/current']);
  });
};

const setPlaybackDoc = (value) => {
  mockDocs['grigliata_music_playback/current'] = value;
  mockNotifyListeners();
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
  doc: jest.fn(),
  onSnapshot: jest.fn(),
}));

describe('GlobalGrigliataMusicPlayer', () => {
  let playSpy;
  let pauseSpy;
  let loadSpy;
  let dateNowSpy;
  let subscribeToPlaybackState;

  beforeEach(() => {
    mockListeners.splice(0, mockListeners.length);
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
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  test('keeps playback muted until the player unmutes without resetting the current source or offset', async () => {
    const playError = new Error('Autoplay blocked');
    playError.name = 'NotAllowedError';
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    playSpy.mockImplementationOnce(() => Promise.reject(playError));

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

      await waitFor(() => {
        expect(playSpy).toHaveBeenCalledTimes(1);
      });

      expect(audio.muted).toBe(true);
      expect(audio.dataset.grigliataAudioUrl).toBe('https://example.com/audio/battle-theme.mp3');
      expect(audio.currentTime).toBe(1);
      expect(screen.queryByRole('button', { name: /enable audio/i })).not.toBeInTheDocument();

      const syncedAudioUrl = audio.dataset.grigliataAudioUrl;
      const syncedOffsetSeconds = audio.currentTime;

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
        expect(playSpy).toHaveBeenCalledTimes(2);
      });

      expect(audio.muted).toBe(false);
      expect(audio.dataset.grigliataAudioUrl).toBe(syncedAudioUrl);
      expect(audio.currentTime).toBe(syncedOffsetSeconds);
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
          status: 'paused',
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
