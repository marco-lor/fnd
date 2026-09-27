import { getCodexCategories, getCodexMetadataPage, getCodexItemsPage, subscribeCodexItemsPage, invalidateCodex } from './codexRepository';
import { __resetRepositoryRuntimeForTests, setRepositoryActor } from './repositoryRuntime';
import { getDoc, getDocs, onSnapshot } from '../performance/firestore';
const { projectLegacyCodex } = require('./codexModel');
jest.mock('../components/firebaseConfig', () => ({ db: {} }));
jest.mock('../performance/firestore', () => ({
  doc: (_db, ...parts) => ({ path: parts.join('/') }),
  collection: (_db, ...parts) => ({ path: parts.join('/') }),
  query: (target, ...constraints) => ({ ...target, constraints }),
  orderBy: (field) => ({ type: 'order', field }), documentId: () => '__name__',
  startAfter: (...values) => ({ type: 'cursor', values }), limit: count => ({ type: 'limit', count }),
  getDoc: jest.fn(), getDocs: jest.fn(), onSnapshot: jest.fn(), updateDoc: jest.fn(),
  labelFirestoreTarget: (target) => target,
}));
const state = { schemaVersion: 2, mode: 'v2', epoch: 1, generation: 'g1', metadataRevision: 1, collationLocale: 'en-US' };
const legacy = { Razze: Object.fromEntries(Array.from({ length: 61 }, (_, n) => [`Razza ${n}`, `  Description ${n}\n`])),
  lingue: { Comune: 'testo' }, conoscenze: { Arcano: { levels: [1, null] } }, professioni: { Fabbro: false } };
let groups;
let activeState;
const docSnapshot = data => ({ exists: () => data !== null, data: () => data });
const querySnapshot = rows => ({ docs: rows.map(({ id, ...data }) => ({ id, data: () => data })) });
beforeEach(() => {
  __resetRepositoryRuntimeForTests(); jest.clearAllMocks();
  groups = projectLegacyCodex(legacy, 'en-US'); activeState = state;
  getDoc.mockImplementation(async ({ path }) => {
    if (path === 'utils/codex_control') return docSnapshot(activeState);
    if (path === 'utils/codex') return docSnapshot(legacy);
    const group = groups.find(x => path.endsWith(`/categories/${x.category.id}`));
    if (group) { const { id, ...data } = group.category; return docSnapshot(data); }
    throw new Error(`Unexpected path ${path}`);
  });
  getDocs.mockImplementation(async target => {
    const group = groups.find(x => target.path.endsWith(`/categories/${x.category.id}/items`));
    const rows = [...(group ? group.items : groups.map(x => x.category))];
    const field = target.constraints.find(x => x.type === 'order').field;
    rows.sort((a, b) => a[field] - b[field] || a.id.localeCompare(b.id));
    const after = target.constraints.find(x => x.type === 'cursor');
    const start = after ? rows.findIndex(x => x.id === after.values[1]) + 1 : 0;
    return querySnapshot(rows.slice(start, start + target.constraints.find(x => x.type === 'limit').count));
  });
});

test('absent control preserves legacy default and requested-category compatibility', async () => {
  activeState = null;
  expect(await getCodexCategories(['Razze'])).toEqual({ Razze: legacy.Razze });
  expect(await getCodexCategories(['missing'])).toEqual({});
  expect(getDocs).not.toHaveBeenCalled();
});

test('malformed control never silently falls back to the legacy document', async () => {
  activeState = [];
  await expect(getCodexCategories(['Razze'])).rejects.toThrow(/control/);
  expect(getDoc.mock.calls.some(([target]) => target.path === 'utils/codex')).toBe(false);
});

test('rollback epoch does not reuse the pre-cutover legacy aggregate', async () => {
  activeState = null;
  await getCodexCategories(['Razze']);
  activeState = { ...state, mode: 'legacy', epoch: 5 };
  const original = getDoc.getMockImplementation();
  getDoc.mockImplementation(target => target.path === 'utils/codex'
    ? Promise.resolve(docSnapshot({ Razze: { Restored: 'new v2 write retained' } })) : original(target));
  expect(await getCodexCategories(['Razze'])).toEqual({ Razze: { Restored: 'new v2 write retained' } });
});

