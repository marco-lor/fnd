import {
  runCharacterCreationAvatarV1Write,
  task07ProfileRevision,
} from './characterCreationAvatarMedia';

const file = {
  name: 'avatar.png',
  type: 'image/png',
  size: 123,
  lastModified: 456,
};

const createHarness = ({
  consumerOutcome = { handled: true, status: 'complete', assetId: 'asset-1' },
  finalizeError = null,
} = {}) => {
  const order = [];
  let receiptWouldClear = null;
  const runConsumerUpload = jest.fn(async (input) => {
    order.push('attach');
    expect(input).toEqual(expect.objectContaining({
      entityId: 'user-1',
      expectedRevision: 4,
      file,
      kind: 'avatar',
      operationId: 'task07:avatar:operation',
      ownerUid: 'user-1',
      previousAssetId: `m_${'a'.repeat(40)}`,
    }));
    return consumerOutcome;
  });
  const finalizeCharacter = jest.fn(async () => {
    order.push('finalize-character');
    if (finalizeError) throw finalizeError;
  });
  const runWithReceipt = jest.fn(async (input) => {
    expect(input).toEqual(expect.objectContaining({
      actorUid: 'user-1',
      entityId: 'user-1',
      expectedRevision: 4,
      file,
      kind: 'avatar',
      ownerUid: 'user-1',
      previousAssetId: `m_${'a'.repeat(40)}`,
    }));
    const outcome = await input.invoke({
      operationId: 'task07:avatar:operation',
      signal: input.signal,
    });
    receiptWouldClear = ![
      'attached-result-unknown',
      'attach-acknowledgement-unknown',
    ].includes(outcome?.status);
    return outcome;
  });
  return {
    finalizeCharacter,
    getReceiptWouldClear: () => receiptWouldClear,
    order,
    runConsumerUpload,
    runWithReceipt,
  };
};

const run = (harness) => runCharacterCreationAvatarV1Write({
  actorUid: 'user-1',
  expectedRevision: 4,
  file,
  finalizeCharacter: harness.finalizeCharacter,
  previousAssetId: `m_${'a'.repeat(40)}`,
  runConsumerUpload: harness.runConsumerUpload,
  runWithReceipt: harness.runWithReceipt,
  signal: new AbortController().signal,
});

test('normalizes the live profile revision and fails closed on malformed values', () => {
  expect(task07ProfileRevision({ task07MediaRevision: 7 })).toBe(7);
  expect(task07ProfileRevision({ task07MediaRevision: -1 })).toBe(0);
  expect(task07ProfileRevision({ task07MediaRevision: '7' })).toBe(0);
  expect(task07ProfileRevision(null)).toBe(0);
});

test('attaches the avatar before declaring character creation complete', async () => {
  const harness = createHarness();
  await expect(run(harness)).resolves.toEqual(expect.objectContaining({
    status: 'complete',
  }));
  expect(harness.order).toEqual(['attach', 'finalize-character']);
  expect(harness.getReceiptWouldClear()).toBe(true);
});

test('does not finalize character data while attachment needs attention', async () => {
  const harness = createHarness({
    consumerOutcome: {
      handled: true,
      status: 'attach-acknowledgement-unknown',
    },
  });
  await expect(run(harness)).resolves.toEqual(expect.objectContaining({
    status: 'attach-acknowledgement-unknown',
  }));
  expect(harness.finalizeCharacter).not.toHaveBeenCalled();
  expect(harness.getReceiptWouldClear()).toBe(false);
});

test('post-attach character failure retains the durable receipt', async () => {
  const harness = createHarness({
    finalizeError: new Error('profile write failed'),
  });
  await expect(run(harness)).resolves.toEqual(expect.objectContaining({
    handled: true,
    status: 'attached-result-unknown',
    characterFinalizationFailed: true,
    error: 'profile write failed',
  }));
  expect(harness.order).toEqual(['attach', 'finalize-character']);
  expect(harness.getReceiptWouldClear()).toBe(false);
});
