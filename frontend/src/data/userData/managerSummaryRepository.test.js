import { normalizeManagerSummary, subscribeManagerSummary } from './managerSummaryRepository';
import { onSnapshot } from '../../performance/firestore';
import { __resetRepositoryRuntimeForTests } from '../repositoryRuntime';
jest.mock('../../components/firebaseConfig', () => ({db: {}}));
jest.mock('../../performance/firestore', () => ({
  doc: (_db, ...parts) => parts.join('/'), labelFirestoreTarget: (target) => target, onSnapshot: jest.fn(),
}));
const {buildManagerUserSummary} = require('../../../functions/lib/managerUserSummaryProjection');
beforeEach(() => { __resetRepositoryRuntimeForTests(); jest.clearAllMocks(); });
test('validates the exact wire projection and reports missing backfill instead of reading aggregates', () => {
  const data = buildManagerUserSummary({});
  const snapshot = (value) => ({exists: () => !!value, data: () => value});
  expect(normalizeManagerSummary(snapshot(data))).toEqual(data);
  expect(() => normalizeManagerSummary(snapshot(null))).toThrow(/backfill/);
  expect(() => normalizeManagerSummary(snapshot({...data, inventory: []}))).toThrow(/Invalid/);
  expect(() => normalizeManagerSummary(snapshot({...data, stats: {...data.stats, secret: true}}))).toThrow(/Invalid/);
});

test('missing and invalid snapshots recover through the same shared physical listener', async () => {
  let source;
  const stop = jest.fn();
  onSnapshot.mockImplementation((_target, observer) => { source = observer; return stop; });
  const first = {next: jest.fn(), error: jest.fn()};
  const unsubscribe = subscribeManagerSummary('new-player', first);
  source.next({exists: () => false});
  expect(first.error).toHaveBeenCalledWith(expect.objectContaining({message: expect.stringMatching(/backfill/)}));
  expect(stop).not.toHaveBeenCalled();
  const second = {next: jest.fn(), error: jest.fn()};
  const unsubscribeSecond = subscribeManagerSummary('new-player', second);
  expect(second.error).toHaveBeenCalledTimes(1);
  source.next({exists: () => true, data: () => ({schemaVersion: 999})});
  expect(first.error).toHaveBeenCalledTimes(2);
  const valid = buildManagerUserSummary({});
  source.next({exists: () => true, data: () => valid});
  expect(first.next).toHaveBeenLastCalledWith(valid);
  expect(second.next).toHaveBeenLastCalledWith(valid);
  expect(onSnapshot).toHaveBeenCalledTimes(1);
  unsubscribe(); unsubscribeSecond();
  await Promise.resolve();
  expect(stop).toHaveBeenCalledTimes(1);
});

test('terminal SDK errors close the physical listener and a retry opens a fresh one', async () => {
  const sources = [];
  const stops = [];
  onSnapshot.mockImplementation((_target, observer) => { sources.push(observer); const stop = jest.fn(); stops.push(stop); return stop; });
  const observer = {next: jest.fn(), error: jest.fn()};
  const first = subscribeManagerSummary('player', observer);
  const denied = new Error('permission-denied');
  sources[0].error(denied);
  expect(stops[0]).toHaveBeenCalledTimes(1);
  first();
  const retry = subscribeManagerSummary('player', observer);
  const valid = buildManagerUserSummary({});
  sources[1].next({exists: () => true, data: () => valid});
  expect(onSnapshot).toHaveBeenCalledTimes(2);
  expect(observer.next).toHaveBeenLastCalledWith(valid);
  retry(); await Promise.resolve();
  expect(stops[1]).toHaveBeenCalledTimes(1);
});