test('a cutover during legacy acquisition cannot publish a stale legacy result', async () => {
  activeState = null;
  const original = getDoc.getMockImplementation();
  getDoc.mockImplementation(async target => {
    if (target.path === 'utils/codex') { activeState = state; return docSnapshot({ Razze: { Stale: 'old' } }); }
    return original(target);
  });
  expect(await getCodexCategories(['Razze'])).toEqual({ Razze: legacy.Razze });
});

test('all consumer options traverse every bounded source-order page with no unrelated bodies', async () => {
  expect(await getCodexCategories(['Razze'])).toEqual({ Razze: legacy.Razze });
  const itemCalls = getDocs.mock.calls.filter(([target]) => target.path.endsWith('/items'));
  expect(itemCalls).toHaveLength(3);
  expect(itemCalls.every(([target]) => target.path.includes(groups[0].category.id))).toBe(true);
  expect(itemCalls.every(([target]) => target.constraints.some(x => x.type === 'limit' && x.count === 26))).toBe(true);
  expect(getDoc.mock.calls.some(([target]) => target.path === 'utils/codex')).toBe(false);
  expect(await getCodexCategories(['lingue', 'conoscenze', 'professioni'])).toEqual({ lingue: legacy.lingue, conoscenze: legacy.conoscenze, professioni: legacy.professioni });
});

test('metadata and active page fetch <=25+1 rows; stale revision cursor is rejected', async () => {
  expect((await getCodexMetadataPage({ control: state })).items).toHaveLength(4);
  const category = groups[0].category;
  const first = await getCodexItemsPage({ control: state, category });
  expect(first.items).toHaveLength(25);
  expect(first.hasMore).toBe(true);
  await expect(getCodexItemsPage({ control: state, category: { ...category, revision: 2 }, cursor: first.cursor })).rejects.toThrow(/cursor/i);
});

test('category revision and explicit invalidation refresh only affected option cache', async () => {
  await getCodexCategories(['Razze']);
  getDocs.mockClear();
  await getCodexCategories(['Razze']);
  expect(getDocs.mock.calls.filter(([target]) => target.path.endsWith('/items'))).toHaveLength(0);
  groups[0] = { category: { ...groups[0].category, revision: 2 }, items: groups[0].items.map((x, i) => i ? x : { ...x, value: 'updated', revision: 2 }) };
  expect((await getCodexCategories(['Razze'])).Razze['Razza 0']).toBe('updated');
  invalidateCodex();
  getDocs.mockClear();
  await getCodexCategories(['Razze']);
  expect(getDocs.mock.calls.filter(([target]) => target.path.endsWith('/items'))).toHaveLength(3);
});

test('session changes reject pending multi-page reads without leaking old-account data', async () => {
  let release;
  const original = getDocs.getMockImplementation();
  getDocs.mockImplementationOnce(target => new Promise(resolve => { release = () => resolve(original(target)); }));
  setRepositoryActor('first');
  const pending = getCodexCategories(['Razze']);
  for (let n = 0; n < 30 && !release; n++) await Promise.resolve();
  expect(release).toBeDefined();
  setRepositoryActor('second'); release();
  await expect(pending).rejects.toMatchObject({ code: 'repository-session-changed' });
});

