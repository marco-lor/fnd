import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { getVarie } from '../../../data/configRepository';
import { createHomeReadStore, HomeReadStoreProvider } from '../homeReadStore';
import ConfirmUseConsumableModal from './ConfirmUseConsumableModal';

jest.mock('../../../data/configRepository', () => ({
  getVarie: jest.fn(() => new Promise(() => {})),
}));

const scopeKey = 'player-a:9';
const regenItem = {
  General: { Nome: 'Pozione' },
  Parametri: {
    Special: {
      'Rigenera Dado Anima HP': { '1': 1, '4': 2, '7': 3, '10': 4 },
    },
  },
  Specific: { 'Bonus Creazione': '+2' },
};
const noRegenItem = {
  General: { Nome: 'Razione' },
  Parametri: { Special: {} },
  Specific: {},
};

const createConfig = (overrides = {}) => Object.freeze({
  dadiAnimaByLevel: Object.freeze([]),
  combatCosts: Object.freeze({}),
  specialSchemaKeys: Object.freeze([]),
  status: 'loading',
  error: null,
  retry: jest.fn(),
  ...overrides,
});

const renderModal = ({ config, item = regenItem, level = 4, onConfirm = jest.fn() }) => {
  const store = createHomeReadStore(scopeKey);
  store.publish(scopeKey, { config });
  const view = render(
    <HomeReadStoreProvider store={store}>
      <ConfirmUseConsumableModal
        item={item}
        userData={{ stats: { level } }}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />
    </HomeReadStoreProvider>
  );
  return { ...view, onConfirm, store };
};

describe('consumable confirmation shared config preview', () => {
  beforeEach(() => jest.clearAllMocks());

  test('shows deterministic loading UI and blocks regeneration confirmation', () => {
    renderModal({ config: createConfig() });

    expect(screen.getByRole('status')).toHaveTextContent('Caricamento configurazione Dado Anima');
    expect(screen.getByRole('button', { name: 'Conferma' })).toBeDisabled();
    expect(screen.queryByText(/d10/i)).not.toBeInTheDocument();
  });

  test('surfaces the Home owner error and retries only through that owner', () => {
    const retry = jest.fn();
    renderModal({
      config: createConfig({ status: 'error', error: new Error('denied'), retry }),
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Impossibile caricare la configurazione Dado Anima');
    expect(screen.getByRole('button', { name: 'Conferma' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova configurazione consumabile' }));

    expect(retry).toHaveBeenCalledTimes(1);
    expect(getVarie).not.toHaveBeenCalled();
  });

  test.each([
    [4, [null, 'd4', 'd4', 'd4', 'd6'], '2d6+4'],
    [12, [null, 'd4', 'd4', 'd4', 'd6', 'd6', 'd6', 'd8'], '4d8+8'],
  ])('uses the valid level die or final configured fallback at level %s', (level, dice, formula) => {
    renderModal({
      config: createConfig({ status: 'fresh', dadiAnimaByLevel: Object.freeze(dice) }),
      level,
    });

    expect(screen.getByText(formula)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conferma' })).toBeEnabled();
  });

  test('does not fabricate a d10 when fresh config has no valid die', () => {
    renderModal({
      config: createConfig({
        status: 'fresh',
        dadiAnimaByLevel: Object.freeze([null, 'd4', 'd4', 'd4', 'invalid']),
      }),
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Nessun dado Anima valido');
    expect(screen.queryByText(/d10/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conferma' })).toBeDisabled();
  });

  test('consumes a no-regeneration item without requiring config or mounting dice UI', () => {
    const onConfirm = jest.fn();
    renderModal({
      config: createConfig({ status: 'error', error: new Error('denied') }),
      item: noRegenItem,
      onConfirm,
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Caricamento configurazione Dado Anima/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conferma' })).toBeEnabled();
    expect(screen.queryByText(/Dice:/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Conferma' }));

    expect(onConfirm).toHaveBeenCalledWith(null);
    expect(getVarie).not.toHaveBeenCalled();
  });

  test('reacts to one Home-owned loading-to-fresh transition', () => {
    const config = createConfig();
    const { store } = renderModal({ config });
    expect(screen.getByRole('button', { name: 'Conferma' })).toBeDisabled();

    act(() => {
      store.publish(scopeKey, {
        config: createConfig({
          status: 'fresh',
          dadiAnimaByLevel: Object.freeze([null, 'd4', 'd4', 'd4', 'd6']),
        }),
      });
    });

    expect(screen.getByText('2d6+4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conferma' })).toBeEnabled();
  });
});
