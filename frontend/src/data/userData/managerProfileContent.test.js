import {
  buildProfileContentMap,
  persistProfileContentMap,
} from './managerProfileContent';
import { updateProfileContent } from './userDataCommands';

jest.mock('./userDataCommands', () => ({
  updateProfileContent: jest.fn(() => Promise.resolve({ success: true })),
}));

describe('managerProfileContent', () => {
  beforeEach(() => {
    updateProfileContent.mockClear();
  });

  test('derives the complete canonical map without mutating the current snapshot', () => {
    const currentMap = {
      Arcano: { descrizione: 'old', livello: 'Base' },
    };
    const nextMap = buildProfileContentMap({
      currentMap,
      action: 'upsert',
      name: 'Storia',
      value: { descrizione: 'new', livello: 'Avanzato' },
    });

    expect(nextMap).toEqual({
      Arcano: { descrizione: 'old', livello: 'Base' },
      Storia: { descrizione: 'new', livello: 'Avanzato' },
    });
    expect(currentMap).toEqual({
      Arcano: { descrizione: 'old', livello: 'Base' },
    });
  });

  test('sends the full canonical field map and a stable retry key', async () => {
    const input = {
      userId: 'user-1',
      field: 'lingue',
      currentMap: { Comune: 'known' },
      action: 'upsert',
      name: 'Elfico',
      value: 'fluent',
    };
    await persistProfileContentMap(input);
    const firstPayload = updateProfileContent.mock.calls[0][0];

    updateProfileContent.mockClear();
    await persistProfileContentMap(input);
    const secondPayload = updateProfileContent.mock.calls[0][0];

    expect(firstPayload).toEqual(expect.objectContaining({
      userId: 'user-1',
      patch: {
        lingue: {
          Comune: 'known',
          Elfico: 'fluent',
        },
      },
    }));
    expect(firstPayload.retryKey).toBe(secondPayload.retryKey);
  });

  test('fails closed instead of recreating a missing delete target', async () => {
    expect(() => persistProfileContentMap({
        userId: 'user-1',
        field: 'professioni',
        currentMap: {},
        action: 'delete',
        name: 'Alchimista',
      })
    ).toThrow('no longer exists');
    expect(updateProfileContent).not.toHaveBeenCalled();
  });
});