test('active subscription follows control, fences old callbacks and exposes frozen read-only state', async () => {
  const listeners = [];
  onSnapshot.mockImplementation((target, next, error) => {
    const off = jest.fn(); listeners.push({ target, next, error, off }); return off;
  });
  const next = jest.fn(); const error = jest.fn();
  const stop = subscribeCodexItemsPage({ categoryId: groups[0].category.id, categoryKey: 'Razze' }, { next, error });
  const controlListener = listeners[0];
  controlListener.next(docSnapshot(state));
  const categoryListener = listeners.find(x => x.target.path.endsWith(`/categories/${groups[0].category.id}`));
  const { id, ...categoryData } = groups[0].category;
  categoryListener.next(docSnapshot(categoryData));
  const pageListener = listeners.find(x => x.target.path.endsWith('/items'));
  pageListener.next(querySnapshot([...groups[0].items].sort((a, b) => a.displayRank - b.displayRank).slice(0, 26)));
  expect(next.mock.lastCall[0].items).toHaveLength(25);
  controlListener.next(docSnapshot({ ...state, epoch: 2, mode: 'rollback-frozen' }));
  pageListener.next(querySnapshot([]));
  expect(next.mock.lastCall[0].items).toHaveLength(25);
  const freshCategory = listeners.filter(x => x.target.path.endsWith(`/categories/${id}`)).at(-1);
  freshCategory.next(docSnapshot(categoryData));
  listeners.filter(x => x.target.path.endsWith('/items')).at(-1).next(querySnapshot(groups[0].items.slice(0, 26)));
  expect(next.mock.lastCall[0].control.readOnly).toBe(true);
  stop(); await Promise.resolve(); await Promise.resolve();
  expect(listeners.every(x => x.off.mock.calls.length === 1)).toBe(true);
  expect(error).not.toHaveBeenCalled();
});

test('legacy cursor survives unchanged stop/restart but rejects actual content/order updates', async () => {
  const listeners = [];
  onSnapshot.mockImplementation((target, next, error) => { const off = jest.fn(); listeners.push({ target, next, error, off }); return off; });
  const next = jest.fn(); const error = jest.fn();
  let stop = subscribeCodexItemsPage({ categoryKey: 'Razze', categoryId: groups[0].category.id }, { next, error });
  listeners.find(row => row.target.path === 'utils/codex_control').next(docSnapshot(null));
  listeners.find(row => row.target.path === 'utils/codex').next(docSnapshot(legacy));
  const cursor = next.mock.lastCall[0].cursor;
  stop(); await Promise.resolve(); await Promise.resolve();
  stop = subscribeCodexItemsPage({ categoryKey: 'Razze', categoryId: groups[0].category.id, cursor }, { next, error });
  listeners.filter(row => row.target.path === 'utils/codex_control').at(-1).next(docSnapshot(null));
  const legacyListener = listeners.filter(row => row.target.path === 'utils/codex').at(-1);
  legacyListener.next(docSnapshot(JSON.parse(JSON.stringify(legacy))));
  expect(error).not.toHaveBeenCalled();
  expect(next.mock.lastCall[0].items[0].legacyKey).not.toBe('Razza 0');
  const calls = next.mock.calls.length;
  legacyListener.next(docSnapshot({ ...legacy, Razze: { ...legacy.Razze, New: 'new body' } }));
  expect(error.mock.lastCall[0]).toMatchObject({ code: 'codex-stale-snapshot' }); expect(next).toHaveBeenCalledTimes(calls);
  stop();
});

test('legacy-to-v2 cutover stops aggregate delivery and follows only active category documents', async () => {
  const listeners = []; onSnapshot.mockImplementation((target, next, error) => { const off = jest.fn(); listeners.push({ target, next, error, off }); return off; });
  const next = jest.fn(); const error = jest.fn();
  const stop = subscribeCodexItemsPage({ categoryKey: 'Razze', categoryId: groups[0].category.id }, { next, error });
  const controlListener = listeners[0]; controlListener.next(docSnapshot(null));
  const old = listeners.find(row => row.target.path === 'utils/codex'); old.next(docSnapshot(legacy));
  expect(next.mock.lastCall[0].control.source).toBe('legacy');
  controlListener.next(docSnapshot(state));
  const category = listeners.find(row => row.target.path.endsWith(`/categories/${groups[0].category.id}`));
  category.next(docSnapshot(groups[0].category));
  listeners.find(row => row.target.path.endsWith('/items')).next(querySnapshot([...groups[0].items].sort((a, b) => a.displayRank - b.displayRank).slice(0, 26)));
  expect(next.mock.lastCall[0].control.source).toBe('v2'); const count = next.mock.calls.length;
  old.next(docSnapshot({ Razze: { Stale: 'old body' } })); expect(next).toHaveBeenCalledTimes(count);
  expect(error).not.toHaveBeenCalled(); stop(); await Promise.resolve(); await Promise.resolve(); expect(listeners.every(row => row.off.mock.calls.length === 1)).toBe(true);
});
