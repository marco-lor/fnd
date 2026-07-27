import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthContext } from '../../AuthContext';
import { loadTask07MediaMode } from './task07MediaControl';
import useTask07MediaReadMode from './useTask07MediaReadMode';

jest.mock('./task07MediaControl', () => ({
  TASK07_MEDIA_MODES: [
    'legacy',
    'shadow',
    'derivative-read',
    'v1-write',
  ],
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

  test('stays legacy until the exact actor and purpose cohort resolves', async () => {
    loadTask07MediaMode.mockResolvedValue('derivative-read');
    actorWrapper(<Probe purpose="avatar" />);

    expect(screen.getByTestId('mode')).toHaveTextContent('legacy');
    await waitFor(() => {
      expect(screen.getByTestId('mode')).toHaveTextContent('derivative-read');
    });
    expect(loadTask07MediaMode).toHaveBeenCalledWith({
      purpose: 'avatar',
      role: 'player',
      uid: 'user-1',
    });
  });

  test('does not read rollout config without a complete actor or purpose', () => {
    actorWrapper(<Probe purpose="" />, {role: '', uid: 'user-1'});
    expect(screen.getByTestId('mode')).toHaveTextContent('legacy');
    expect(loadTask07MediaMode).not.toHaveBeenCalled();
  });

  test.each(['legacy', 'shadow', 'derivative-read', 'v1-write'])(
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

  test('fails a rejected control read closed to legacy', async () => {
    loadTask07MediaMode.mockRejectedValue(new Error('denied'));
    actorWrapper(<Probe purpose="map" />, {role: 'dm'});

    await waitFor(() => {
      expect(loadTask07MediaMode).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('mode')).toHaveTextContent('legacy');
  });
});
