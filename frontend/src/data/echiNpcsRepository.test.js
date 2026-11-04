import { collection, labelFirestoreTarget, onSnapshot } from '../performance/firestore';
import { subscribeEchiNpcs } from './echiNpcsRepository';
import { __resetRepositoryRuntimeForTests } from './repositoryRuntime';

jest.mock('../components/firebaseConfig', () => ({ db: {} }));
jest.mock('../performance/firestore', () => ({ collection: jest.fn(), labelFirestoreTarget: jest.fn(), onSnapshot: jest.fn() }));
const document = (id, raw, estimate = raw) => ({ id, data: jest.fn((options) => options?.serverTimestamps === 'estimate' ? estimate : raw) });
const added = (doc, newIndex) => ({ type: 'added', doc, oldIndex: -1, newIndex });
const snapshot = (docs, changes = docs.map(added)) => ({ docs, docChanges: () => changes });
let observer;
let unsubscribe;
beforeEach(() => {
  __resetRepositoryRuntimeForTests();
  collection.mockImplementation((db, path) => ({ path }));
  labelFirestoreTarget.mockImplementation((target) => target);
  unsubscribe = jest.fn();
  onSnapshot.mockImplementation((target, callbacks) => { observer = callbacks; return unsubscribe; });
});
afterEach(() => __resetRepositoryRuntimeForTests());

test('shares a complete labeled collection, keeps raw authoritative entities and derives sidebar membership/order', () => {
  const next = jest.fn();
  const replay = jest.fn();
  subscribeEchiNpcs({ next });
  const media = { assetId: 'canonical' };
  const docs = [
    document('missing', { nome: 'Map only', media }),
    document('null-a', { createdAt: null }),
    document('null-z', { id: 'forged', nome: '  Guide  ', description: '', notes: '  ', imageUrl: '', imagePath: '', media, task07MediaRevision: 3, createdAt: null }),
    document('timestamp-a', { createdAt: { seconds: 100, nanoseconds: 1 } }),
    document('timestamp-z', { createdAt: { seconds: 100, nanoseconds: 2 } }),
    document('pending', { createdAt: null }, { createdAt: { seconds: 1, nanoseconds: 0 } }),
    document('string-a', { createdAt: '2026-01-01T00:00:00.000Z' }),
    document('string-z', { createdAt: '2026-01-01T00:00:00.000Z' }),
  ];
  observer.next(snapshot(docs));
  const result = next.mock.calls.at(-1)[0];
  expect(result.items.map((npc) => npc.id)).toEqual(['string-z', 'string-a', 'pending', 'timestamp-z', 'timestamp-a', 'null-z', 'null-a']);
  expect(Object.keys(result.byId)).toHaveLength(8);
  expect(result.byId.missing.media).toBe(media);
  expect(result.byId['null-z']).toEqual({ ...docs[2].data(), id: 'null-z' });
  expect(result.items.find((npc) => npc.id === 'null-z')).toBe(result.byId['null-z']);
  expect(result.byId.pending.createdAt).toBeNull();
  subscribeEchiNpcs({ next: replay });
  expect(replay).toHaveBeenLastCalledWith(result);
  expect(onSnapshot).toHaveBeenCalledTimes(1);
  expect(onSnapshot.mock.calls[0][0]).toEqual({ path: 'echi_npcs' });
  expect(labelFirestoreTarget).toHaveBeenCalledWith({ path: 'echi_npcs' }, 'echi.npcs.subscribe.v1');
});

test('applies add/modify/remove using collection indices, preserves unaffected references and no-op projection identity', () => {
  const next = jest.fn();
  subscribeEchiNpcs({ next });
  const a = document('a', { nome: 'A', createdAt: '2026' });
  const b = document('b', { nome: 'B', createdAt: '2025' });
  observer.next(snapshot([a, b]));
  const first = next.mock.calls.at(-1)[0];
  expect(first.items.map((npc) => npc.id)).toEqual(['a', 'b']);
  observer.next(snapshot([a, b], []));
  expect(next.mock.calls.at(-1)[0]).toBe(first);
  expect(a.data).toHaveBeenCalledTimes(1);
  const b2 = document('b', { nome: 'B changed', createdAt: '2027' });
  observer.next(snapshot([a, b2], [{ type: 'modified', doc: b2, oldIndex: 1, newIndex: 1 }]));
  const second = next.mock.calls.at(-1)[0];
  expect(second.items.map((npc) => npc.id)).toEqual(['b', 'a']);
  expect(second.byId.a).toBe(first.byId.a);
  expect(second.byId.b).not.toBe(first.byId.b);
  const c = document('c', { nome: 'C', createdAt: '2028' });
  observer.next(snapshot([a, b2, c], [added(c, 2)]));
  observer.next(snapshot([a, c], [{ type: 'removed', doc: b2, oldIndex: 1, newIndex: -1 }]));
  const final = next.mock.calls.at(-1)[0];
  expect(final.items.map((npc) => npc.id)).toEqual(['c', 'a']);
  expect(final.byId.b).toBeUndefined();
  expect(final.byId.a).toBe(first.byId.a);
});

test('uses Firestore string ordering for Unicode IDs and releases its listener after the final subscriber', async () => {
  const next = jest.fn();
  const stop = subscribeEchiNpcs({ next });
  observer.next(snapshot([document('\ufffd', { createdAt: 'same' }), document('😀', { createdAt: 'same' })]));
  expect(next.mock.calls.at(-1)[0].items.map((npc) => npc.id)).toEqual(['😀', '\ufffd']);
  stop();
  await Promise.resolve();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
