import { mutateCodex } from './codexRepository';
import { getCallable } from './functions/callableRegistry';
import { runTransaction, deleteField } from '../performance/firestore';
const { normalizeControl, projectLegacyCodex } = require('./codexModel');
jest.mock('../components/firebaseConfig', () => ({ db: {} }));
jest.mock('./functions/callableRegistry', () => ({ getCallable: jest.fn() }));
jest.mock('../performance/firestore', () => ({
  doc: (_db, ...parts) => ({ path: parts.join('/') }), labelFirestoreTarget: value => value,
  runTransaction: jest.fn(), deleteField: jest.fn(() => 'DELETE'), FieldPath: class { constructor(...parts) { this.parts = parts; } },
}));
const state = normalizeControl({ schemaVersion: 2, mode: 'v2', epoch: 4, generation: 'g1', metadataRevision: 3, collationLocale: 'en-US' });
const legacyControl = normalizeControl(null);
let source; let group; let transaction; let callable; let serverControl;
beforeEach(() => {
  jest.clearAllMocks(); source = { 'Some.Category': { 'Item.Name': { exact: [1, false, null] }, '12': 'numeric' } };
  group = projectLegacyCodex(source)[0]; serverControl = null;
  callable = jest.fn().mockResolvedValue({ data: { revision: 2 } }); getCallable.mockReturnValue(callable);
  transaction = { get: jest.fn(async target => { const data = target.path === 'utils/codex_control' ? serverControl : source; return { exists: () => data !== null, data: () => data }; }), update: jest.fn() };
  runTransaction.mockImplementation((_db, operation) => operation(transaction));
});
test.each(['category-add', 'category-delete', 'item-add', 'item-edit', 'item-delete'])('v2 %s sends only its exact registered server contract', async action => {
  const category = action === 'category-add' ? null : group.category;
  const item = ['item-edit', 'item-delete'].includes(action) ? group.items.find(row => row.legacyKey === 'Item.Name') : null;
  await mutateCodex({ action, control: state, category, item, legacyKey: '12', value: { unchangedType: true } });
  const payload = { action, epoch: 4, generation: 'g1' };
  if (action.startsWith('category-')) payload.metadataRevision = 3;
  if (category) Object.assign(payload, { categoryId: category.id, categoryRevision: 1 });
  if (item) Object.assign(payload, { itemId: item.id, itemRevision: 1 });
  if (action.endsWith('-add')) payload.legacyKey = '12';
  if (['item-add', 'item-edit'].includes(action)) payload.value = { unchangedType: true };
  expect(getCallable).toHaveBeenCalledWith('task12MutateCodex'); expect(callable).toHaveBeenCalledWith(payload); expect(runTransaction).not.toHaveBeenCalled();
});
test('server aborted errors are surfaced without automatic retries', async () => {
  callable.mockRejectedValue(Object.assign(new Error('changed'), { code: 'functions/aborted' }));
  await expect(mutateCodex({ action: 'item-add', control: state, category: group.category, legacyKey: 'New', value: 'body' })).rejects.toMatchObject({ code: 'functions/aborted' });
  expect(callable).toHaveBeenCalledTimes(1);
});
test.each(['frozen', 'rollback-frozen'])('%s cannot dispatch a mutation', async mode => {
  await expect(mutateCodex({ action: 'category-add', control: { ...state, mode }, legacyKey: 'New' })).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(callable).not.toHaveBeenCalled(); expect(runTransaction).not.toHaveBeenCalled();
});
test('legacy editor preserves exact literal paths and structured values in a transaction', async () => {
  const item = group.items.find(row => row.legacyKey === 'Item.Name');
  await mutateCodex({ action: 'item-edit', control: legacyControl, category: group.category, item, value: { exact: [2, false, null] } });
  expect(transaction.update).toHaveBeenCalledWith({ path: 'utils/codex' }, { parts: ['Some.Category', 'Item.Name'] }, { exact: [2, false, null] });
  expect(runTransaction.mock.lastCall[2]).toEqual({ maxAttempts: 1 }); expect(callable).not.toHaveBeenCalled();
});
test('legacy category duplicate checks include off-page case variants; item equality remains case-sensitive', async () => {
  await expect(mutateCodex({ action: 'category-add', control: legacyControl, legacyKey: 'some.category' })).rejects.toMatchObject({ code: 'already-exists' });
  await expect(mutateCodex({ action: 'item-add', control: legacyControl, category: group.category, legacyKey: '12', value: 'body' })).rejects.toMatchObject({ code: 'already-exists' });
  await mutateCodex({ action: 'item-add', control: legacyControl, category: group.category, legacyKey: 'item.name', value: 'body' });
  expect(transaction.update.mock.lastCall[1]).toEqual({ parts: ['Some.Category', 'item.name'] });
});
test('legacy concurrent item change, cutover and session changes fence writes', async () => {
  const context = { action: 'item-delete', control: legacyControl, category: group.category, item: group.items.find(row => row.legacyKey === 'Item.Name') };
  source['Some.Category']['Item.Name'] = 'changed';
  await expect(mutateCodex(context)).rejects.toMatchObject({ code: 'aborted' });
  serverControl = { ...state, mode: 'frozen' };
  await expect(mutateCodex(context)).rejects.toMatchObject({ code: 'aborted' });
  await expect(mutateCodex(context, () => false)).rejects.toMatchObject({ code: 'aborted' });
  expect(transaction.update).not.toHaveBeenCalled(); expect(deleteField).not.toHaveBeenCalled();
});

test('legacy exact-content fence protects category deletion even when concurrent edits keep item count', async () => {
  const legacyContent = JSON.stringify(source);
  source['Some.Category']['12'] = 'changed';
  await expect(mutateCodex({ action: 'category-delete', control: legacyControl, category: group.category, legacyContent })).rejects.toMatchObject({ code: 'aborted' });
  expect(transaction.update).not.toHaveBeenCalled();
});
test('local legacy tokens never enter callable payloads', async () => {
  await mutateCodex({ action: 'category-add', control: state, legacyKey: 'New', legacyContent: 'private-local-only' });
  expect(JSON.stringify(callable.mock.lastCall)).not.toContain('private-local-only');
});
