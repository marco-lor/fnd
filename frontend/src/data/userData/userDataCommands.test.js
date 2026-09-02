import {
  __resetUserDataCommandsForTests,
  consumeTurnEffects,
  createUserOperationId,
  getAdminUsersPage,
  purchaseItem,
  spendCharacterPoint,
  updateCharacterCreation,
  updateGrigliataCharacterResources,
  updateResource,
} from './userDataCommands';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import { recordTask08Event } from '../../performance/task08';

const mockCallable = jest.fn((payload) => Promise.resolve({
  data: { success: true, replayed: false, payload },
}));

jest.mock('../../components/firebaseConfig', () => ({ app: {} }));

jest.mock('firebase/functions', () => ({
  connectFunctionsEmulator: jest.fn(),
  getFunctions: jest.fn(() => ({ region: 'europe-west8' })),
  httpsCallable: jest.fn(() => mockCallable),
}));

jest.mock('../../performance/task08', () => ({
  getTask08ResourceHoldId: jest.fn(() => null),
  recordTask08Event: jest.fn(),
}));

describe('Task 05 user commands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getFunctions.mockImplementation((_app, region) => ({ region }));
    httpsCallable.mockImplementation(() => mockCallable);
    mockCallable.mockImplementation((payload) => Promise.resolve({
      data: { success: true, replayed: false, payload },
    }));
    __resetUserDataCommandsForTests();
  });

  test('acquires the europe-west8 client only when a command is invoked', async () => {
    expect(getFunctions).not.toHaveBeenCalled();

    await purchaseItem({ itemId: 'sword-1', operationId: 'purchase-fixed' });

    expect(getFunctions).toHaveBeenCalledWith({}, 'europe-west8');
    expect(connectFunctionsEmulator).not.toHaveBeenCalled();
  });

  test('routes private admin labels through the paginated V2 callable', async () => {
    await getAdminUsersPage({cursor: 'user-1', limit: 50});

    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'task05ListAdminUsers');
    expect(mockCallable).toHaveBeenCalledWith({
      cursor: 'user-1',
      limit: 50,
    });
  });

  test('routes point spending through the manifest-backed V2 callable', async () => {
    await spendCharacterPoint({
      statName: 'Forza',
      statType: 'Base',
      change: 1,
      operationId: 'point-fixed',
    });

    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'spendCharacterPointV2');
    expect(mockCallable).toHaveBeenCalledWith({
      statName: 'Forza',
      statType: 'Base',
      change: 1,
      operationId: 'point-fixed',
    });
  });

  test('sends only the catalog item ID and idempotency key for purchases', async () => {
    await purchaseItem({ itemId: 'sword-1', operationId: 'purchase-fixed' });

    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'task05PurchaseItem');
    expect(mockCallable).toHaveBeenCalledWith({
      itemId: 'sword-1',
      operationId: 'purchase-fixed',
    });
  });

  test('keeps resource semantics explicit in the command payload', async () => {
    await updateResource({
      resource: 'hp',
      mode: 'delta',
      value: -3,
      operationId: 'resource-fixed',
    });

    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'task05UpdateResource');
    expect(mockCallable).toHaveBeenCalledWith({
      operationId: 'resource-fixed',
      resource: 'hp',
      mode: 'delta',
      value: -3,
    });
  });

  test('records callable attempts and outcomes without exposing operation or user IDs', async () => {
    await updateResource({
      userId: 'user-1',
      resource: 'hp',
      mode: 'delta',
      value: -3,
      retryKey: 'same-logical-action',
      operationId: 'resource-fixed',
    });

    expect(recordTask08Event).toHaveBeenNthCalledWith(1, {
      metric: 'command-start',
      tags: {
        command: 'task05UpdateResource',
        explicitOperationId: true,
        retryKeyProvided: true,
        resource: 'hp',
        mode: 'delta',
        value: -3,
      },
    });
    expect(recordTask08Event).toHaveBeenNthCalledWith(2, {
      metric: 'command-success',
      tags: {
        command: 'task05UpdateResource',
        explicitOperationId: true,
        retryKeyProvided: true,
        resource: 'hp',
        mode: 'delta',
        value: -3,
      },
    });
    expect(JSON.stringify(recordTask08Event.mock.calls)).not.toContain('resource-fixed');
    expect(JSON.stringify(recordTask08Event.mock.calls)).not.toContain('user-1');
  });

  test('does not infer a physical application from a response without replay=false', async () => {
    mockCallable.mockResolvedValueOnce({ data: { success: true } });

    await purchaseItem({ itemId: 'sword-1', operationId: 'purchase-no-replay-field' });

    expect(recordTask08Event.mock.calls.map(([entry]) => entry.metric)).toEqual([
      'command-start',
      'command-success',
      'command-non-replayed-success',
    ]);
  });

  test('does not record physical application telemetry for a replayed success', async () => {
    mockCallable.mockResolvedValueOnce({data: {success: true, replayed: true}});

    await updateCharacterCreation({
      action: 'initialize',
      retryKey: 'character-initialize-replayed',
    });

    expect(recordTask08Event.mock.calls.map(([entry]) => entry.metric)).toEqual([
      'command-start',
      'command-success',
    ]);
  });

  test('diagnoses an unknown-envelope Character Creation success without counting an applied write', async () => {
    mockCallable.mockResolvedValueOnce({data: {success: true}});

    await updateCharacterCreation({
      action: 'initialize',
      retryKey: 'character-initialize-envelope',
    });

    expect(recordTask08Event.mock.calls.map(([entry]) => entry.metric)).toEqual([
      'command-start',
      'command-success',
      'command-non-replayed-success',
    ]);
  });

  test('pairs every resource hold command event with a bounded sequence and hold ID', async () => {
    const { getTask08ResourceHoldId } = require('../../performance/task08');
    getTask08ResourceHoldId.mockReturnValue('hold-1');

    await updateResource({
      resource: 'hp',
      mode: 'delta',
      value: -1,
      operationId: 'resource-hold-fixed',
    });

    expect(recordTask08Event.mock.calls.map(([entry]) => entry)).toEqual([
      {
        metric: 'command-start',
        tags: expect.objectContaining({
          command: 'task05UpdateResource',
          holdId: 'hold-1',
          invocationSequence: 1,
        }),
      },
      {
        metric: 'command-success',
        tags: expect.objectContaining({
          command: 'task05UpdateResource',
          holdId: 'hold-1',
          invocationSequence: 1,
        }),
      },
      {
        metric: 'command-applied',
        tags: expect.objectContaining({
          command: 'task05UpdateResource',
          holdId: 'hold-1',
          invocationSequence: 1,
        }),
      },
    ]);
    expect(JSON.stringify(recordTask08Event.mock.calls)).not.toContain('resource-hold-fixed');
    expect(JSON.stringify(recordTask08Event.mock.calls)).not.toContain('user-1');
  });

  test('forwards the atomic barrier total and turn metadata', async () => {
    await updateResource({
      resource: 'barriera',
      mode: 'set',
      value: 12,
      totalValue: 12,
      totalTurns: 3,
      remainingTurns: 3,
      operationId: 'barrier-fixed',
    });

    expect(mockCallable).toHaveBeenCalledWith({
      operationId: 'barrier-fixed',
      resource: 'barriera',
      mode: 'set',
      value: 12,
      totalValue: 12,
      totalTurns: 3,
      remainingTurns: 3,
    });
  });

  test('routes Grigliata character resources and the reviewed token patch atomically', async () => {
    await updateGrigliataCharacterResources({
      userId: 'player-1',
      backgroundId: 'map-1',
      tokenId: 'player-1',
      resources: {
        hpCurrent: 8,
        manaCurrent: 5,
        barrieraCurrent: 2,
      },
      tokenPatch: {
        characterId: 'Boros',
        notes: 'Guarding the gate',
      },
      operationId: 'grigliata-fixed',
    });

    expect(httpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      'task05UpdateGrigliataCharacterResources'
    );
    expect(mockCallable).toHaveBeenCalledWith({
      userId: 'player-1',
      backgroundId: 'map-1',
      tokenId: 'player-1',
      resources: { hpCurrent: 8, manaCurrent: 5, barrieraCurrent: 2 },
      tokenPatch: { characterId: 'Boros', notes: 'Guarding the gate' },
      operationId: 'grigliata-fixed',
    });
  });

  test('routes character creation actions through one idempotent V2 endpoint', async () => {
    await updateCharacterCreation({
      action: 'selectRace',
      race: 'elf',
      operationId: 'character-fixed',
    });

    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'task05CharacterCreation');
    expect(mockCallable).toHaveBeenCalledWith({
      action: 'selectRace',
      race: 'elf',
      operationId: 'character-fixed',
    });
  });

  test('deduplicates concurrent retries of one character creation action', async () => {
    let resolveInvocation;
    const invocation = new Promise((resolve) => {
      resolveInvocation = resolve;
    });
    mockCallable.mockReturnValueOnce(invocation);

    const request = {
      action: 'selectRace',
      race: 'elf',
      retryKey: 'character-race:player-a:elf',
      retryScope: 'character-creation:player-a:owned:1:race',
    };
    const first = updateCharacterCreation(request);
    const second = updateCharacterCreation(request);
    await Promise.resolve();

    expect(mockCallable).toHaveBeenCalledTimes(1);
    resolveInvocation({data: {success: true, replayed: false}});
    await expect(Promise.all([first, second])).resolves.toEqual([
      {success: true, replayed: false},
      {success: true, replayed: false},
    ]);
    expect(mockCallable.mock.calls[0][0]).not.toHaveProperty('retryScope');
  });

  test('reuses the exact operation ID for an explicit retry of one ambiguous Character Creation request', async () => {
    const unavailable = Object.assign(new Error('offline'), {code: 'functions/unavailable'});
    mockCallable
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({data: {success: true, replayed: false}});
    const request = {
      action: 'selectRace',
      race: 'elf',
      retryKey: 'character-race:player-a',
      retryScope: 'character-creation:player-a:owned:1:race',
    };

    await expect(updateCharacterCreation(request)).rejects.toBe(unavailable);
    const firstOperationId = mockCallable.mock.calls[0][0].operationId;
    await updateCharacterCreation(request);

    expect(mockCallable.mock.calls[1][0].operationId).toBe(firstOperationId);
    expect(mockCallable.mock.calls.every(([payload]) => payload.retryScope === undefined)).toBe(true);
  });

  test('does not reuse an ambiguous operation ID for changed character payload bytes', async () => {
    const unavailable = Object.assign(new Error('offline'), {code: 'functions/unavailable'});
    mockCallable
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({data: {success: true, replayed: false}});

    const retryKey = 'character-race:player-a';
    await expect(updateCharacterCreation({
      action: 'selectRace',
      race: 'elf',
      retryKey,
    })).rejects.toBe(unavailable);
    const firstOperationId = mockCallable.mock.calls[0][0].operationId;

    await updateCharacterCreation({
      action: 'selectRace',
      race: 'human',
      retryKey,
    });
    expect(mockCallable.mock.calls[1][0].operationId).not.toBe(firstOperationId);
  });

  test('retires an old Character Creation identity after A, B, then A in one action scope', async () => {
    const unavailable = Object.assign(new Error('offline'), {code: 'functions/unavailable'});
    mockCallable
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValue({data: {success: true, replayed: false}});
    const request = (race) => ({
      action: 'selectRace',
      race,
      retryKey: 'character-race:player-a',
      retryScope: 'character-creation:player-a:owned:1:race',
    });

    await expect(updateCharacterCreation(request('elf'))).rejects.toBe(unavailable);
    const firstOperationId = mockCallable.mock.calls[0][0].operationId;
    await updateCharacterCreation(request('human'));
    const secondOperationId = mockCallable.mock.calls[1][0].operationId;
    await updateCharacterCreation(request('elf'));
    const thirdOperationId = mockCallable.mock.calls[2][0].operationId;

    expect(secondOperationId).not.toBe(firstOperationId);
    expect(thirdOperationId).not.toBe(firstOperationId);
    expect(thirdOperationId).not.toBe(secondOperationId);
    expect(mockCallable.mock.calls.every(([payload]) => payload.retryScope === undefined)).toBe(true);
  });

  test('does not reuse an in-flight Character Creation invocation after the action scope advances', async () => {
    let resolveFirst;
    const firstInvocation = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    mockCallable
      .mockReturnValueOnce(firstInvocation)
      .mockResolvedValue({data: {success: true, replayed: false}});
    const request = (race) => ({
      action: 'selectRace',
      race,
      retryKey: 'character-race:player-a:pending',
      retryScope: 'character-creation:player-a:owned:1:race',
    });

    const first = updateCharacterCreation(request('elf'));
    await Promise.resolve();
    expect(mockCallable).toHaveBeenCalledTimes(1);
    const firstOperationId = mockCallable.mock.calls[0][0].operationId;

    await updateCharacterCreation(request('human'));
    const secondOperationId = mockCallable.mock.calls[1][0].operationId;
    const later = updateCharacterCreation(request('elf'));
    await Promise.resolve();
    expect(mockCallable).toHaveBeenCalledTimes(3);
    const thirdOperationId = mockCallable.mock.calls[2][0].operationId;

    expect(secondOperationId).not.toBe(firstOperationId);
    expect(thirdOperationId).not.toBe(firstOperationId);
    expect(thirdOperationId).not.toBe(secondOperationId);
    resolveFirst({data: {success: true, replayed: false}});
    await Promise.all([first, later]);
  });

  test('does not resurrect an older ambiguous completion identity after the completion intent changes', async () => {
    const unavailable = Object.assign(new Error('offline'), {code: 'functions/unavailable'});
    mockCallable
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValue({data: {success: true, replayed: false}});
    const request = (characterId, imagePath) => ({
      action: 'complete',
      characterId,
      profile: {imagePath},
      retryKey: 'character-complete:player-a',
      retryScope: 'character-creation:player-a:owned:1:complete',
    });

    await expect(updateCharacterCreation(request('Elf', 'characters/elf.png'))).rejects.toBe(unavailable);
    const firstOperationId = mockCallable.mock.calls[0][0].operationId;
    await updateCharacterCreation(request('Human', 'characters/human.png'));
    const secondOperationId = mockCallable.mock.calls[1][0].operationId;
    await updateCharacterCreation(request('Elf', 'characters/elf.png'));
    const thirdOperationId = mockCallable.mock.calls[2][0].operationId;

    expect(secondOperationId).not.toBe(firstOperationId);
    expect(thirdOperationId).not.toBe(firstOperationId);
    expect(thirdOperationId).not.toBe(secondOperationId);
    expect(mockCallable.mock.calls.every(([payload]) => payload.retryScope === undefined)).toBe(true);
  });

  test('does not reuse a Character Creation identity across actor or repository-generation scopes', async () => {
    const unavailable = Object.assign(new Error('offline'), {code: 'functions/unavailable'});
    mockCallable
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({data: {success: true, replayed: false}});
    const baseRequest = {
      action: 'selectAnima',
      anima: 'fire',
      retryKey: 'character-anima:logical-action',
    };

    await expect(updateCharacterCreation({
      ...baseRequest,
      retryScope: 'character-creation:player-a:owned:1:anima',
    })).rejects.toBe(unavailable);
    const firstOperationId = mockCallable.mock.calls[0][0].operationId;
    await updateCharacterCreation({
      ...baseRequest,
      retryScope: 'character-creation:player-b:owned:2:anima',
    });

    expect(mockCallable.mock.calls[1][0].operationId).not.toBe(firstOperationId);
    expect(mockCallable.mock.calls.every(([payload]) => payload.retryScope === undefined)).toBe(true);
  });

  test('retires a Character Creation identity after a definitive failure', async () => {
    const invalid = Object.assign(new Error('invalid'), {code: 'functions/invalid-argument'});
    mockCallable
      .mockRejectedValueOnce(invalid)
      .mockResolvedValueOnce({data: {success: true, replayed: false}});
    const request = {
      action: 'selectAnima',
      anima: 'fire',
      retryKey: 'character-anima:definitive',
      retryScope: 'character-creation:player-a:owned:1:anima',
    };

    await expect(updateCharacterCreation(request)).rejects.toBe(invalid);
    const firstOperationId = mockCallable.mock.calls[0][0].operationId;
    await updateCharacterCreation(request);

    expect(mockCallable.mock.calls[1][0].operationId).not.toBe(firstOperationId);
    expect(mockCallable.mock.calls.every(([payload]) => payload.retryScope === undefined)).toBe(true);
  });

  test('routes DM turn-effect consumption with explicit target identity', async () => {
    await consumeTurnEffects({
      userId: 'player-1',
      operationId: 'effects-fixed',
    });

    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'task05ConsumeTurnEffects');
    expect(mockCallable).toHaveBeenCalledWith({
      userId: 'player-1',
      operationId: 'effects-fixed',
    });
  });

  test('retains the atomic Grigliata turn operation ID across an ambiguous failure', async () => {
    const unavailable = Object.assign(new Error('offline'), { code: 'functions/unavailable' });
    mockCallable
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ data: { success: true } });
    const request = {
      userId: 'player-1',
      grigliataTransition: {
        backgroundId: 'map-1',
        tokenId: 'player-1',
        expectedPreviousActiveTokenId: 'player-2',
        expectedTurnCounter: 3,
        preserveStartedAt: true,
      },
      retryKey: 'grigliata-turn:map-1:player-1:3',
      retryScope: 'grigliata-turn:map-1:player-1',
    };

    await expect(consumeTurnEffects(request)).rejects.toBe(unavailable);
    const firstPayload = mockCallable.mock.calls[0][0];
    await expect(consumeTurnEffects(request)).resolves.toEqual({ success: true });
    const secondPayload = mockCallable.mock.calls[1][0];

    expect(secondPayload.operationId).toBe(firstPayload.operationId);
    expect(secondPayload.grigliataTransition).toEqual(request.grigliataTransition);
  });

  test('does not reuse a retained operation after the transition scope advances', async () => {
    const unavailable = Object.assign(new Error('offline'), { code: 'functions/unavailable' });
    mockCallable
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValue({ data: { success: true } });
    const buildRequest = (turnCounter) => ({
      userId: 'player-1',
      grigliataTransition: {
        backgroundId: 'map-1',
        tokenId: 'player-1',
        expectedPreviousActiveTokenId: 'player-2',
        expectedTurnCounter: turnCounter,
        preserveStartedAt: true,
      },
      retryKey: `grigliata-turn:map-1:player-1:session-1:${turnCounter}`,
      retryScope: 'grigliata-turn:map-1:player-1',
    });
    const ambiguousRequest = buildRequest(3);

    await expect(consumeTurnEffects(ambiguousRequest)).rejects.toBe(unavailable);
    const ambiguousOperationId = mockCallable.mock.calls[0][0].operationId;

    await expect(consumeTurnEffects(buildRequest(4))).resolves.toEqual({ success: true });
    const advancedOperationId = mockCallable.mock.calls[1][0].operationId;

    await expect(consumeTurnEffects(ambiguousRequest)).resolves.toEqual({ success: true });
    const laterOperationId = mockCallable.mock.calls[2][0].operationId;

    expect(advancedOperationId).not.toBe(ambiguousOperationId);
    expect(laterOperationId).not.toBe(ambiguousOperationId);
    expect(mockCallable.mock.calls.every(([payload]) => payload.retryScope === undefined)).toBe(true);
  });

  test('generates IDs accepted by the shared server contract', () => {
    expect(createUserOperationId('purchase')).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/);
  });

  test('reuses an operation ID only when the same logical-action retry key is supplied', async () => {
    const unavailable = Object.assign(new Error('offline'), { code: 'functions/unavailable' });
    mockCallable
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({ data: { success: true } });

    await expect(purchaseItem({ itemId: 'sword-1', retryKey: 'user-1:purchase-flow-1' })).rejects.toBe(unavailable);
    const firstOperationId = mockCallable.mock.calls[0][0].operationId;
    await expect(purchaseItem({ itemId: 'sword-1', retryKey: 'user-1:purchase-flow-1' })).resolves.toEqual({ success: true });
    expect(mockCallable.mock.calls[1][0].operationId).toBe(firstOperationId);
  });

  test('releases a logical-action operation ID after a definitive callable failure', async () => {
    const invalid = Object.assign(new Error('invalid'), { code: 'functions/invalid-argument' });
    mockCallable
      .mockRejectedValueOnce(invalid)
      .mockResolvedValueOnce({ data: { success: true } });

    await expect(purchaseItem({ itemId: 'sword-1', retryKey: 'user-1:purchase-flow-2' })).rejects.toBe(invalid);
    const firstOperationId = mockCallable.mock.calls[0][0].operationId;
    await purchaseItem({ itemId: 'sword-1', retryKey: 'user-1:purchase-flow-2' });
    expect(mockCallable.mock.calls[1][0].operationId).not.toBe(firstOperationId);
  });

  test('does not collapse concurrent identical resource deltas into one operation', async () => {
    await Promise.all([
      updateResource({ userId: 'user-1', resource: 'hp', mode: 'delta', value: -1 }),
      updateResource({ userId: 'user-1', resource: 'hp', mode: 'delta', value: -1 }),
    ]);

    expect(mockCallable).toHaveBeenCalledTimes(2);
    const [firstPayload, secondPayload] = mockCallable.mock.calls.map(([payload]) => payload);
    expect(secondPayload).toMatchObject({ userId: 'user-1', resource: 'hp', mode: 'delta', value: -1 });
    expect(secondPayload.operationId).not.toBe(firstPayload.operationId);
  });
});
