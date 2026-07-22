import React from 'react';
import { render } from '@testing-library/react';
import Codex from './Codex';
import { useAuth } from '../../AuthContext';
import { subscribeCodex } from '../../data/codexRepository';

jest.mock('../../AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../data/codexRepository', () => ({ subscribeCodex: jest.fn() }));
jest.mock('../common/shellLayout', () => ({ useShellLayout: () => ({ topInset: 0 }) }));
jest.mock('../backgrounds/CodexBackground', () => () => null);
jest.mock('./buttons/AggiungiButton', () => () => null);
jest.mock('./buttons/AggiungiCategoriaButton', () => () => null);
jest.mock('./buttons/DeleteCategoriaButton', () => () => null);
jest.mock('./buttons/EditItemButton', () => () => null);
jest.mock('./buttons/DeleteItemButton', () => () => null);

test('resubscribes the Codex listener when the same account changes access role', () => {
  const firstUnsubscribe = jest.fn();
  const secondUnsubscribe = jest.fn();
  subscribeCodex
    .mockReturnValueOnce(firstUnsubscribe)
    .mockReturnValueOnce(secondUnsubscribe);
  const user = { uid: 'same-user' };
  useAuth.mockReturnValue({
    user,
    userData: { role: 'player' },
    loading: false,
  });

  const view = render(<Codex />);
  expect(subscribeCodex).toHaveBeenCalledTimes(1);

  useAuth.mockReturnValue({
    user,
    userData: { role: 'dm' },
    loading: false,
  });
  view.rerender(<Codex />);

  expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
  expect(subscribeCodex).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(secondUnsubscribe).toHaveBeenCalledTimes(1);
});
