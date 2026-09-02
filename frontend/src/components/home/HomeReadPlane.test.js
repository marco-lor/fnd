import React, { StrictMode, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getSchema, getVarie, invalidateConfig } from '../../data/configRepository';
import useCatalogItemsById from '../../data/useCatalogItemsById';
import {
  useEquipment,
  useInventory,
  useProfileContent,
  useProgression,
  useResources,
  useUserSettings,
} from '../../data/userData/userDataHooks';
import ConfirmUseConsumableModal from './elements/ConfirmUseConsumableModal';
import HomeReadPlane from './HomeReadPlane';
import { useHomeReadSelector } from './homeReadStore';
import { beginAsyncResourceOwner } from '../../performance/runtime';

jest.mock('../../data/configRepository', () => ({
  getSchema: jest.fn(),
  getVarie: jest.fn(),
  invalidateConfig: jest.fn(),
}));
jest.mock('../../data/useCatalogItemsById', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../data/userData/userDataHooks', () => ({
  useEquipment: jest.fn(),
  useInventory: jest.fn(),
  useProfileContent: jest.fn(),
  useProgression: jest.fn(),
  useResources: jest.fn(),
  useUserSettings: jest.fn(),
}));
jest.mock('../../performance/runtime', () => ({
  beginAsyncResourceOwner: jest.fn(),
}));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const emptyDomain = Object.freeze({ data: null, error: null, status: 'loading', uid: 'player-a' });
const emptyCatalog = Object.freeze({ itemsById: Object.freeze({}), error: null, status: 'loading' });
const schemas = Object.freeze({ Parametri: { Special: {} } });
const regenItem = Object.freeze({
  General: { Nome: 'Pozione' },
  Parametri: {
    Special: {
      'Rigenera Dado Anima HP': { '1': 1, '4': 1, '7': 1, '10': 1 },
    },
  },
  Specific: { 'Bonus Creazione': 0 },
});

let latestConfig;
let releaseConfigOwner;
const ConfigProbe = () => {
  const config = useHomeReadSelector((state) => state.config);
  latestConfig = config;
  return (
    <output data-testid="config-state">
      {`${config.status}:${config.dadiAnimaByLevel.join(',')}`}
    </output>
  );
};

const ConfirmationHarness = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open confirmation</button>
      {open && (
        <ConfirmUseConsumableModal
          item={regenItem}
          userData={{ stats: { level: 4 } }}
          onCancel={() => setOpen(false)}
          onConfirm={jest.fn()}
        />
      )}
    </>
  );
};

describe('Home config read ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    latestConfig = null;
    releaseConfigOwner = jest.fn();
    beginAsyncResourceOwner.mockReturnValue(releaseConfigOwner);
    [
      useEquipment,
      useInventory,
      useProfileContent,
      useProgression,
      useResources,
      useUserSettings,
    ].forEach((hook) => hook.mockReturnValue(emptyDomain));
    useCatalogItemsById.mockReturnValue(emptyCatalog);
    getSchema.mockResolvedValue(schemas);
    getVarie.mockResolvedValue({
      dadiAnimaByLevel: [null, 'd4', 'd4', 'd4', 'd6'],
      cost_params_combat: {},
    });
    invalidateConfig.mockReturnValue(true);
  });

  test('keeps one Strict Mode owner read while the consumable confirmation opens and reopens', async () => {
    render(
      <StrictMode>
        <HomeReadPlane uid="player-a" repositoryAccessGeneration={3}>
          <ConfigProbe />
          <ConfirmationHarness />
        </HomeReadPlane>
      </StrictMode>
    );

    await waitFor(() => expect(screen.getByTestId('config-state')).toHaveTextContent('fresh'));
    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }));
    expect(await screen.findByText('1d6')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'chiudi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }));
    expect(await screen.findByText('1d6')).toBeInTheDocument();

    expect(getVarie).toHaveBeenCalledTimes(1);
    expect(getSchema).toHaveBeenCalledTimes(4);
    expect(beginAsyncResourceOwner).toHaveBeenCalledTimes(1);
    expect(beginAsyncResourceOwner).toHaveBeenCalledWith('home');
    expect(releaseConfigOwner).toHaveBeenCalledTimes(1);
  });

  test('publishes an explicit retry and deduplicates rapid retry attempts', async () => {
    const denied = new Error('denied');
    const retryVarie = deferred();
    getVarie
      .mockRejectedValueOnce(denied)
      .mockReturnValueOnce(retryVarie.promise);

    render(
      <HomeReadPlane uid="player-a" repositoryAccessGeneration={4}>
        <ConfigProbe />
      </HomeReadPlane>
    );

    await waitFor(() => expect(screen.getByTestId('config-state')).toHaveTextContent('error'));
    expect(latestConfig.error).toBe(denied);

    let firstRetry;
    let secondRetry;
    act(() => {
      firstRetry = latestConfig.retry();
      secondRetry = latestConfig.retry();
    });

    expect(secondRetry).toBe(firstRetry);
    expect(invalidateConfig).toHaveBeenCalledTimes(5);
    expect(getVarie).toHaveBeenCalledTimes(2);
    expect(getSchema).toHaveBeenCalledTimes(8);
    expect(screen.getByTestId('config-state')).toHaveTextContent('loading');

    await act(async () => {
      retryVarie.resolve({ dadiAnimaByLevel: [null, 'd8'], cost_params_combat: {} });
      await retryVarie.promise;
    });
    await waitFor(() => expect(screen.getByTestId('config-state')).toHaveTextContent('fresh:,d8'));
  });

  test('ignores late completion from a replaced actor and repository generation', async () => {
    const oldVarie = deferred();
    const currentVarie = deferred();
    getVarie
      .mockReturnValueOnce(oldVarie.promise)
      .mockReturnValueOnce(currentVarie.promise);

    const view = render(
      <HomeReadPlane uid="player-a" repositoryAccessGeneration={5}>
        <ConfigProbe />
      </HomeReadPlane>
    );
    await waitFor(() => expect(getVarie).toHaveBeenCalledTimes(1));

    view.rerender(
      <HomeReadPlane uid="player-b" repositoryAccessGeneration={6}>
        <ConfigProbe />
      </HomeReadPlane>
    );
    await waitFor(() => expect(getVarie).toHaveBeenCalledTimes(2));

    await act(async () => {
      currentVarie.resolve({ dadiAnimaByLevel: [null, 'd8'], cost_params_combat: {} });
      await currentVarie.promise;
    });
    await waitFor(() => expect(screen.getByTestId('config-state')).toHaveTextContent('fresh:,d8'));

    await act(async () => {
      oldVarie.resolve({ dadiAnimaByLevel: [null, 'd20'], cost_params_combat: {} });
      await oldVarie.promise;
    });
    expect(screen.getByTestId('config-state')).toHaveTextContent('fresh:,d8');
  });
});
