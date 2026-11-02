import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import EchiDiViaggio from './EchiDiViaggio';
import { useAuth, useAuthSession } from '../../AuthContext';
import { collection, labelFirestoreTarget, onSnapshot, orderBy, query } from '../../performance/firestore';
import { __resetRepositoryRuntimeForTests, setRepositoryActor } from '../../data/repositoryRuntime';
import { task15bNpcs as budget } from '../../../performance/budgets.json';

jest.mock('../../AuthContext', () => ({ useAuth: jest.fn(), useAuthSession: jest.fn() }));
jest.mock('../common/shellLayout', () => ({ useShellLayout: () => ({ topInset: 96 }) }));
jest.mock('../firebaseConfig', () => ({ db: {}, storage: {} }));
jest.mock('../firebaseStorage', () => ({ storage: {} }));
jest.mock('../../performance/firestore', () => ({
  collection: jest.fn((db, ...parts) => ({ path: parts.join('/') })),
  query: jest.fn((target, ...constraints) => ({ ...target, constraints })),
  orderBy: jest.fn((field, direction) => ({ field, direction })),
  labelFirestoreTarget: jest.fn((target) => target),
  onSnapshot: jest.fn(),
}));

const document = (id, data) => ({ id, data: () => data });
const snapshot = (docs, changes = docs.map((doc, newIndex) => ({ type: 'added', doc, oldIndex: -1, newIndex }))) => ({
  docs, docChanges: () => changes,
});
const empty = snapshot([]);
let listeners;
let session;
const npcListeners = () => listeners.filter(({ target }) => target.path === 'echi_npcs');
const emitNpcs = (docs, changes) => {
  for (const listener of npcListeners().filter(({ active }) => active)) {
    const ordered = listener.target.constraints;
    const rows = ordered ? docs.filter((doc) => 'createdAt' in doc.data()).slice().reverse() : docs;
    listener.next(snapshot(rows, changes));
  }
};

beforeEach(() => {
  __resetRepositoryRuntimeForTests();
  listeners = [];
  collection.mockImplementation((db, ...parts) => ({ path: parts.join('/') }));
  query.mockImplementation((target, ...constraints) => ({ ...target, constraints }));
  orderBy.mockImplementation((field, direction) => ({ field, direction }));
  labelFirestoreTarget.mockImplementation((target) => target);
  session = { user: { uid: 'dm-1' }, userData: { role: 'dm' }, loading: false, repositoryAccessGeneration: 0 };
  useAuth.mockImplementation(() => session);
  useAuthSession.mockImplementation(() => session);
  onSnapshot.mockImplementation((target, observer, onError) => {
    const listener = {
      target, next: typeof observer === 'function' ? observer : observer.next,
      error: typeof observer === 'function' ? onError : observer.error,
      active: true, unsubscribe: jest.fn(() => { listener.active = false; }),
    };
    listeners.push(listener);
    listener.next(empty);
    return listener.unsubscribe;
  });
});
afterEach(async () => {
  cleanup();
  await act(async () => {});
  __resetRepositoryRuntimeForTests();
});

test('500 NPCs and 2,000 markers use one physical NPC reader and release it on route exit', async () => {
  const docs = Array.from({ length: 500 }, (_, i) => document(`npc-${String(i).padStart(4, '0')}`, {
    nome: `Fixture NPC ${i}`, createdAt: '2026-01-01T00:00:00.000Z',
  }));
  const markers = Array.from({ length: 2000 }, (_, i) => document(`marker-${i}`, {
    text: `Marker ${i}`, mapId: i % 2 === 0 ? 'art' : 'precisa', x: 1 + i % 98, y: 1 + (i * 13) % 98,
  }));
  const view = render(<EchiDiViaggio />);
  act(() => {
    emitNpcs(docs);
    listeners.find(({ target }) => target.path === 'map_markers').next(snapshot(markers));
  });
  expect(view.container.querySelectorAll('button[aria-haspopup="dialog"]:not([aria-label])')).toHaveLength(500);
  expect(view.container.querySelectorAll('button[aria-label^="Marker "]')).toHaveLength(2000);
  console.info('Task 15B fixture:', JSON.stringify({ npcs: 500, markers: 2000, activeNpcListeners: npcListeners().filter((l) => l.active).length, initialNpcDocumentDeliveries: npcListeners().length * docs.length }));
  expect(npcListeners()).toHaveLength(budget.maxActiveRouteListeners);
  view.rerender(<EchiDiViaggio />);
  expect(npcListeners()).toHaveLength(1);
  view.unmount();
  await act(async () => {});
  expect(npcListeners().filter((l) => l.active)).toHaveLength(budget.maxListenersAfterCleanup);
  expect(npcListeners()[0].unsubscribe).toHaveBeenCalledTimes(1);
});

