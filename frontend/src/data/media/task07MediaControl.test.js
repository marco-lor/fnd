import {
  LEGACY_TASK07_MEDIA_CONTROL,
  loadTask07MediaMode,
  normalizeTask07MediaControl,
  task07MediaModeForActor,
  task07ModeReadsDerivatives,
  task07ModeWritesV1,
} from './task07MediaControl';
import { getTask07MediaControlDocument } from '../configRepository';

jest.mock('../configRepository', () => ({
  getTask07MediaControlDocument: jest.fn(),
}));

const validControl = (mode = 'v1-write') => ({
  mode,
  schemaVersion: 1,
  policyVersion: 1,
  enabledPurposes: ['avatar', 'map'],
  enabledRoles: ['player', 'dm'],
  enabledUids: ['user-1'],
});

describe('Task 07 media rollout control', () => {
  beforeEach(() => {
    getTask07MediaControlDocument.mockReset();
  });

  test.each([
    null,
    {},
    { ...validControl(), mode: 'unknown' },
    { ...validControl(), schemaVersion: 2 },
    { ...validControl(), policyVersion: 2 },
    { ...validControl(), enabledUids: 'user-1' },
  ])('fails malformed or unknown configuration closed to legacy', (value) => {
    expect(normalizeTask07MediaControl(value)).toBe(LEGACY_TASK07_MEDIA_CONTROL);
  });

  test('requires purpose, role, and uid allowlists simultaneously', () => {
    const control = validControl('derivative-read');
    expect(task07MediaModeForActor({
      control,
      purpose: 'avatar',
      role: 'player',
      uid: 'user-1',
    })).toBe('derivative-read');
    expect(task07MediaModeForActor({
      control,
      purpose: 'foe',
      role: 'player',
      uid: 'user-1',
    })).toBe('legacy');
    expect(task07MediaModeForActor({
      control,
      purpose: 'avatar',
      role: 'webmaster',
      uid: 'user-1',
    })).toBe('legacy');
  });

  test('treats document read failure as legacy', async () => {
    getTask07MediaControlDocument.mockRejectedValue(new Error('denied'));
    await expect(loadTask07MediaMode({
      purpose: 'avatar',
      role: 'player',
      uid: 'user-1',
    })).resolves.toBe('legacy');
  });

  test('keeps read and write transitions explicit', () => {
    expect(task07ModeReadsDerivatives('shadow')).toBe(false);
    expect(task07ModeReadsDerivatives('derivative-read')).toBe(true);
    expect(task07ModeReadsDerivatives('v1-write')).toBe(true);
    expect(task07ModeWritesV1('derivative-read')).toBe(false);
    expect(task07ModeWritesV1('v1-write')).toBe(true);
  });
});
