import {
  assertFoeRecoveryFence,
  persistFoeRecoveryWithMarker,
  runFencedFoeRecoveryWrite,
} from './foeRecoveryLifecycle';

const timestamp = (seconds, nanoseconds = 0) => ({ seconds, nanoseconds });

const transactionHarness = (current) => {
  const update = jest.fn();
  const runTransaction = async (_db, callback) => callback({
    get: async () => ({
      data: () => current,
      exists: () => Boolean(current),
    }),
    update,
  });
  return { runTransaction, update };
};

test('keeps the reconciliation marker after failure and clears it after retry', async () => {
  const marker = { reconciliation: { status: 'save-current' } };
  const markerRef = { current: marker };
  const failure = new Error('write unavailable');

  await expect(persistFoeRecoveryWithMarker({
    marker,
    markerRef,
    persist: async () => { throw failure; },
  })).rejects.toBe(failure);
  expect(markerRef.current).toBe(marker);

  await expect(persistFoeRecoveryWithMarker({
    marker,
    markerRef,
    persist: async () => 'update',
  })).resolves.toBe('update');
  expect(markerRef.current).toBe(null);
});

test('rejects a concurrent foe edit before the transaction can update', async () => {
  const { runTransaction, update } = transactionHarness({
    name: 'Changed elsewhere',
    updated_at: timestamp(12, 4),
  });

  await expect(runFencedFoeRecoveryWrite({
    db: {},
    expectedUpdatedAt: timestamp(12, 3),
    foeRef: {},
    payload: { name: 'My current edit', updated_at: {} },
    runTransaction,
  })).rejects.toMatchObject({ code: 'foe-recovery-edit-conflict' });
  expect(update).not.toHaveBeenCalled();
});

test('accepts an acknowledged retry when the payload is already persisted', async () => {
  const { runTransaction, update } = transactionHarness({
    name: 'My current edit',
    updated_at: timestamp(13),
  });

  await expect(runFencedFoeRecoveryWrite({
    db: {},
    expectedUpdatedAt: timestamp(12, 3),
    foeRef: {},
    payload: { name: 'My current edit', updated_at: {} },
    runTransaction,
  })).resolves.toBe('already-applied');
  expect(update).not.toHaveBeenCalled();
});

test('rejects a fresh read that still has a canonical media binding', () => {
  expect(() => assertFoeRecoveryFence({
    current: {
      media: { assetId: `m_${'a'.repeat(40)}` },
      updated_at: timestamp(12, 3),
    },
    exists: true,
    expectedUpdatedAt: timestamp(12, 3),
  })).toThrow(expect.objectContaining({ code: 'foe-recovery-media-conflict' }));
});
