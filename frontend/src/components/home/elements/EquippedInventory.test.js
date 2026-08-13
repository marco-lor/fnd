import React from 'react';
import { render, waitFor } from '@testing-library/react';
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
jest.mock('./useConsumable', () => jest.fn(() => Promise.resolve()));

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

describe('EquippedInventory V2 readiness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthSession.mockReturnValue({ user: { uid } });
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
});
