import { acquireItem } from './acquireItem';
import { purchaseItem } from '../../../data/userData/userDataCommands';

jest.mock('../../../data/userData/userDataCommands', () => ({
  isDefinitiveUserDataCommandError: jest.fn((error) => error?.code === 'functions/invalid-argument'),
  purchaseItem: jest.fn(),
}));

const item = { id: 'sword', General: { prezzo: 12 } };

describe('Bazaar canonical purchase command', () => {
  let consoleError;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    purchaseItem.mockResolvedValue({ success: true, newGold: 8 });
  });

  afterEach(() => consoleError.mockRestore());

  test('always uses the authoritative purchase command', async () => {
    await expect(acquireItem('user-1', item, 'operation-123'))
      .resolves.toEqual(expect.objectContaining({ success: true }));
    expect(purchaseItem).toHaveBeenCalledWith({ itemId: 'sword', operationId: 'operation-123' });
  });

  test('passes the logical purchase retry key to the authoritative command', async () => {
    await acquireItem('user-1', item, undefined, 'user-1:purchase-flow-1');

    expect(purchaseItem).toHaveBeenCalledWith({
      itemId: 'sword',
      retryKey: 'user-1:purchase-flow-1',
    });
  });

  test('does not silently replay a failed authoritative purchase against legacy data', async () => {
    const error = Object.assign(new Error('callable unavailable'), { code: 'functions/unavailable' });
    purchaseItem.mockRejectedValue(error);
    await expect(acquireItem('user-1', item))
      .resolves.toEqual(expect.objectContaining({ error: 'callable unavailable', retryable: true }));
  });
});
