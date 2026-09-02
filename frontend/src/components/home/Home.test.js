import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { useAuth, useAuthSession } from '../../AuthContext';
import { getSchema, getVarie } from '../../data/configRepository';
import useCatalogItemsById from '../../data/useCatalogItemsById';
import {
  useEquipment,
  useInventory,
  useProfileContent,
  useProgression,
  useResources,
  useUserSettings,
} from '../../data/userData/userDataHooks';
import Extra from './elements/Extra';
import EquippedInventory from './elements/EquippedInventory';
import Inventory from './elements/Inventory';
import { MergedStatsTable } from './elements/paramTables';
import StatsBars from './elements/StatsBars';
import Home from './Home';

jest.mock('../../AuthContext', () => ({
  useAuth: jest.fn(),
  useAuthSession: jest.fn(),
}));
jest.mock('../../data/configRepository', () => ({
  getSchema: jest.fn(),
  getVarie: jest.fn(),
  invalidateConfig: jest.fn(),
}));
jest.mock('../../data/useCatalogItemsById', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../data/userData/userDataCommands', () => ({
  updateProgression: jest.fn(),
}));
jest.mock('../../data/userData/userDataHooks', () => ({
  useEquipment: jest.fn(),
  useInventory: jest.fn(),
  useProfileContent: jest.fn(),
  useProgression: jest.fn(),
  useResources: jest.fn(),
  useUserSettings: jest.fn(),
}));
jest.mock('../../performance/PerformanceProfiler', () => ({
  __esModule: true,
  default: ({ children }) => children,
}));
jest.mock('./elements/Extra', () => jest.fn(() => null));
jest.mock('./elements/EquippedInventory', () => jest.fn(() => null));
jest.mock('./elements/Inventory', () => jest.fn(() => null));
jest.mock('./elements/paramTables', () => ({ MergedStatsTable: jest.fn(() => null) }));
jest.mock('./elements/StatsBars', () => jest.fn(() => null));

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

const uid = 'player-a';
const progression = Object.freeze({ stats: Object.freeze({ level: 4 }) });
const profileContent = Object.freeze({ AltriParametri: Object.freeze({ Anima_1: 'Spirito' }) });
const freshProgression = Object.freeze({ data: progression, error: null, status: 'fresh', uid });
const freshProfile = Object.freeze({ data: profileContent, error: null, status: 'fresh', uid });
const emptyDomain = Object.freeze({ data: Object.freeze({}), error: null, status: 'fresh', uid });
const emptyInventory = Object.freeze({ data: Object.freeze([]), error: null, status: 'fresh', uid });
const emptyCatalog = Object.freeze({ itemsById: Object.freeze({}), error: null, status: 'fresh' });

describe('Home config selector isolation', () => {
  test('a config-only completion does not rerender unrelated Home sections', async () => {
    const varie = deferred();
    useAuth.mockReturnValue({ user: { uid } });
    useAuthSession.mockReturnValue({ user: { uid }, repositoryAccessGeneration: 12 });
    useProgression.mockReturnValue(freshProgression);
    useProfileContent.mockReturnValue(freshProfile);
    useResources.mockReturnValue(emptyDomain);
    useEquipment.mockReturnValue(emptyDomain);
    useInventory.mockReturnValue(emptyInventory);
    useUserSettings.mockReturnValue(emptyDomain);
    useCatalogItemsById.mockReturnValue(emptyCatalog);
    getVarie.mockReturnValue(varie.promise);
    getSchema.mockResolvedValue({ Parametri: { Special: {} } });

    render(<Home />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    [StatsBars, EquippedInventory, Inventory, Extra, MergedStatsTable]
      .forEach((component) => component.mockClear());

    await act(async () => {
      varie.resolve({
        dadiAnimaByLevel: [null, 'd4', 'd4', 'd4', 'd6'],
        cost_params_combat: {},
      });
      await varie.promise;
    });
    await waitFor(() => expect(getVarie).toHaveBeenCalledTimes(1));

    [StatsBars, EquippedInventory, Inventory, Extra, MergedStatsTable]
      .forEach((component) => expect(component).not.toHaveBeenCalled());
  });
});
