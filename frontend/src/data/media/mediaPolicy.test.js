import {
  getTask07MediaPurpose,
  getTask07RuntimeBudgetProfile,
  getTask07VariantCandidates,
  selectTask07VariantName,
  TASK07_MEDIA_PURPOSES,
  validateTask07UploadCandidate,
} from './mediaPolicy';

describe('Task 07 media policy', () => {
  test('covers every planned purpose and rejects animated/new unsupported formats', () => {
    expect(TASK07_MEDIA_PURPOSES).toEqual(expect.arrayContaining([
      'avatar',
      'item',
      'token',
      'npc',
      'foe',
      'technique',
      'spell',
      'map',
      'technique-video',
      'spell-video',
      'map-video',
      'music',
    ]));
    expect(validateTask07UploadCandidate({
      file: new File(['gif'], 'animated.gif', { type: 'image/gif' }),
      purpose: 'avatar',
    })).toEqual(expect.objectContaining({
      ok: false,
      code: 'unsupported-format',
    }));
    expect(validateTask07UploadCandidate({
      file: new File(['svg'], 'vector.svg', { type: 'image/svg+xml' }),
      purpose: 'item',
    })).toEqual(expect.objectContaining({
      ok: false,
      code: 'unsupported-format',
    }));
  });

  test('matches the required dimensions, duration, and quality policy', () => {
    expect(getTask07MediaPurpose('avatar')).toEqual(expect.objectContaining({
      maxBytes: 5 * 1024 * 1024,
      maxPixels: 16_000_000,
    }));
    expect(getTask07MediaPurpose('avatar').variants).toEqual(
      expect.objectContaining({
        thumbnail: expect.objectContaining({ width: 64, quality: 78 }),
        thumbnail2x: expect.objectContaining({ width: 128, quality: 78 }),
        card: expect.objectContaining({ width: 256, quality: 78 }),
      })
    );
    expect(getTask07MediaPurpose('map')).toEqual(expect.objectContaining({
      maxBytes: 15 * 1024 * 1024,
      maxPixels: 32_000_000,
    }));
    expect(getTask07MediaPurpose('map-video')).toEqual(expect.objectContaining({
      maxDurationMs: 10 * 60 * 1000,
      contentTypes: ['video/mp4', 'video/webm'],
    }));
    expect(getTask07MediaPurpose('music').maxDurationMs).toBe(60 * 60 * 1000);
  });

  test('selects one density-appropriate approved variant', () => {
    expect(getTask07VariantCandidates('item', 'thumbnail').map(({ name }) => name))
      .toEqual(['thumbnail', 'thumbnail2x']);
    expect(selectTask07VariantName({
      purpose: 'item',
      use: 'thumbnail',
      renderedWidth: 80,
      devicePixelRatio: 1,
    })).toBe('thumbnail');
    expect(selectTask07VariantName({
      purpose: 'item',
      use: 'thumbnail',
      renderedWidth: 80,
      devicePixelRatio: 2,
    })).toBe('thumbnail2x');
  });

  test('uses the compact profile for compact viewports or save-data', () => {
    expect(getTask07RuntimeBudgetProfile()).toEqual(expect.objectContaining({
      maxConcurrentRequests: 4,
      maxUnpinnedRecords: 96,
    }));
    expect(getTask07RuntimeBudgetProfile({ saveData: true })).toEqual(
      expect.objectContaining({
        maxConcurrentRequests: 2,
        maxUnpinnedRecords: 64,
      })
    );
  });
});
