import {
  runVersionedUserDataCommand,
  isUserDataCommandStageResolved,
  shouldUseAuthoritativeUserDataCommands,
} from './userDataCommandRouting';
import { USER_DATA_ROLLOUT_STAGES } from './domainSchema';

describe('user-data command rollout routing', () => {
  test.each([
    USER_DATA_ROLLOUT_STAGES.LEGACY_READ,
    USER_DATA_ROLLOUT_STAGES.SHADOW_VERIFY,
  ])('keeps legacy mutations active while V2 is dark (%s)', async (stage) => {
    const legacy = jest.fn(() => Promise.resolve('legacy'));
    const authoritative = jest.fn(() => Promise.resolve('v2'));

    await expect(runVersionedUserDataCommand({ stage, legacy, authoritative })).resolves.toBe('legacy');
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(authoritative).not.toHaveBeenCalled();
    expect(shouldUseAuthoritativeUserDataCommands(stage)).toBe(false);
    expect(isUserDataCommandStageResolved(stage)).toBe(true);
  });

  test.each([undefined, null, '', 'unexpected-stage'])('fails closed while rollout state is unresolved (%s)', async (stage) => {
    const legacy = jest.fn(() => Promise.resolve('legacy'));
    const authoritative = jest.fn(() => Promise.resolve('v2'));

    await expect(runVersionedUserDataCommand({ stage, legacy, authoritative })).rejects.toMatchObject({
      code: 'user-data-rollout-pending',
      retryable: true,
    });
    expect(legacy).not.toHaveBeenCalled();
    expect(authoritative).not.toHaveBeenCalled();
    expect(isUserDataCommandStageResolved(stage)).toBe(false);
  });

  test.each([
    USER_DATA_ROLLOUT_STAGES.DUAL_WRITE,
    USER_DATA_ROLLOUT_STAGES.NEW_READ_DUAL_WRITE,
    USER_DATA_ROLLOUT_STAGES.NEW_ONLY,
  ])('uses authoritative commands only in an activated stage (%s)', async (stage) => {
    const legacy = jest.fn(() => Promise.resolve('legacy'));
    const authoritative = jest.fn(() => Promise.resolve('v2'));

    await expect(runVersionedUserDataCommand({ stage, legacy, authoritative })).resolves.toBe('v2');
    expect(authoritative).toHaveBeenCalledTimes(1);
    expect(legacy).not.toHaveBeenCalled();
    expect(shouldUseAuthoritativeUserDataCommands(stage)).toBe(true);
    expect(isUserDataCommandStageResolved(stage)).toBe(true);
  });
});
