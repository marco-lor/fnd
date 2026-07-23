import { act } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import consumeConsumable, { __resetConsumableOperationsForTests } from './useConsumable';
import { commitConsumable, prepareConsumable } from '../../../data/userData/userDataCommands';
import { doc, getDoc, updateDoc } from '../../../performance/firestore';

jest.mock('../../../data/userData/userDataCommands', () => ({
  commitConsumable: jest.fn(),
  isDefinitiveUserDataCommandError: jest.fn((error) => (
    error?.code === 'functions/failed-precondition'
  )),
  prepareConsumable: jest.fn(),
}));

jest.mock('../../../performance/firestore', () => ({
  doc: jest.fn((_db, ...segments) => ({ path: segments.join('/') })),
  getDoc: jest.fn(),
  updateDoc: jest.fn(),
}));

jest.mock('../../firebaseConfig', () => ({ db: {} }));
jest.mock('../../../data/configRepository', () => ({ getVarie: jest.fn() }));
jest.mock('../../common/diceLogger', () => jest.fn(() => Promise.resolve()));

describe('rollout-aware consumable flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetConsumableOperationsForTests();
    doc.mockImplementation((_db, ...segments) => ({ path: segments.join('/') }));
    commitConsumable.mockResolvedValue({ success: true });
    updateDoc.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  test('legacy-read consumes against the aggregate without invoking Task 05 callables', async () => {
    getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        inventory: [{ id: 'potion', type: 'consumabile', qty: 2 }],
        equipped: { beltC1: { id: 'potion', qty: 2 } },
        stats: {},
      }),
    });

    await consumeConsumable({
      user: { uid: 'user-1' },
      userData: { stats: { level: 1 } },
      item: { id: 'potion', type: 'consumabile' },
      slotKey: 'beltC1',
      mode: null,
      stage: 'legacy-read',
    });

    expect(updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/user-1' }),
      expect.objectContaining({
        inventory: [{ id: 'potion', type: 'consumabile', qty: 1 }],
        'equipped.beltC1.qty': 1,
      })
    );
    expect(prepareConsumable).not.toHaveBeenCalled();
    expect(commitConsumable).not.toHaveBeenCalled();
  });

  test('activated rolled consumption renders outside AuthProvider and commits the authoritative preparation', async () => {
    jest.useFakeTimers();
    prepareConsumable.mockResolvedValue({
      preparationId: 'preparation-1',
      rolls: [4, 2],
      faces: 6,
      modifier: 1,
    });
    let consumption;
    await act(async () => {
      consumption = consumeConsumable({
        user: { uid: 'user-1' },
        item: { _task05: { inventoryId: 'inventory-1' } },
        mode: 'hp',
        stage: 'dual-write',
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Dice:')).toBeInTheDocument();
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      await Promise.resolve();
    });
    await expect(consumption).resolves.toBeUndefined();

    expect(prepareConsumable).toHaveBeenCalledWith({
      inventoryId: 'inventory-1',
      resource: 'hp',
      retryKey: 'user-1:inventory-1:hp:prepare',
    });
    expect(commitConsumable).toHaveBeenCalledWith({
      preparationId: 'preparation-1',
      retryKey: 'user-1:inventory-1:hp:commit',
    });
    expect(updateDoc).not.toHaveBeenCalled();
  });

  test('reuses a successful preparation after an ambiguous commit failure', async () => {
    prepareConsumable.mockResolvedValue({
      preparationId: 'preparation-1',
      rolls: [],
    });
    const unavailable = Object.assign(new Error('offline'), { code: 'functions/unavailable' });
    commitConsumable
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ success: true });
    const input = {
      user: { uid: 'user-1' },
      item: { _task05: { inventoryId: 'inventory-1' } },
      mode: null,
      stage: 'dual-write',
    };

    await expect(consumeConsumable(input)).rejects.toBe(unavailable);
    await expect(consumeConsumable(input)).resolves.toBeUndefined();
    expect(prepareConsumable).toHaveBeenCalledTimes(1);
    expect(commitConsumable).toHaveBeenCalledTimes(2);
    expect(commitConsumable).toHaveBeenNthCalledWith(2, {
      preparationId: 'preparation-1',
      retryKey: 'user-1:inventory-1:none:commit',
    });
  });
});
