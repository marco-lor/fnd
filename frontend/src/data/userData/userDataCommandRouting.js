import { USER_DATA_ROLLOUT_STAGES } from './domainSchema';

const AUTHORITATIVE_COMMAND_STAGES = new Set([
  USER_DATA_ROLLOUT_STAGES.DUAL_WRITE,
  USER_DATA_ROLLOUT_STAGES.NEW_READ_DUAL_WRITE,
  USER_DATA_ROLLOUT_STAGES.NEW_ONLY,
]);

const LEGACY_COMMAND_STAGES = new Set([
  USER_DATA_ROLLOUT_STAGES.LEGACY_READ,
  USER_DATA_ROLLOUT_STAGES.SHADOW_VERIFY,
]);

export class UserDataCommandStagePendingError extends Error {
  constructor() {
    super('User-data rollout state is still resolving. Try the action again.');
    this.name = 'UserDataCommandStagePendingError';
    this.code = 'user-data-rollout-pending';
    this.retryable = true;
  }
}

export const isUserDataCommandStageResolved = (stage) => (
  LEGACY_COMMAND_STAGES.has(stage) || AUTHORITATIVE_COMMAND_STAGES.has(stage)
);

export const shouldUseAuthoritativeUserDataCommands = (stage) => (
  AUTHORITATIVE_COMMAND_STAGES.has(stage)
);

export const runVersionedUserDataCommand = ({
  stage,
  legacy,
  authoritative,
}) => {
  if (typeof legacy !== 'function' || typeof authoritative !== 'function') {
    throw new TypeError('Versioned user-data commands require legacy and authoritative handlers.');
  }
  if (!isUserDataCommandStageResolved(stage)) {
    return Promise.reject(new UserDataCommandStagePendingError());
  }
  return shouldUseAuthoritativeUserDataCommands(stage)
    ? authoritative()
    : legacy();
};
