import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import Codex from './Codex';
import { useAuth } from '../../AuthContext';
import { subscribeCodexControl, subscribeCodexMetadataPage, subscribeCodexItemsPage, mutateCodex } from '../../data/codexRepository';
const { normalizeControl, projectLegacyCodex, createPage } = require('../../data/codexModel');
jest.mock('../../AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../data/codexRepository', () => ({ subscribeCodexControl: jest.fn(), subscribeCodexMetadataPage: jest.fn(), subscribeCodexItemsPage: jest.fn(), mutateCodex: jest.fn() }));
jest.mock('../common/shellLayout', () => ({ useShellLayout: () => ({ topInset: 0 }) }));
jest.mock('../backgrounds/CodexBackground', () => () => null);
let control; let groups; let listeners;
const rowsPage = (rows, options, category) => {
  const sorted = [...rows].sort((a, b) => a.displayRank - b.displayRank);
  const offset = options.cursor ? sorted.findIndex(row => row.id === options.cursor.id) + 1 : 0;
  return createPage(sorted.slice(offset, offset + 26), { ...options, control, category });
};
const latest = kind => listeners.filter(listener => listener.kind === kind).at(-1);
beforeEach(() => {
  jest.clearAllMocks(); listeners = [];
  control = normalizeControl({ schemaVersion: 2, mode: 'v2', epoch: 1, generation: 'g1', metadataRevision: 1, collationLocale: 'en-US' });
  groups = projectLegacyCodex({ lingue: Object.fromEntries(Array.from({ length: 61 }, (_, n) => [`Nome ${String(n).padStart(2, '0')}`, `Descrizione ${n}`])), professioni: { Fabbro: { livelli: [1, 2] } } });
  useAuth.mockReturnValue({ user: { uid: 'user1' }, userData: { role: 'dm' }, loading: false });
  const listen = (kind, options, observer, value) => { const off = jest.fn(); listeners.push({ kind, options, observer, off }); observer.next(value); return off; };
  subscribeCodexControl.mockImplementation(observer => listen('control', {}, observer, control));
  subscribeCodexMetadataPage.mockImplementation((options, observer) => listen('metadata', options, observer, rowsPage(groups.map(group => group.category), options)));
  subscribeCodexItemsPage.mockImplementation((options, observer) => { const group = groups.find(group => group.category.id === options.categoryId); return listen('items', options, observer, rowsPage(group.items, options, group.category)); });
  mutateCodex.mockResolvedValue({});
});
const itemsNav = () => within(screen.getByRole('navigation', { name: 'Pagine elementi' }));
const editFirst = () => fireEvent.click(screen.getByRole('button', { name: 'Modifica Nome 00' }));

