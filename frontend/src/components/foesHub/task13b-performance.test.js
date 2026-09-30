import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import FoesHub from './FoesHub';
import {task13Foes as budgets} from '../../../performance/budgets.json';

jest.setTimeout(120000);
const mockListeners = [];
const mockRows = jest.fn();
const mockCharts = jest.fn();
const mockModal = jest.fn();
jest.mock('../firebaseConfig', () => ({auth: {currentUser: {uid: 'dm'}}, db: {}}));
jest.mock('../../performance/firestore', () => ({
  labelFirestoreTarget: (target, metricKey) => ({...target, metricKey}),
  collection: (_db, path) => ({path}), doc: (_db, ...parts) => ({path: parts.join('/')}),
  onSnapshot: (query, next) => { const item = {query, next}; mockListeners.push(item); return () => {item.closed = true;}; },
  query: (base, ...constraints) => ({...base, constraints}),
  orderBy: (...args) => ({orderBy: args}), documentId: () => '__name__',
  limit: value => ({limit: value}), startAfter: (...args) => ({startAfter: args}),
}));
jest.mock('../../data/configRepository', () => ({getSchema: async () => ({}),
  subscribeFoePagingControl: observer => {
    const item = {query: {path: 'utils/foes_paging'}, next: snapshot => observer.next(snapshot.exists() ? snapshot.data() : null)};
    mockListeners.push(item); return () => {item.closed = true;};
  },
}));
jest.mock('../../data/functions/callableRegistry', () => ({getCallable: () => jest.fn()}));
jest.mock('../../data/functions/backendOperationClient', () => ({TASK06_LOCAL_CANDIDATE: false}));
jest.mock('../../data/media/useTask07MediaOperationOwner', () => () => ({}));
jest.mock('../common/legacyMediaStorage', () => ({}));
jest.mock('./elements/lazyFoeEditors', () => ({FoeFormModal: props => {mockModal(props.initial); return <div role="dialog" />;}}));
jest.mock('../common/MediaImage', () => ({__esModule: true,
  hasMediaAsset: value => Boolean(value.imageUrl),
  default: props => {mockRows(props.media.id); return <img alt={props.alt} />;},
}));
jest.mock('./elements/RadarChart', () => ({__esModule: true,
  default: require('react').memo(props => {mockCharts(props.title); return <span>{props.title}</span>;}),
}));

const fixture = () => Array.from({length: 500}, (_, i) => ({
  id: `foe-${String(i).padStart(4, '0')}`, name: `Fixture foe ${i}`,
  imageUrl: `https://example.test/${i}.png`, Parametri: {}, stats: {}, spells: [], tecniche: [],
  task13OrderSeconds: 0,
}));
const snapshot = rows => ({docs: rows.map(row => ({id: row.id, data: () => ({...row})})),
  forEach: cb => rows.forEach(row => cb({id: row.id, data: () => ({...row})})),
});

test('Task13B fixture baseline and one-foe render isolation', async () => {
  mockListeners.length = 0; mockRows.mockClear(); mockCharts.mockClear();
  const all = fixture();
  render(<FoesHub />);
  await waitFor(() => expect(mockListeners.length).toBeGreaterThan(0));
  const control = mockListeners.find(item => item.query.path === 'utils/foes_paging');
  if (control) act(() => control.next({exists: () => true, data: () => ({version: 1, mode: 'paged'})}));
  const listener = mockListeners.filter(item => item.query.path === 'foes' && !item.closed).at(-1);
  await act(async () => listener.next(snapshot(all.slice(0, 26))));
  const initialRows = screen.getAllByRole('img').length;
  act(() => screen.getAllByLabelText('expand').forEach(button => fireEvent.click(button)));
  mockRows.mockClear(); mockCharts.mockClear();
  const changed = all.map((row, i) => ({...row, ...(i === 0 ? {name: 'changed'} : {})}));
  await act(async () => listener.next(snapshot(changed.slice(0, 26))));
  const metrics = {initialRows, initialThumbnails: initialRows,
    changedRowCommits: mockRows.mock.calls.length,
    unaffectedRowCommits: mockRows.mock.calls.filter(([id]) => id !== all[0].id).length,
    chartCommits: mockCharts.mock.calls.length};
  console.log('TASK13B_RENDER_METRICS ' + JSON.stringify(metrics));
  expect(initialRows).toBe(budgets.maxInitialRows);
  expect(metrics.unaffectedRowCommits).toBe(budgets.maxUnaffectedCommits);
  expect(metrics.chartCommits).toBe(budgets.maxUnaffectedCommits);
});

test('only active-page subscription survives navigation, rollback preserves missing timestamps and modal input stays stable', async () => {
  mockListeners.length = 0; mockModal.mockClear();
  const rows = fixture(), view = render(<FoesHub />);
  const control = mockListeners.find(item => item.query.path === 'utils/foes_paging');
  await act(async () => control.next({exists: () => false}));
  const fallback = mockListeners.filter(item => item.query.path === 'foes' && !item.closed).at(-1);
  await act(async () => fallback.next(snapshot(rows)));
  expect(fallback.query.metricKey).toBe('foes.library-compatibility.subscribe.v1');
  expect(fallback.query.constraints).toBeUndefined();
  expect(screen.getAllByRole('img')).toHaveLength(25);
  await act(async () => control.next({exists: () => true, data: () => ({version: 1, mode: 'paged'})}));
  expect(fallback.closed).toBe(true);
  const first = mockListeners.filter(item => item.query.path === 'foes' && !item.closed).at(-1);
  expect(first.query.constraints.at(-1)).toEqual({limit: 26});
  await act(async () => first.next(snapshot(rows.slice(0, 26))));
  fireEvent.click(screen.getByRole('button', {name: 'Successiva'}));
  expect(first.closed).toBe(true);
  const second = mockListeners.filter(item => item.query.path === 'foes' && !item.closed).at(-1);
  expect(second.query.constraints).toContainEqual({startAfter: [0, rows[24].id]});
  await act(async () => second.next(snapshot(rows.slice(25, 51))));
  expect(mockModal).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', {name: 'Nuovo foe'}));
  const initial = mockModal.mock.calls.at(-1)[0];
  await act(async () => second.next(snapshot(rows.slice(25, 51).map(row => ({...row, notes: 'changed'})))));
  expect(mockModal.mock.calls.at(-1)[0]).toBe(initial);
  expect(mockListeners.filter(item => item.query.path === 'foes' && !item.closed)).toHaveLength(1);
  view.unmount(); expect(second.closed).toBe(true); expect(control.closed).toBe(true);
});
