import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AdminPage from './adminPage';
import { getAdminUsersPage } from '../../data/userData/userDataCommands';
import { deleteAdminUser } from '../../data/userData/adminUserOperations';
const { buildDocuments, buildManifest } = require('../../../scripts/performance/fixtures');
const { buildAdminUserListItem } = require('../../../functions/lib/userDataV2');
const { task11Admin: budget } = require('../../../performance/budgets.json');
const mockRole = jest.fn();
const mockRenders = new Map();
const mockRowProps = new Map();
let mockAuth = { user: { uid: 'perf-webmaster' }, userData: { role: 'webmaster' } };
jest.mock('../../AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../../data/configRepository', () => ({ getPossibleLists: async () => ({ ruoli: ['player', 'dm', 'webmaster'] }) }));
jest.mock('../../data/userData/userDataCommands', () => ({ getAdminUsersPage: jest.fn() }));
jest.mock('../../data/userData/adminUserOperations', () => ({ deleteAdminUser: jest.fn(), listAdminUserDeletions: async () => [] }));
jest.mock('../../data/functions/callableRegistry', () => ({ getCallable: () => (...args) => mockRole(...args) }));
jest.mock('./AdminUserRow', () => {
  const React = require('react');
  const { AdminUserRow: Row } = jest.requireActual('./AdminUserRow');
  return React.memo((props) => {
    mockRenders.set(props.user.id, (mockRenders.get(props.user.id) || 0) + 1);
    mockRowProps.set(props.user.id, props);
    return <Row {...props} />;
  });
});
const documents = buildDocuments();
const roots = new Map(documents.filter(({path}) => /^users\/[^/]+$/.test(path)).map(({path, data}) => [path.split('/')[1], data]));
const directory = documents.filter(({path}) => /^user_directory\/[^/]+$/.test(path)).sort((a, b) => a.data.normalizedLabel < b.data.normalizedLabel ? -1 : a.data.normalizedLabel > b.data.normalizedLabel ? 1 : a.path.localeCompare(b.path));
let sourceReads;
let responseBytes;
const fetchPage = async ({ cursor, limit = 100, search = '', schemaVersion } = {}) => {
  expect(schemaVersion).toBe(2);
  const matching = directory.filter(({data}) => data.normalizedLabel.startsWith(search));
  const start = cursor ? matching.findIndex(({path}) => path === `user_directory/${cursor.uid}`) + 1 : 0;
  const query = matching.slice(start, start + limit + 1);
  const page = query.slice(0, limit);
  sourceReads += 1 + query.length + page.length;
  const last = page.at(-1);
  const response = { items: page.map(({path}) => buildAdminUserListItem(path.split('/')[1], roots.get(path.split('/')[1]))), hasMore: query.length > limit,
    cursor: query.length > limit ? { normalizedLabel: last.data.normalizedLabel, uid: last.path.split('/')[1], search } : null };
  responseBytes += Buffer.byteLength(JSON.stringify(response));
  return response;
};
const ready = async () => waitFor(() => expect(screen.queryByText('Caricamento utenti...')).not.toBeInTheDocument());
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
beforeEach(() => {
  jest.clearAllMocks(); mockRenders.clear(); mockRowProps.clear();
  mockAuth = { user: { uid: 'perf-webmaster' }, userData: { role: 'webmaster' } };
  sourceReads = 0; responseBytes = 0;
  getAdminUsersPage.mockImplementation(fetchPage);
  mockRole.mockResolvedValue({data: {role: 'dm'}});
  deleteAdminUser.mockResolvedValue({status: 'completed'});
});

