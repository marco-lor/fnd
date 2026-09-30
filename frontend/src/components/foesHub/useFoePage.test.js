import {act, renderHook} from '@testing-library/react';
import useFoePage from './useFoePage';

const mockListeners = [];
jest.mock('../firebaseConfig', () => ({db: {}}));
jest.mock('../../data/configRepository', () => ({subscribeFoePagingControl: observer => {
  const item = {kind: 'control', ...observer}; mockListeners.push(item);
  return () => {item.closed = true;};
}}));
jest.mock('../../performance/firestore', () => ({
  collection: (_db, path) => ({path}), labelFirestoreTarget: target => target,
  query: (base, ...constraints) => ({...base, constraints}),
  orderBy: (...args) => ({orderBy: args}), documentId: () => '__name__',
  limit: value => ({limit: value}), startAfter: (...args) => ({startAfter: args}),
  onSnapshot: (query, next, error) => {
    const item = {kind: 'page', query, next, error}; mockListeners.push(item);
    return () => {item.closed = true;};
  },
}));
const latest = kind => mockListeners.filter(item => item.kind === kind && !item.closed).at(-1);
const snapshot = rows => ({docs: rows.map(row => ({id: row.id, data: () => row}))});

beforeEach(() => {mockListeners.length = 0;});

test('refresh on page one recovers a terminated listener and ignores its late callbacks', () => {
  const {result, unmount} = renderHook(useFoePage);
  act(() => latest('control').next({version: 1, mode: 'paged'}));
  const failed = latest('page');
  act(() => failed.error(new Error('Unavailable')));
  expect(result.current.error).toBeTruthy();
  act(() => result.current.first());
  const retry = latest('page');
  act(() => retry.next(snapshot([{id: 'recovered', task13OrderSeconds: 12}])));
  act(() => failed.next(snapshot([{id: 'stale', task13OrderSeconds: 1}])));
  expect(result.current.rows.map(row => row.id)).toEqual(['recovered']);
  expect(result.current.error).toBe('');
  expect(result.current.page).toBe(1);
  unmount();
});

test('refresh retries a failed paging-control read before querying the library', () => {
  const {result, unmount} = renderHook(useFoePage);
  const failed = latest('control');
  act(() => failed.error(new Error('Unavailable')));
  expect(result.current.error).toBeTruthy();
  act(() => result.current.first());
  act(() => latest('control').next({version: 1, mode: 'paged'}));
  act(() => latest('page').next(snapshot([{id: 'recovered', task13OrderSeconds: 12}])));
  expect(result.current.rows.map(row => row.id)).toEqual(['recovered']);
  expect(result.current.error).toBe('');
  expect(failed.closed).toBe(true);
  unmount();
});
