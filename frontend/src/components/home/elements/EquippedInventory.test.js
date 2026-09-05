import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useAuthSession } from '../../../AuthContext';
import {
  useEquipment,
  useInventory,
  useProgression,
  useResources,
} from '../../../data/userData/userDataHooks';
import { setEquipment } from '../../../data/userData/userDataCommands';
import useCatalogItemsById from '../../../data/useCatalogItemsById';
import MediaImage from '../../common/MediaImage';
import { LazyConfirmUseConsumableModal } from './lazyHomeFeatures';
import { ConsumableActionLayer, useConsumableAction } from './useConsumable';
import EquippedInventory from './EquippedInventory';

jest.mock('../../../AuthContext', () => ({ useAuthSession: jest.fn() }));
jest.mock('../../../data/userData/userDataHooks', () => ({
  useEquipment: jest.fn(),
  useInventory: jest.fn(),
  useProgression: jest.fn(),
  useResources: jest.fn(),
}));
jest.mock('../../../data/userData/userDataCommands', () => ({
  setEquipment: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../../data/useCatalogItemsById', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../../performance/firestore', () => ({
  increment: jest.fn((value) => ({ increment: value })),
}));
jest.mock('../../common/MediaImage', () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));
jest.mock('./lazyHomeFeatures', () => ({
  LazyConfirmUseConsumableModal: jest.fn(() => null),
  LazyItemDetailsModal: jest.fn(() => null),
}));
jest.mock('./useConsumable', () => ({
  ConsumableActionLayer: jest.fn(() => null),
  useConsumableAction: jest.fn(),
}));

const uid = 'user-1';
const equipmentData = {
  equipped: {
    cintura: { id: 'belt', Specific: { slotCintura: 0 } },
    beltC1: { id: 'potion', item_type: 'consumabile' },
  },
};

const setCommonDomainState = () => {
  useInventory.mockReturnValue({ data: [], status: 'fresh', uid });
  useProgression.mockReturnValue({ data: { stats: { level: 4 } }, status: 'fresh', uid });
  useResources.mockReturnValue({ data: { stats: { manaCurrent: 5 } }, status: 'fresh', uid });
};

const consumableController = {
  begin: jest.fn(() => true),
  cancel: jest.fn(),
  completeAnimation: jest.fn(),
  dismissError: jest.fn(),
  isBusy: false,
  retry: jest.fn(),
  view: { phase: 'idle', action: null, error: null },
};

describe('EquippedInventory V2 readiness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthSession.mockReturnValue({ user: { uid }, repositoryAccessGeneration: 7 });
    useConsumableAction.mockReturnValue(consumableController);
    useCatalogItemsById.mockReturnValue({ itemsById: {}, status: 'fresh', error: null });
    setCommonDomainState();
  });

  test('does not run belt cleanup until every canonical domain is fresh', async () => {
    useEquipment.mockReturnValue({
      data: equipmentData,
      status: 'fresh',
      uid,
    });
    useInventory.mockReturnValue({ data: null, status: 'loading', uid });
    const view = render(<EquippedInventory />);

    await Promise.resolve();
    expect(setEquipment).not.toHaveBeenCalled();

    setCommonDomainState();
    view.rerender(<EquippedInventory />);

    await waitFor(() => expect(setEquipment).toHaveBeenCalledWith({
      slot: 'beltC1',
      inventoryId: null,
    }));
  });

  test('renders canonical catalog media for an equipped purchased instance', () => {
    const catalogMedia = { assetId: `m_${'d'.repeat(40)}` };
    useInventory.mockReturnValue({
      data: [{
        id: 'sword-1',
        item_type: 'weapon',
        General: { Nome: 'Spada', Slot: 'Mano Principale' },
        Specific: { Hands: 1 },
        _instance: { instanceId: 'purchase-receipt-1' },
        _task05: {
          inventoryId: 'purchase-receipt-1',
          catalogItemId: 'sword-1',
        },
      }],
      status: 'fresh',
      uid,
    });
    useEquipment.mockReturnValue({
      data: { slots: { weaponMain: 'purchase-receipt-1' } },
      status: 'fresh',
      uid,
    });
    useCatalogItemsById.mockReturnValue({
      itemsById: { 'sword-1': { id: 'sword-1', media: catalogMedia } },
      status: 'fresh',
      error: null,
    });

    render(<EquippedInventory />);

    expect(useCatalogItemsById).toHaveBeenCalledWith(['sword-1']);
    expect(MediaImage.mock.calls.some(([props]) => (
      props.media?.media?.assetId === catalogMedia.assetId
    ))).toBe(true);
  });

  test('names a canonical equipped object in its unequip affordance', () => {
    const belt = {
      id: 'belt-1',
      item_type: 'armatura',
      General: { Nome: 'Cintura Base', Slot: 'Cintura' },
      Specific: { slotCintura: 0 },
      _instance: { instanceId: 'inventory-belt-1' },
      _task05: { inventoryId: 'inventory-belt-1', catalogItemId: 'belt-1' },
    };
    useInventory.mockReturnValue({ data: [belt], status: 'fresh', uid });
    useEquipment.mockReturnValue({
      data: { slots: { cintura: 'inventory-belt-1' } },
      status: 'fresh',
      uid,
    });

    render(<EquippedInventory />);

    expect(screen.getByTitle('Click to unequip Cintura Base')).toBeInTheDocument();
    expect(screen.queryByTitle(/\[object Object\]/)).not.toBeInTheDocument();
  });

  test('owns consumable confirmation in the Home provider tree and forwards the repository generation', async () => {
    const potion = {
      id: 'potion-1',
      item_type: 'consumabile',
      General: { Nome: 'Pozione' },
      Specific: { Dado: 0 },
      qty: 1,
      _task05: { inventoryId: 'inventory-potion-1', revision: 3 },
    };
    useInventory.mockReturnValue({ data: [potion], status: 'fresh', uid });
    useEquipment.mockReturnValue({
      data: { equipped: { cintura: { id: 'belt', Specific: { slotCintura: 99 } } } },
      status: 'fresh',
      uid,
    });

    render(<EquippedInventory />);

    expect(useConsumableAction).toHaveBeenCalledWith(expect.objectContaining({
      inventory: expect.arrayContaining([expect.objectContaining({
        _task05: expect.objectContaining({ inventoryId: 'inventory-potion-1' }),
      })]),
      mutationsReady: true,
      repositoryAccessGeneration: 7,
      user: { uid },
    }));
    expect(ConsumableActionLayer).toHaveBeenCalledWith(
      expect.objectContaining({ controller: consumableController }),
      expect.anything()
    );

    fireEvent.click(screen.getByTitle('Usa consumabile'));
    await waitFor(() => expect(LazyConfirmUseConsumableModal).toHaveBeenCalled());
    const confirmationProps = LazyConfirmUseConsumableModal.mock.calls.at(-1)[0];
    await confirmationProps.onConfirm('hp');

    expect(consumableController.begin).toHaveBeenCalledTimes(1);
    expect(consumableController.begin).toHaveBeenCalledWith({ item: expect.objectContaining({
      _task05: expect.objectContaining({ inventoryId: 'inventory-potion-1' }),
    }), mode: 'hp' });
  });
});