test('deterministic 200-user initial budget and full navigation without truncation', async () => {
  render(<AdminPage />); await ready();
  const rows = screen.getAllByRole('row').length - 1;
  console.info('Task11 Admin serialized response measurement', JSON.stringify({ fixture: buildManifest(documents).hash, fixtureUsers: directory.length, requests: getAdminUsersPage.mock.calls.length, rows, responseBytes, sourceReads }));
  expect(getAdminUsersPage).toHaveBeenCalledTimes(budget.initialRequests);
  expect(rows).toBeLessThanOrEqual(budget.pageSize);
  expect(responseBytes).toBeLessThanOrEqual(budget.serializedResponseBytes);
  expect(sourceReads).toBeLessThanOrEqual(budget.sourceDocumentReads);
  const seen = new Set();
  for (let index = 0; index < 20; index += 1) {
    screen.getAllByTestId(/^admin-row-/).forEach((row) => seen.add(row.dataset.testid));
    expect(screen.getByText(`Pagina ${index + 1}`)).toBeInTheDocument();
    if (index < 19) { fireEvent.click(screen.getByText('Successiva')); await ready(); }
  }
  expect(seen.size).toBe(200);
  expect(screen.getByText('Successiva')).toBeDisabled();
  fireEvent.click(screen.getByText('Precedente')); await ready();
  expect(screen.getByText('Pagina 19')).toBeInTheDocument();
});

test('normalized prefix search resets pages; empty and failed page recover without losing table', async () => {
  render(<AdminPage />); await ready();
  const originalRow = screen.getAllByTestId(/^admin-row-/)[0];
  getAdminUsersPage.mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByText('Successiva')); await ready();
  expect(originalRow).toBeInTheDocument();
  fireEvent.click(screen.getByText('Riprova')); await ready();
  expect(screen.getByText('Pagina 2')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Cerca nome personaggio'), {target: {value: '  NÓ MATCH  '}});
  fireEvent.click(screen.getByText('Cerca')); await ready();
  expect(getAdminUsersPage).toHaveBeenLastCalledWith(expect.objectContaining({search: 'no match', cursor: null}));
  expect(screen.getByText('Nessun utente trovato.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Cerca nome personaggio'), {target: {value: ''}});
  fireEvent.click(screen.getByText('Cerca')); await ready();
  expect(screen.getAllByTestId(/^admin-row-/)).toHaveLength(10);
});

test('same-render role submissions deduplicate, preserve unrelated row identity and retry visibly', async () => {
  const view = render(<AdminPage />); await ready();
  const [target, unrelated] = [...mockRowProps.values()];
  const otherRenders = mockRenders.get(unrelated.user.id);
  const otherIdentity = unrelated.user;
  const pending = deferred(); mockRole.mockReturnValueOnce(pending.promise);
  act(() => { target.onRoleChange(target.user.id, 'dm'); target.onRoleChange(target.user.id, 'webmaster'); });
  expect(mockRole).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText(`Ruolo ${target.user.id}`)).toBeDisabled();
  await act(async () => pending.reject(new Error('offline')));
  expect(screen.getAllByTestId(/^admin-row-/)).toHaveLength(10);
  expect(screen.getByRole('alert')).toHaveTextContent('Aggiornamento non riuscito');
  fireEvent.change(screen.getByLabelText(`Ruolo ${target.user.id}`), {target: {value: 'dm'}});
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(mockRole).toHaveBeenCalledTimes(2);
  expect(mockRenders.get(unrelated.user.id)).toBe(otherRenders);
  expect(mockRowProps.get(unrelated.user.id).user).toBe(otherIdentity);
  expect(getAdminUsersPage).toHaveBeenCalledTimes(1);
  mockAuth = {...mockAuth, userData: {...mockAuth.userData, gold: 999}};
  view.rerender(<AdminPage />); await ready();
  expect(getAdminUsersPage).toHaveBeenCalledTimes(1);
  expect(mockRenders.get(unrelated.user.id)).toBe(otherRenders);
});

test('delete duplicate, progress, failure and retry keep modal/table until confirmed completion', async () => {
  render(<AdminPage />); await ready();
  const target = [...mockRowProps.values()][0];
  const pending = deferred(); deleteAdminUser.mockReturnValueOnce(pending.promise);
  fireEvent.click(within(screen.getByTestId(`admin-row-${target.user.id}`)).getByText('Elimina'));
  fireEvent.change(screen.getByLabelText('Conferma eliminazione'), {target: {value: 'ELIMINA'}});
  const confirm = within(screen.getByRole('dialog')).getByRole('button', {name: 'Elimina Utente'});
  // This outer batch deliberately exercises two submissions before React
  // commits pending state; the synchronous guard must reject the second.
  // eslint-disable-next-line testing-library/no-unnecessary-act
  act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
  expect(deleteAdminUser).toHaveBeenCalledTimes(1);
  act(() => deleteAdminUser.mock.calls[0][0].onProgress({progress: {processed: 2, planned: 5}}));
  expect(screen.getByText('Eliminazione in corso: 2/5')).toBeInTheDocument();
  expect(screen.getByTestId(`admin-row-${target.user.id}`)).toBeInTheDocument();
  await act(async () => pending.reject(new Error('storage failure')));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByLabelText('Conferma eliminazione')).toHaveValue('ELIMINA');
  expect(screen.getByTestId(`admin-row-${target.user.id}`)).toBeInTheDocument();
  fireEvent.click(screen.getByText('Riprova eliminazione'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByTestId(`admin-row-${target.user.id}`)).not.toBeInTheDocument();
  expect(getAdminUsersPage).toHaveBeenCalledTimes(1);
});

