import {
  buildTask07NestedMediaTarget,
  mintTask07EmbeddedMediaEntryId,
  task07EmbeddedMediaEntryId,
  withoutTask07EmbeddedMediaProjection,
  withTask07EmbeddedMedia,
} from './embeddedMedia';

jest.mock('./mediaWriterAdapter', () => ({
  runTask07ControlledWriterUpload: jest.fn(),
}));

test('embedded media identities are stable and preserve an existing identity', () => {
  const first = task07EmbeddedMediaEntryId({
    entry: {Nome: 'Afferra'},
    entityId: 'item-1',
    targetKind: 'catalog-item-spell',
    locator: 'Afferra',
  });
  expect(first).toMatch(/^n_[a-f0-9]{32}$/);
  expect(task07EmbeddedMediaEntryId({
    entry: {task07MediaEntryId: first},
    entityId: 'different',
    targetKind: 'catalog-item-spell',
    locator: 'renamed',
  })).toBe(first);
});

test('new embedded entities receive non-reusable stable identities', () => {
  const first = mintTask07EmbeddedMediaEntryId();
  const second = mintTask07EmbeddedMediaEntryId();
  expect(first).toMatch(/^n_[A-Za-z0-9._-]{1,127}$/);
  expect(second).toMatch(/^n_[A-Za-z0-9._-]{1,127}$/);
  expect(second).not.toBe(first);
});

test('renderer projection applies only the frozen binding for the entry ID', () => {
  const media = {assetId: `m_${'a'.repeat(40)}`};
  const parent = {
    task07EmbeddedMedia: {
      entry1: {targetKind: 'foe-spell', media, task07MediaRevision: 3},
    },
  };
  expect(withTask07EmbeddedMedia(parent, {
    task07MediaEntryId: 'entry1',
    imageUrl: 'legacy',
  }, 'foe-spell')).toEqual({
    task07MediaEntryId: 'entry1',
    imageUrl: 'legacy',
    media,
    task07MediaRevision: 3,
  });
  expect(withTask07EmbeddedMedia(
    parent,
    {task07MediaEntryId: 'missing'},
    'foe-spell'
  ))
    .toEqual({task07MediaEntryId: 'missing'});
  expect(withTask07EmbeddedMedia(
    parent,
    {task07MediaEntryId: 'entry1', imageUrl: 'legacy'},
    'foe-technique'
  )).toEqual({task07MediaEntryId: 'entry1', imageUrl: 'legacy'});
});

test('saving a projected nested entry never persists canonical descriptors', () => {
  expect(withoutTask07EmbeddedMediaProjection({
    name: 'Canonical technique',
    task07MediaEntryId: 'entry1',
    media: {assetId: `m_${'a'.repeat(40)}`},
    videoMedia: {assetId: `m_${'b'.repeat(40)}`},
    task07MediaRevision: 4,
    task07VideoMediaRevision: 3,
    mediaUpdatedAt: {seconds: 1},
    videoMediaUpdatedAt: {seconds: 2},
    removeImage: true,
  })).toEqual({
    name: 'Canonical technique',
    task07MediaEntryId: 'entry1',
    removeImage: true,
  });
});

test('nested target binds catalog keys and foe indices without mixing shapes', () => {
  expect(buildTask07NestedMediaTarget({
    parent: {},
    entry: {},
    entityId: 'item-1',
    targetKind: 'catalog-item-spell',
    entryKey: 'Afferra',
    slot: 'videoMedia',
  }).nestedTarget).toEqual(expect.objectContaining({
    kind: 'catalog-item-spell',
    entryKey: 'Afferra',
    entryIndex: null,
    slot: 'videoMedia',
  }));
  expect(() => buildTask07NestedMediaTarget({
    parent: {},
    entry: {},
    entityId: 'foe-1',
    targetKind: 'foe-spell',
    entryIndex: 0,
    slot: 'videoMedia',
  })).toThrow(/nested media target/);
});
