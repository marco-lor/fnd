import {
  buildTask07DetachRetryKey,
  buildTask07PrepareRetryKey,
  getTask07ExpectedRevisionForKind,
  getTask07PreviousAssetIdForKind,
  runTask07ControlledWriterUpload,
  task07MediaRevisionFieldForKind,
  task07MediaSlotForKind,
} from './mediaWriterAdapter';

const file = Object.assign(new Blob(['image'], { type: 'image/png' }), {
  lastModified: 42,
  name: 'portrait.png',
});

describe('Task 07 writer adapter', () => {
  test('maps image and video slots to independent revision and asset identities', () => {
    const target = {
      media: { assetId: `m_${'a'.repeat(40)}` },
      videoMedia: { assetId: `m_${'b'.repeat(40)}` },
      task07MediaRevision: 4,
      task07VideoMediaRevision: 7,
    };

    expect(task07MediaSlotForKind('spell')).toBe('media');
    expect(task07MediaSlotForKind('spell-video')).toBe('videoMedia');
    expect(task07MediaRevisionFieldForKind('technique')).toBe('task07MediaRevision');
    expect(task07MediaRevisionFieldForKind('technique-video'))
      .toBe('task07VideoMediaRevision');
    expect(getTask07ExpectedRevisionForKind(target, 'spell')).toBe(4);
    expect(getTask07ExpectedRevisionForKind(target, 'spell-video')).toBe(7);
    expect(getTask07PreviousAssetIdForKind(target, 'spell'))
      .toBe(`m_${'a'.repeat(40)}`);
    expect(getTask07PreviousAssetIdForKind(target, 'spell-video'))
      .toBe(`m_${'b'.repeat(40)}`);
  });

  test('fails closed before preparation when the actor is outside v1-write', async () => {
    const prepareEntity = jest.fn();
    const runWithReceipt = jest.fn();
    const outcome = await runTask07ControlledWriterUpload({
      actorUid: 'actor-1',
      role: 'dm',
      ownerUid: 'owner-1',
      entityId: 'item-1',
      kind: 'item',
      referenceScope: 'global-catalog',
      file,
      prepareEntity,
    }, {
      isEnabled: jest.fn(async () => false),
      runWithReceipt,
    });

    expect(outcome).toEqual({ handled: false, status: 'legacy' });
    expect(prepareEntity).not.toHaveBeenCalled();
    expect(runWithReceipt).not.toHaveBeenCalled();
  });

  test('forwards stable receipt, CAS, rollback, scope, and caller-owned signal', async () => {
    const controller = new AbortController();
    const prepareEntity = jest.fn();
    const rollbackPreparedEntity = jest.fn();
    const runConsumer = jest.fn(async () => ({ handled: true, status: 'complete' }));
    const runWithReceipt = jest.fn(async (input) => {
      expect(input).toEqual(expect.objectContaining({
        actorUid: 'actor-1',
        ownerUid: 'owner-1',
        entityId: 'item-1',
        kind: 'item',
        expectedRevision: 3,
        previousAssetId: `m_${'c'.repeat(40)}`,
        referenceScope: 'global-catalog',
        signal: controller.signal,
      }));
      return input.invoke({
        operationId: 'task07:item:r3.a0:0123456789012345678901234567890123456789',
        stableRevision: 'r3.a0',
        signal: controller.signal,
      });
    });

    await runTask07ControlledWriterUpload({
      actorUid: 'actor-1',
      role: 'dm',
      ownerUid: 'owner-1',
      entityId: 'item-1',
      kind: 'item',
      referenceScope: 'global-catalog',
      file,
      target: {
        media: { assetId: `m_${'c'.repeat(40)}` },
        task07MediaRevision: 3,
      },
      prepareEntity,
      rollbackPreparedEntity,
      signal: controller.signal,
    }, {
      isEnabled: jest.fn(async () => true),
      runConsumer,
      runWithReceipt,
    });

    expect(runConsumer).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'task07:item:r3.a0:0123456789012345678901234567890123456789',
      previousAssetId: `m_${'c'.repeat(40)}`,
      expectedRevision: 3,
      prepareEntity,
      rollbackPreparedEntity,
      signal: controller.signal,
    }));
  });

  test('builds the same bounded preparation key for the same logical file', () => {
    const input = {
      kind: 'spell',
      ownerUid: 'owner-1',
      entityHint: 'content-1',
      file,
    };
    expect(buildTask07PrepareRetryKey(input))
      .toBe(buildTask07PrepareRetryKey(input));
    expect(buildTask07PrepareRetryKey(input)).toMatch(
      /^task07-prepare-spell-[a-f0-9]{16}$/
    );
  });

  test('builds a stable bounded detach identity from the exact canonical asset', () => {
    const input = {
      kind: 'spell-video',
      ownerUid: 'owner-1',
      entityId: 'content-1',
      assetId: `m_${'d'.repeat(40)}`,
    };
    expect(buildTask07DetachRetryKey(input))
      .toBe(buildTask07DetachRetryKey(input));
    expect(buildTask07DetachRetryKey(input)).toMatch(
      /^task07-detach-spell-video-[a-f0-9]{16}$/
    );
  });
});