test('auth change aborts deletion and rejects late results; own-account actions are disabled', async () => {
  const own = buildAdminUserListItem('perf-webmaster', roots.get('perf-webmaster'));
  getAdminUsersPage.mockResolvedValueOnce({items: [own], hasMore: false, cursor: null});
  const view = render(<AdminPage />); await ready();
  expect(screen.getByLabelText('Ruolo perf-webmaster')).toBeDisabled();
  expect(screen.getByText('Elimina')).toBeDisabled();
  fireEvent.click(screen.getByText('Cerca')); await ready();
  const pending = deferred(); deleteAdminUser.mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getAllByText('Elimina')[0]);
  fireEvent.change(screen.getByLabelText('Conferma eliminazione'), {target: {value: 'ELIMINA'}});
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name: 'Elimina Utente'}));
  const signal = deleteAdminUser.mock.calls[0][0].signal;
  mockAuth = {user: {uid: 'other'}, userData: {role: 'player'}};
  view.rerender(<AdminPage />);
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve({status: 'completed'}));
  expect(screen.getByRole('alert')).toHaveTextContent('Accesso riservato');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

test('a page response predating confirmed role or deletion cannot undo that mutation', async () => {
  render(<AdminPage />); await ready();
  const target = [...mockRowProps.values()][0];
  const oldPage = await fetchPage({schemaVersion: 2, limit: 10});
  const reload = deferred(); getAdminUsersPage.mockReturnValueOnce(reload.promise);
  fireEvent.click(screen.getByText('Cerca'));
  fireEvent.change(screen.getByLabelText(`Ruolo ${target.user.id}`), {target: {value: 'dm'}});
  await waitFor(() => expect(screen.getByLabelText(`Ruolo ${target.user.id}`)).toHaveValue('dm'));
  await act(async () => reload.resolve(oldPage));
  expect(screen.getByLabelText(`Ruolo ${target.user.id}`)).toHaveValue('dm');
  const secondReload = deferred(); getAdminUsersPage.mockReturnValueOnce(secondReload.promise);
  fireEvent.click(screen.getByText('Cerca'));
  fireEvent.click(within(screen.getByTestId(`admin-row-${target.user.id}`)).getByText('Elimina'));
  fireEvent.change(screen.getByLabelText('Conferma eliminazione'), {target: {value: 'ELIMINA'}});
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name: 'Elimina Utente'}));
  await waitFor(() => expect(screen.queryByTestId(`admin-row-${target.user.id}`)).not.toBeInTheDocument());
  await act(async () => secondReload.resolve(oldPage));
  expect(screen.queryByTestId(`admin-row-${target.user.id}`)).not.toBeInTheDocument();
  expect(getAdminUsersPage).toHaveBeenCalledTimes(3);
});

test('A to B to A auth transitions cannot accept a previous A role callback', async () => {
  const view = render(<AdminPage />); await ready();
  const target = [...mockRowProps.values()][0];
  const pending = deferred(); mockRole.mockReturnValueOnce(pending.promise);
  act(() => { target.onRoleChange(target.user.id, 'dm'); });
  mockAuth = {user: {uid: 'other'}, userData: {role: 'player'}};
  view.rerender(<AdminPage />);
  mockAuth = {user: {uid: 'perf-webmaster'}, userData: {role: 'webmaster'}};
  view.rerender(<AdminPage />); await ready();
  await act(async () => pending.resolve({data: {role: 'dm'}}));
  expect(screen.getByLabelText(`Ruolo ${target.user.id}`)).toHaveValue(target.user.role);
});
