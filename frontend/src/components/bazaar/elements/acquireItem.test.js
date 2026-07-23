import { acquireItem } from './acquireItem';
import { purchaseItem } from '../../../data/userData/userDataCommands';
import { legacyPurchaseItem } from '../../../data/userData/legacyUserDataCommands';

jest.mock('../../../data/userData/userDataCommands', () => ({
  isDefinitiveUserDataCommandError: jest.fn((error) => error?.code === 'functions/invalid-argument'),
  purchaseItem: jest.fn(),
}));

jest.mock('../../../data/userData/legacyUserDataCommands', () => ({
  legacyPurchaseItem: jest.fn(),
}));

const item = { id: 'sword', General: { prezzo: 12 } };

describe('Bazaar purchase rollout routing', () => {
  let consoleError;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    legacyPurchaseItem.mockResolvedValue({ success: true, newGold: 8 });
    purchaseItem.mockResolvedValue({ success: true, newGold: 8 });
  });

  afterEach(() => consoleError.mockRestore());

  test.each(['legacy-read', 'shadow-verify'])(
    'keeps the aggregate transaction in compatibility stage %s',
    async (stage) => {
      await expect(acquireItem('user-1', item, undefined, stage))
        .resolves.toEqual(expect.objectContaining({ success: true }));
      expect(legacyPurchaseItem).toHaveBeenCalledWith({ uid: 'user-1', item });
      expect(purchaseItem).not.toHaveBeenCalled();
    }
  );

  test('fails closed while the rollout stage is unresolved', async () => {
    await expect(acquireItem('user-1', item, undefined, undefined))
      .resolves.toEqual(expect.objectContaining({
        error: expect.stringContaining('still resolving'),
        retryable: true,
      }));
    expect(legacyPurchaseItem).not.toHaveBeenCalled();
    expect(purchaseItem).not.toHaveBeenCalled();
  });

  test.each(['dual-write', 'new-read-dual-write', 'new-only'])(
    'uses the authoritative purchase command in activated stage %s',
    async (stage) => {
      await acquireItem('user-1', item, 'operation-123', stage);
      expect(purchaseItem).toHaveBeenCalledWith({ itemId: 'sword', operationId: 'operation-123' });
      expect(legacyPurchaseItem).not.toHaveBeenCalled();
    }
  );

  test('passes the logical purchase retry key only to the authoritative command', async () => {
    await acquireItem('user-1', item, undefined, 'dual-write', 'user-1:purchase-flow-1');

    expect(purchaseItem).toHaveBeenCalledWith({
      itemId: 'sword',
      retryKey: 'user-1:purchase-flow-1',
    });
  });

  test('does not silently replay a failed authoritative purchase against legacy data', async () => {
    const error = Object.assign(new Error('callable unavailable'), { code: 'functions/unavailable' });
    purchaseItem.mockRejectedValue(error);
    await expect(acquireItem('user-1', item, undefined, 'dual-write'))
      .resolves.toEqual(expect.objectContaining({ error: 'callable unavailable', retryable: true }));
    expect(legacyPurchaseItem).not.toHaveBeenCalled();
  });
});
