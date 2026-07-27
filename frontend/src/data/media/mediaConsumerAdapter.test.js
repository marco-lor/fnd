import { Task07MediaPipelineError } from './mediaErrors';
import {
  buildTask07MediaEntityPatch,
  buildTask07MediaOperationId,
  describeTask07ConsumerOutcome,
  getTask07PreviousAssetId,
  runTask07ConsumerUpload,
  task07ConsumerNeedsAttention,
} from './mediaConsumerAdapter';

const file = {
  name: 'hero portrait.png',
  type: 'image/png',
  size: 1234,
  lastModified: 5678,
};
const previousAssetId = `m_${'a'.repeat(40)}`;
const media = {
  schemaVersion: 1,
  contractVersion: 1,
  assetId: `m_${'b'.repeat(40)}`,
  kind: 'avatar',
  state: 'ready',
  original: {
    path: `media/v1/avatar/user-1/m_${'b'.repeat(40)}/original/source.png`,
    contentType: 'image/png',
    bytes: 1234,
    width: 400,
    height: 400,
    generation: '7',
  },
  variants: {},
};

describe('Task 07 media consumer adapter', () => {
  test('builds a stable bounded operation ID from the explicit upload revision', () => {
    const input = {
      kind: 'avatar',
      ownerUid: 'user-1',
      entityId: 'user-1',
      file,
      revision: 1700000000000,
    };
    const first = buildTask07MediaOperationId(input);
    const second = buildTask07MediaOperationId(input);

    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
    expect(first.length).toBeLessThanOrEqual(128);
    expect(buildTask07MediaOperationId({
      ...input,
      revision: 1700000000001,
    })).not.toBe(first);
  });

  test('does not invoke the pipeline when the rollout flag is disabled', async () => {
    const runPipeline = jest.fn();

    await expect(runTask07ConsumerUpload({}, {
      enabled: false,
      runPipeline,
    })).resolves.toEqual({
      handled: false,
      status: 'legacy',
    });
    expect(runPipeline).not.toHaveBeenCalled();
  });

  test('passes the previous asset and exact finalized media to the entity commit', async () => {
    const commitEntity = jest.fn(async () => {});
    const runPipeline = jest.fn(async (input) => {
      expect(input.previousAssetId).toBe(previousAssetId);
      await input.commitEntity(media);
      return {
        assetId: media.assetId,
        media,
        retirement: {
          requested: true,
          assetId: previousAssetId,
          state: 'superseded',
          replay: false,
          graceHours: 24,
        },
      };
    });

    const outcome = await runTask07ConsumerUpload({
      file,
      ownerUid: 'user-1',
      entityId: 'user-1',
      operationId: 'task07:avatar:revision:0123456789abcdef',
      kind: 'avatar',
      previousAssetId,
      commitEntity,
    }, {
      enabled: true,
      runPipeline,
    });

    expect(commitEntity).toHaveBeenCalledTimes(1);
    expect(commitEntity).toHaveBeenCalledWith(media);
    expect(outcome).toMatchObject({
      handled: true,
      status: 'complete',
      media,
    });
  });

  test('surfaces an ambiguous confirm failure without rethrowing or falling back', async () => {
    const commitEntity = jest.fn(async () => {});
    const runPipeline = jest.fn(async (input) => {
      await input.commitEntity(media);
      throw new Task07MediaPipelineError('confirm unavailable', {
        code: 'unavailable',
        stage: 'confirm',
        assetId: media.assetId,
        committed: true,
      });
    });

    const outcome = await runTask07ConsumerUpload({
      commitEntity,
    }, {
      enabled: true,
      runPipeline,
    });

    expect(commitEntity).toHaveBeenCalledWith(media);
    expect(outcome).toMatchObject({
      handled: true,
      status: 'committed-confirm-pending',
      assetId: media.assetId,
      media,
      error: {
        code: 'unavailable',
        message: 'confirm unavailable',
      },
    });
    expect(task07ConsumerNeedsAttention(outcome)).toBe(true);
    expect(describeTask07ConsumerOutcome(outcome, 'Avatar'))
      .toMatch(/saved.*confirmation is pending.*Do not upload it again/i);
  });

  test('surfaces an unknown commit acknowledgement without abandoning or inviting retry', async () => {
    const commitEntity = jest.fn(async () => {
      throw new Error('connection lost after write');
    });
    const runPipeline = jest.fn(async (input) => {
      try {
        await input.commitEntity(media);
      } catch (cause) {
        throw new Task07MediaPipelineError('commit acknowledgement unknown', {
          code: 'unavailable',
          stage: 'commit',
          assetId: media.assetId,
          committed: false,
          commitAttempted: true,
          cause,
        });
      }
      throw new Error('Expected the commit mock to reject.');
    });

    const outcome = await runTask07ConsumerUpload({
      commitEntity,
    }, {
      enabled: true,
      runPipeline,
    });

    expect(outcome).toMatchObject({
      handled: true,
      status: 'commit-acknowledgement-unknown',
      assetId: media.assetId,
      media,
    });
    expect(task07ConsumerNeedsAttention(outcome)).toBe(true);
    expect(describeTask07ConsumerOutcome(outcome, 'Map image'))
      .toMatch(/acknowledgement is uncertain.*Do not upload it again/i);
  });

  test('rethrows pre-commit failures so the consumer cannot treat them as saved', async () => {
    const error = new Task07MediaPipelineError('upload failed', {
      stage: 'upload',
      committed: false,
    });
    await expect(runTask07ConsumerUpload({
      commitEntity: jest.fn(),
    }, {
      enabled: true,
      runPipeline: jest.fn(async () => {
        throw error;
      }),
    })).rejects.toBe(error);
  });

  test('builds a path-only compatibility patch and validates previous asset IDs', () => {
    const patch = buildTask07MediaEntityPatch(media, {
      includeEmptyImageUrl: true,
    });
    expect(patch).toEqual({
      media,
      imagePath: media.original.path,
      imageUrl: '',
    });
    expect(patch.media).toBe(media);
    expect(JSON.stringify(patch)).not.toMatch(/https?:|downloadurl|bearer|token=/i);
    expect(getTask07PreviousAssetId({ media: { assetId: previousAssetId } }))
      .toBe(previousAssetId);
    expect(getTask07PreviousAssetId({ General: { media: { assetId: previousAssetId } } }))
      .toBe(previousAssetId);
    expect(getTask07PreviousAssetId({ media: { assetId: 'not-an-asset' } }))
      .toBeNull();
  });
});
