import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { useAuthSession } from '../../../AuthContext';
import {
  useEquipment,
  useInventory,
  useProgression,
  useResources,
} from '../../../data/userData/userDataHooks';
import { legacySetEquipment } from '../../../data/userData/legacyUserDataCommands';
import { setEquipment } from '../../../data/userData/userDataCommands';
import { USER_DATA_ROLLOUT_STAGES } from '../../../data/userData/domainSchema';
import EquippedInventory from './EquippedInventory';

jest.mock('../../../AuthContext', () => ({ useAuthSession: jest.fn() }));
jest.mock('../../../data/userData/userDataHooks', () => ({
  useEquipment: jest.fn(),
  useInventory: jest.fn(),
  useProgression: jest.fn(),
  useResources: jest.fn(),
}));
jest.mock('../../../data/userData/legacyUserDataCommands', () => ({
  legacySetEquipment: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../../data/userData/userDataCommands', () => ({
  setEquipment: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../../performance/firestore', () => ({
  increment: jest.fn((value) => ({ increment: value })),
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

describe('EquippedInventory rollout readiness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthSession.mockReturnValue({ user: { uid } });
    setCommonDomainState();
  });

  test('does not run belt cleanup until the canonical rollout stage is known', async () => {
    useEquipment.mockReturnValue({
      data: equipmentData,
      status: 'fresh',
      stage: null,
      uid,
    });
    const view = render(<EquippedInventory />);

    await Promise.resolve();
    expect(legacySetEquipment).not.toHaveBeenCalled();
    expect(setEquipment).not.toHaveBeenCalled();

    useEquipment.mockReturnValue({
      data: equipmentData,
      status: 'fresh',
      stage: USER_DATA_ROLLOUT_STAGES.LEGACY_READ,
      uid,
    });
    view.rerender(<EquippedInventory />);

    await waitFor(() => expect(legacySetEquipment).toHaveBeenCalledWith(expect.objectContaining({
      uid,
      slot: 'beltC1',
      item: null,
    })));
    expect(setEquipment).not.toHaveBeenCalled();
  });
});
