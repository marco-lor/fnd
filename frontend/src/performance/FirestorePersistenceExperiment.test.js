import { cleanupPersistenceExperimentBridge } from './FirestorePersistenceExperiment';

describe('Firestore persistence experiment lifecycle', () => {
  test('deduplicates unmount cleanup and requests terminate plus persistence clear', async () => {
    const cleanup = jest.fn().mockResolvedValue({ terminated: true, cleared: true });
    const bridge = { cleanup };

    const first = cleanupPersistenceExperimentBridge(bridge);
    const second = cleanupPersistenceExperimentBridge(bridge);

    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ terminated: true, cleared: true });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledWith({ clearPersistence: true });
  });

  test('treats a missing bridge as already cleaned', async () => {
    await expect(cleanupPersistenceExperimentBridge(null)).resolves.toEqual({
      alreadyCleaned: true,
      cleared: false,
    });
  });

  test('evicts a rejected cleanup so a later unmount can retry', async () => {
    const cleanup = jest.fn()
      .mockRejectedValueOnce(new Error('temporary cleanup failure'))
      .mockResolvedValueOnce({ terminated: true, cleared: true });
    const bridge = { cleanup };

    await expect(cleanupPersistenceExperimentBridge(bridge)).rejects.toThrow('temporary cleanup failure');
    await expect(cleanupPersistenceExperimentBridge(bridge)).resolves.toEqual({
      terminated: true,
      cleared: true,
    });
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
});