test('active category is bounded, every ordered item is reachable and previous pages are released', () => {
  const view = render(<Codex />); const reached = [];
  for (let page = 0; page < 3; page++) {
    const headers = screen.getAllByRole('heading', { level: 3 }).map(element => element.textContent);
    expect(headers.length).toBeLessThanOrEqual(25); reached.push(...headers);
    if (page < 2) fireEvent.click(itemsNav().getByText('Successiva'));
  }
  expect(reached).toEqual(groups[0].items.map(item => item.legacyKey));
  expect(itemsNav().getByText('Successiva')).toBeDisabled();
  expect(subscribeCodexItemsPage.mock.calls.every(([options]) => options.pageSize === 25 && options.categoryId === groups[0].category.id)).toBe(true);
  fireEvent.click(itemsNav().getByText('Precedente'));
  expect(screen.getByRole('heading', { name: 'Nome 25' })).toBeInTheDocument();
  view.unmount(); expect(listeners.every(listener => listener.off.mock.calls.length === 1)).toBe(true);
});
test('all metadata pages remain reachable without reading unrelated item bodies', () => {
  groups = projectLegacyCodex(Object.fromEntries(Array.from({ length: 61 }, (_, n) => [`Categoria ${String(n).padStart(2, '0')}`, { Voce: 'valore' }])));
  render(<Codex />); const reached = [];
  for (let page = 0; page < 3; page++) {
    reached.push(...within(screen.getByRole('navigation', { name: 'Categorie Codex' })).getAllByRole('button').map(button => button.textContent).filter(Boolean));
    if (page < 2) fireEvent.click(within(screen.getByRole('navigation', { name: 'Pagine categorie' })).getByText('Successiva'));
  }
  expect(reached).toEqual(groups.map(group => group.category.legacyKey));
  expect(subscribeCodexItemsPage.mock.calls.map(([options]) => options.categoryId)).toEqual([groups[0].category.id, groups[25].category.id, groups[50].category.id]);
});
test('stale cursor returns to first page and rejects previous listener callbacks', () => {
  render(<Codex />); fireEvent.click(itemsNav().getByText('Successiva')); const old = latest('items');
  act(() => old.observer.error(new TypeError('Invalid Codex cursor is stale or belongs to another page')));
  expect(screen.getByRole('heading', { name: 'Nome 00' })).toBeInTheDocument();
  act(() => old.observer.next(rowsPage(groups[0].items, old.options, groups[0].category)));
  expect(screen.queryByRole('heading', { name: 'Nome 25' })).not.toBeInTheDocument();
  expect(screen.getByText(/ritorno alla prima pagina/)).toBeInTheDocument();
});
test('category changes discard prior item callbacks', () => {
  render(<Codex />); const old = latest('items');
  fireEvent.click(screen.getByRole('button', { name: 'Professioni', exact: true }));
  act(() => old.observer.next(rowsPage(groups[0].items, {}, groups[0].category)));
  expect(screen.getByRole('heading', { name: 'Fabbro' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Nome 00' })).not.toBeInTheDocument();
});
test('one dialog cancels without writing and retains typed JSON values', async () => {
  render(<Codex />); editFirst(); expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Descrizione'), { target: { value: 'cancelled' } });
  fireEvent.click(screen.getByText('Annulla')); expect(mutateCodex).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Professioni', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Modifica Fabbro' }));
  fireEvent.change(screen.getByLabelText('Valore JSON'), { target: { value: '{"livelli":[1,2,3]}' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Salva', exact: true })));
  expect(mutateCodex.mock.lastCall[0].value).toEqual({ livelli: [1, 2, 3] }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
test('double submit is guarded; errors are visible and never retried with fresh revisions', async () => {
  let reject; mutateCodex.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
  render(<Codex />); editFirst(); fireEvent.change(screen.getByLabelText('Descrizione'), { target: { value: 'new body' } });
  const form = screen.getByRole('dialog').querySelector('form'); fireEvent.submit(form); fireEvent.submit(form);
  expect(mutateCodex).toHaveBeenCalledTimes(1); expect(screen.getByText('Annulla')).toBeDisabled();
  await act(async () => reject(Object.assign(new Error('Modifica concorrente'), { code: 'functions/aborted' })));
  expect(screen.getByRole('alert')).toHaveTextContent('Modifica concorrente'); expect(screen.getByRole('button', { name: 'Salva', exact: true })).toBeDisabled();
  fireEvent.submit(form); expect(mutateCodex).toHaveBeenCalledTimes(1);
});
test('a revision change invalidates a draft without substituting fresh mutation context', () => {
  render(<Codex />); editFirst(); fireEvent.change(screen.getByLabelText('Descrizione'), { target: { value: 'draft' } });
  groups[0].category = { ...groups[0].category, revision: 2 };
  act(() => latest('items').observer.next(rowsPage(groups[0].items, {}, groups[0].category)));
  expect(screen.getByRole('button', { name: 'Salva', exact: true })).toBeDisabled(); expect(mutateCodex).not.toHaveBeenCalled();
});
test.each(['frozen', 'rollback-frozen'])('%s immediately fences writes before child pages arrive', mode => {
  render(<Codex />); editFirst(); control = normalizeControl({ ...control, mode, epoch: 2 });
  subscribeCodexMetadataPage.mockImplementation(() => jest.fn()); act(() => latest('control').observer.next(control));
  expect(screen.getByText(/temporaneamente in sola lettura/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Salva', exact: true })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Nuova Categoria' })).toBeDisabled();
});
test('session and role changes close drafts and ignore late completion', async () => {
  let resolve; mutateCodex.mockReturnValue(new Promise(done => { resolve = done; }));
  const view = render(<Codex />); const old = [...listeners]; editFirst(); fireEvent.change(screen.getByLabelText('Descrizione'), { target: { value: 'draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salva', exact: true }));
  useAuth.mockReturnValue({ user: { uid: 'user2' }, userData: { role: 'player' }, loading: false }); view.rerender(<Codex />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Nuova Categoria' })).not.toBeInTheDocument();
  expect(old.every(listener => listener.off.mock.calls.length === 1)).toBe(true);
  await act(async () => resolve({})); expect(screen.queryByText('Modifica salvata.')).not.toBeInTheDocument(); expect(mutateCodex.mock.lastCall[1]()).toBe(false);
});
test('additions normalize category whitespace and preserve numeric item names', async () => {
  render(<Codex />); fireEvent.click(screen.getByRole('button', { name: 'Nuova Categoria' }));
  fireEvent.change(screen.getByLabelText('Nome Categoria'), { target: { value: '  Nuova..  Categoria  ' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Salva', exact: true })));
  expect(mutateCodex.mock.lastCall[0].legacyKey).toBe('Nuova Categoria');
  fireEvent.click(screen.getByRole('button', { name: 'Nuova Lingua' })); fireEvent.change(screen.getByLabelText('Nome', { exact: true }), { target: { value: ' 12 ' } });
  fireEvent.change(screen.getByLabelText('Descrizione'), { target: { value: ' descrizione ' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Salva', exact: true })));
  expect(mutateCodex.mock.lastCall[0]).toMatchObject({ action: 'item-add', legacyKey: '12', value: 'descrizione' });
});
test('deletion captures exact item and category context in one shared dialog', async () => {
  render(<Codex />); fireEvent.click(screen.getByRole('button', { name: 'Elimina Nome 00', exact: true }));
  await act(async () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Elimina', exact: true })));
  expect(mutateCodex.mock.lastCall[0]).toMatchObject({ action: 'item-delete', category: groups[0].category, item: groups[0].items[0] });
  fireEvent.click(screen.getByRole('button', { name: 'Elimina categoria professioni' })); expect(screen.getByRole('dialog')).toHaveTextContent('tutti i 1 elementi');
  await act(async () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Elimina', exact: true })));
  expect(mutateCodex.mock.lastCall[0]).toMatchObject({ action: 'category-delete', category: groups[1].category });
});

test('legacy content changes permanently invalidate category-delete drafts and release cursor history', () => {
  control = normalizeControl(null);
  const metadata = () => ({ items: groups.map(group => group.category), control, cursor: null, hasMore: false, legacyContent: 'initial-content' });
  subscribeCodexMetadataPage.mockImplementation((_options, observer) => { const off = jest.fn(); listeners.push({ kind: 'metadata', observer, off }); observer.next(metadata()); return off; });
  subscribeCodexItemsPage.mockImplementation((_options, observer) => { const off = jest.fn(); observer.next({ items: groups[0].items.slice(0, 25), category: groups[0].category, control, legacyContent: 'initial-content', hasMore: false }); return off; });
  render(<Codex />); fireEvent.click(screen.getByRole('button', { name: 'Elimina categoria professioni' }));
  act(() => latest('metadata').observer.next({ ...metadata(), legacyContent: 'changed-content' }));
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Elimina', exact: true })).toBeDisabled();
  act(() => latest('metadata').observer.next(metadata()));
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Elimina', exact: true })).toBeDisabled();
  expect(mutateCodex).not.toHaveBeenCalled();
});
test('visible heading and status text are explicit UI hit targets', async () => {
  render(<Codex />);
  expect(screen.getByRole('heading', { name: 'Codex', exact: true })).toHaveClass('pointer-events-auto');
  fireEvent.click(screen.getByRole('button', { name: 'Elimina Nome 00', exact: true }));
  await act(async () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Elimina', exact: true })));
  expect(screen.getByText('Modifica salvata.')).toHaveClass('pointer-events-auto');
});

test('same-account role changes resubscribe and logged-out sessions release every listener', () => {
  const view = render(<Codex />); const previous = [...listeners];
  useAuth.mockReturnValue({ user: { uid: 'user1' }, userData: { role: 'webmaster' }, loading: false }); view.rerender(<Codex />);
  expect(previous.every(listener => listener.off.mock.calls.length === 1)).toBe(true); expect(subscribeCodexControl).toHaveBeenCalledTimes(2);
  const current = [...listeners];
  useAuth.mockReturnValue({ user: null, userData: null, loading: false }); view.rerender(<Codex />);
  expect(current.every(listener => listener.off.mock.calls.length === 1)).toBe(true); expect(screen.getByText(/Accedi per consultare/)).toBeInTheDocument();
  act(() => previous.find(row => row.kind === 'items').observer.error(new Error('late failure')));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('read failures are visible and explicit reload recovers with fresh first pages', () => {
  render(<Codex />); const old = latest('items');
  act(() => old.observer.error(new Error('Servizio non disponibile')));
  expect(screen.getByRole('alert')).toHaveTextContent('Servizio non disponibile');
  fireEvent.click(screen.getByRole('button', { name: 'Ricarica' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.getByRole('heading', { name: 'Nome 00' })).toBeInTheDocument();
  act(() => old.observer.error(new Error('late error'))); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('metadata stale cursors recover on first page without loops', () => {
  groups = projectLegacyCodex(Object.fromEntries(Array.from({ length: 26 }, (_, n) => [`Categoria ${String(n).padStart(2, '0')}`, { Voce: 'valore' }])));
  render(<Codex />); fireEvent.click(within(screen.getByRole('navigation', { name: 'Pagine categorie' })).getByText('Successiva'));
  act(() => latest('metadata').observer.error(Object.assign(new Error('stale'), { code: 'codex-stale-snapshot' })));
  expect(screen.getByRole('button', { name: 'Categoria 00', exact: true })).toBeInTheDocument();
  expect(subscribeCodexMetadataPage).toHaveBeenCalledTimes(3);
});
