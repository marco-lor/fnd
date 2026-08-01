import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthContext } from '../../AuthContext';
import { loadTask07MediaMode } from './task07MediaControl';
import useTask07MediaReadMode, {
  TASK07_MEDIA_CONTROL_RETRY_MS,
} from './useTask07MediaReadMode';

jest.mock('./task07MediaControl', () => ({
  TASK07_MEDIA_MODES: [
    'legacy',
    'shadow',
    'derivative-read',
    'v1-write',
    'canonical-only',
  ],
  TASK07_MEDIA_PENDING_MODE: 'pending',
  loadTask07MediaMode: jest.fn(),
}));

const Probe = ({override = 'auto', purpose = 'avatar'}) => {
  const mode = useTask07MediaReadMode({override, purpose});
  return <span data-testid="mode">{mode}</span>;
};

const actorWrapper = (ui, {
  role = 'player',
  uid = 'user-1',
} = {}) => render(
  <AuthContext.Provider value={{
    user: uid ? {uid} : null,
    userData: role ? {role} : null,
  }}>
    {ui}
  </AuthContext.Provider>
);

describe('useTask07MediaReadMode', () => {
  beforeEach(() => {
    loadTask07MediaMode.mockReset();
  });

  test('stays non-fetching pending until the exact actor and purpose cohort resolves', async () => {
    loadTask07MediaMode.mockResolvedValue('derivative-read');
    actorWrapper(<Probe purpose="avatar" />);

    expect(screen.getByTestId('mode')).toHaveTextContent('pending');
    await waitFor(() => {
      expect(screen.getByTestId('mode')).toHaveTextContent('derivative-read');
    });
    expect(loadTask07MediaMode).toHaveBeenCalledWith({
      purpose: 'avatar',
      role: 'player',
      uid: 'user-1',
    });
  });

  test('keeps an authenticated actor non-fetching while its role is pending', () => {
    actorWrapper(<Probe purpose="" />, {role: '', uid: 'user-1'});
    expect(screen.getByTestId('mode')).toHaveTextContent('pending');
    expect(loadTask07MediaMode).not.toHaveBeenCalled();
  });

  test('keeps logged-out media on the legacy contract without a config read', () => {
    actorWrapper(<Probe purpose="avatar" />, {role: '', uid: ''});
    expect(screen.getByTestId('mode')).toHaveTextContent('legacy');
    expect(loadTask07MediaMode).not.toHaveBeenCalled();
  });

  test('resolves an empty inferred purpose through wildcard rollout controls', async () => {
    loadTask07MediaMode.mockResolvedValue('canonical-only');
    actorWrapper(<Probe purpose="" />);

    expect(screen.getByTestId('mode')).toHaveTextContent('pending');
    await waitFor(() => {
      expect(screen.getByTestId('mode')).toHaveTextContent('canonical-only');
    });
    expect(loadTask07MediaMode).toHaveBeenCalledWith({
      purpose: '',
      role: 'player',
      uid: 'user-1',
    });
  });

  test.each(['legacy', 'shadow', 'derivative-read', 'v1-write', 'canonical-only'])(
    'honors explicit %s drills synchronously without a config read',
    (override) => {
      actorWrapper(<Probe override={override} />);
      expect(screen.getByTestId('mode')).toHaveTextContent(override);
      expect(loadTask07MediaMode).not.toHaveBeenCalled();
    }
  );

  test('fails an unknown explicit override closed without a config read', () => {
    actorWrapper(<Probe override="unexpected-mode" />);
    expect(screen.getByTestId('mode')).toHaveTextContent('legacy');
    expect(loadTask07MediaMode).not.toHaveBeenCalled();
  });

  test('keeps a rejected control read pending and retries it', async () => {
    jest.useFakeTimers();
    try {
      loadTask07MediaMode
        .mockRejectedValueOnce(new Error('denied'))
        .mockResolvedValueOnce('canonical-only');
      actorWrapper(<Probe purpose="map" />, {role: 'dm'});

      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByTestId('mode')).toHaveTextContent('pending');
      expect(loadTask07MediaMode).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(TASK07_MEDIA_CONTROL_RETRY_MS);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(loadTask07MediaMode).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('mode')).toHaveTextContent('canonical-only');
    } finally {
      jest.useRealTimers();
    }
  });
});
