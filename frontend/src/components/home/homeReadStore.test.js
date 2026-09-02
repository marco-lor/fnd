import React from 'react';
import { act, render } from '@testing-library/react';
import {
  createHomeReadStore,
  createSelectedSnapshotReader,
  HomeReadStoreProvider,
  useHomeReadSelector,
} from './homeReadStore';

describe('Home shared read store', () => {
  test('fences stale scope publications and preserves unrelated selector identity', () => {
    const store = createHomeReadStore('player-a:4');
    const readInventory = createSelectedSnapshotReader(
      store,
      (state) => state.inventory,
      Object.is
    );
    const initialInventorySelection = readInventory();
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.publish('player-a:3', {
      resources: { data: { stats: { hpCurrent: 44 } }, status: 'fresh' },
    })).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    expect(store.publish('player-a:4', {
      resources: { data: { stats: { hpCurrent: 44 } }, status: 'fresh' },
    })).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readInventory()).toBe(initialInventorySelection);

    unsubscribe();
  });

  test('reuses a selected snapshot when an equality function accepts the next value', () => {
    const store = createHomeReadStore('player-a:8');
    const readGold = createSelectedSnapshotReader(
      store,
      (state) => ({ gold: state.resources.data?.stats?.gold || 0 }),
      (left, right) => left.gold === right.gold
    );
    const first = readGold();

    store.publish('player-a:8', {
      resources: { data: { stats: { gold: 12, hpCurrent: 40 } }, status: 'fresh' },
    });
    const second = readGold();
    expect(second).not.toBe(first);
    expect(second).toEqual({ gold: 12 });

    store.publish('player-a:8', {
      resources: { data: { stats: { gold: 12, hpCurrent: 39 } }, status: 'fresh' },
    });
    expect(readGold()).toBe(second);
  });

  test('a resource-only publication renders the resource consumer and no unrelated consumer', () => {
    const store = createHomeReadStore('player-a:11');
    const resourceRender = jest.fn();
    const inventoryRender = jest.fn();
    const ResourceProbe = () => {
      useHomeReadSelector((state) => state.resources);
      resourceRender();
      return null;
    };
    const InventoryProbe = () => {
      useHomeReadSelector((state) => state.inventoryProjection);
      inventoryRender();
      return null;
    };
    render(
      <HomeReadStoreProvider store={store}>
        <ResourceProbe />
        <InventoryProbe />
      </HomeReadStoreProvider>
    );
    resourceRender.mockClear();
    inventoryRender.mockClear();

    act(() => {
      store.publish('player-a:11', {
        resources: { data: { stats: { hpCurrent: 38 } }, status: 'fresh' },
      });
    });

    expect(resourceRender).toHaveBeenCalledTimes(1);
    expect(inventoryRender).not.toHaveBeenCalled();
  });

  test('a config-only transition does not render unrelated Home selectors', () => {
    const store = createHomeReadStore('player-a:12');
    const configRender = jest.fn();
    const unrelatedRender = jest.fn();
    const ConfigProbe = () => {
      useHomeReadSelector((state) => state.config);
      configRender();
      return null;
    };
    const UnrelatedProbe = () => {
      useHomeReadSelector((state) => ({
        equipment: state.equipment,
        inventory: state.inventoryProjection,
        profile: state.profileContent,
        resources: state.resources,
      }), (left, right) => (
        left.equipment === right.equipment
        && left.inventory === right.inventory
        && left.profile === right.profile
        && left.resources === right.resources
      ));
      unrelatedRender();
      return null;
    };
    render(
      <HomeReadStoreProvider store={store}>
        <ConfigProbe />
        <UnrelatedProbe />
      </HomeReadStoreProvider>
    );
    configRender.mockClear();
    unrelatedRender.mockClear();

    act(() => {
      store.publish('player-a:12', {
        config: Object.freeze({
          dadiAnimaByLevel: Object.freeze([null, 'd6']),
          combatCosts: Object.freeze({}),
          specialSchemaKeys: Object.freeze([]),
          status: 'fresh',
          error: null,
          retry: jest.fn(),
        }),
      });
    });

    expect(configRender).toHaveBeenCalledTimes(1);
    expect(unrelatedRender).not.toHaveBeenCalled();
  });
});