test('same-UID access change reconnects the physical reader, clears both consumers and rejects old errors/data', async () => {
  const view = render(<EchiDiViaggio />);
  const guide = document('guide', { nome: 'Scope secret', createdAt: null });
  act(() => {
    emitNpcs([guide]);
    listeners.find(({ target }) => target.path === 'map_markers').next(snapshot([
      document('linked', { mapId: 'art', npcId: 'guide', markerType: 'npc', x: 5, y: 5 }),
    ]));
  });
  expect(screen.getAllByRole('button', { name: /Scope secret/ })).toHaveLength(2);
  fireEvent.mouseEnter(screen.getAllByRole('button', { name: /Scope secret/ })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(screen.getByDisplayValue('Scope secret')).toBeInTheDocument();
  const old = npcListeners()[0];
  setRepositoryActor(session.user.uid);
  session = { ...session, repositoryAccessGeneration: 1 };
  view.rerender(<EchiDiViaggio />);
  expect(screen.queryByDisplayValue('Scope secret')).not.toBeInTheDocument();
  expect(old.unsubscribe).toHaveBeenCalledTimes(1);
  expect(npcListeners()).toHaveLength(2);
  expect(npcListeners().filter((l) => l.active)).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /Scope secret/ })).not.toBeInTheDocument();
  act(() => { old.next(snapshot([guide])); old.error(new Error('late')); });
  expect(screen.queryByText('Unable to load NPC list.')).not.toBeInTheDocument();
  act(() => emitNpcs([guide]));
  expect(screen.getAllByRole('button', { name: /Scope secret/ })).toHaveLength(2);
  act(() => npcListeners()[1].error(new Error('permission-denied')));
  expect(screen.getByText('Unable to load NPC list.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Scope secret/ })).not.toBeInTheDocument();
  view.unmount();
  await act(async () => {});
  expect(npcListeners().filter((l) => l.active)).toHaveLength(0);
});

test('real sidebar and map share raw updates, keep popup focus and retain missing-timestamp map lookup', async () => {
  const view = render(<StrictMode><EchiDiViaggio /></StrictMode>);
  let docs = [document('guide', { nome: ' Guide ', description: '', notes: '', createdAt: null }), document('legacy', { nome: 'Legacy map NPC', notes: 'Map only' })];
  act(() => {
    emitNpcs(docs);
    listeners.filter(({ target, active }) => target.path === 'map_markers' && active).forEach((l) => l.next(snapshot([
      document('linked', { mapId: 'art', npcId: 'guide', markerType: 'npc', x: 5, y: 5 }),
      document('legacy-linked', { mapId: 'art', npcId: 'legacy', markerType: 'npc', x: 10, y: 10 }),
    ])));
  });
  expect(npcListeners()).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Legacy map NPC' })).toHaveLength(1);
  // The sidebar tile precedes the linked map button and opens the shared NPC portal.
  fireEvent.mouseEnter(screen.getAllByRole('button', { name: /Guide/ })[0]);
  const popup = screen.getByRole('dialog', { name: /NPC:.*Guide/ });
  const edit = within(popup).getByRole('button', { name: 'Edit' });
  act(() => edit.focus());
  const changed = document('guide', { nome: 'Renamed guide', description: '', notes: 'Fresh note', createdAt: null });
  docs = [changed, docs[1]];
  act(() => emitNpcs(docs, [{ type: 'modified', doc: changed, oldIndex: 0, newIndex: 0 }]));
  expect(screen.getByRole('dialog', { name: 'NPC: Renamed guide' })).toBe(popup);
  expect(edit).toHaveFocus();
  expect(popup).toHaveTextContent('Fresh note');
  fireEvent.click(edit);
  expect(screen.getByPlaceholderText('NPC description...')).toHaveValue('');
  fireEvent.change(screen.getByPlaceholderText('NPC notes...'), { target: { value: 'Unsaved draft' } });
  const added = document('scout', { nome: 'Scout', createdAt: '2026-01-01T00:00:00.000Z' });
  act(() => emitNpcs([...docs, added], [{ type: 'added', doc: added, oldIndex: -1, newIndex: 2 }]));
  expect(screen.getByPlaceholderText('NPC notes...')).toHaveValue('Unsaved draft');
  expect(screen.getByRole('button', { name: /Scout/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  const mapButton = screen.getAllByRole('button', { name: 'Renamed guide' }).at(-1);
  fireEvent.click(mapButton);
  expect(screen.getByRole('dialog', { name: 'Renamed guide' })).toHaveTextContent('Fresh note');
  act(() => emitNpcs([docs[1], added], [{ type: 'removed', doc: changed, oldIndex: 0, newIndex: -1 }]));
  expect(screen.queryByRole('button', { name: /Renamed guide/ })).not.toBeInTheDocument();
  view.unmount();
  await act(async () => {});
  expect(npcListeners().filter((l) => l.active)).toHaveLength(0);
  render(<EchiDiViaggio />);
  expect(npcListeners()).toHaveLength(2);
});
