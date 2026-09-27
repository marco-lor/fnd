import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PlayerInfo from './playerInfo';
import { subscribeUserDomain } from '../../../data/userData/userDataRepository';
import { normalizeV2InventoryDocument } from '../../../data/userData/normalizers';
import { catalogDetail, catalogPage, watchCatalogRevision } from '../../../data/bazaarCatalogRepository';

const {buildInventoryDocuments} = require('../../../../scripts/task05/user-data-model');
let mockGeneration = 0;
const mockEditor = jest.fn();
jest.mock('../../../AuthContext', () => ({useAuthSession: () => ({repositoryAccessGeneration: mockGeneration})}));
jest.mock('../../firebaseConfig', () => ({db: {}}));
jest.mock('../../../data/userDirectoryRepository', () => ({}));
jest.mock('../../../data/userData/managerSummaryRepository', () => ({}));
jest.mock('../../../data/userData/userDataRepository', () => ({subscribeUserDomain: jest.fn()}));
jest.mock('../../../data/bazaarCatalogRepository', () => ({catalogDetail: jest.fn(), catalogPage: jest.fn(), watchCatalogRevision: jest.fn()}));
jest.mock('../../../data/userData/userDataCommands', () => ({createUserOperationId: () => 'test-operation'}));
jest.mock('./playerInfo/sections/PlayerInfoDiceRollsRow', () => () => null);
jest.mock('./lazyPlayerInfoOverlays', () => ({
  EditVarieItemOverlay: (props) => { mockEditor('varie', props); return <div>varie editor</div>; },
}));
jest.mock('../../bazaar/lazyBazaarEditors', () => ({
  AddWeaponOverlay: (props) => { mockEditor('weapon', props); return <div>weapon editor</div>; },
  AddArmaturaOverlay: (props) => { mockEditor('armatura', props); return <div>armatura editor</div>; },
  AddAccessorioOverlay: (props) => { mockEditor('accessorio', props); return <div>accessorio editor</div>; },
  AddConsumabileOverlay: (props) => { mockEditor('consumabile', props); return <div>consumabile editor</div>; },
}));

const users = [{id: 'player', label: 'Player', stats: {}, settings: {}}];
const migratedItem = (snapshot) => {
  const document = buildInventoryDocuments('player', [snapshot])[0];
  return normalizeV2InventoryDocument({id: document.id, data: () => document.data});
};
const inventory = (item) => subscribeUserDomain.mockImplementation((_uid, domain, observer) => {
  observer.next(domain === 'inventory' ? [item] : {});
  return jest.fn();
});
const openItem = () => {
  const view = render(<PlayerInfo users={users} />);
  expect(watchCatalogRevision).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', {name: 'Espandi'}));
  expect(watchCatalogRevision).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTitle('Modifica oggetto'));
  return view;
};

beforeEach(() => {
  jest.resetAllMocks();
  mockGeneration = 0;
  inventory(migratedItem({id: 'catalog-item', General: {Nome: 'Personal name'}, Specific: {custom: 9}}));
  watchCatalogRevision.mockImplementation((next) => { next(7); return jest.fn(); });
  catalogDetail.mockResolvedValue({id: 'catalog-item', item_type: 'armatura', General: {Nome: 'Catalog name', prezzo: 40}, Specific: {custom: 1, defaultValue: 2}});
});

test.each(['weapon', 'armatura', 'accessorio', 'consumabile', 'varie'])('partial migrated inventory lazily resolves the %s editor and retains personal fields', async (type) => {
  catalogDetail.mockResolvedValue({id: 'catalog-item', item_type: type, General: {Nome: 'Catalog name', prezzo: 40}, Specific: {custom: 1, defaultValue: 2}});
  const view = openItem();
  expect(await screen.findByText(`${type} editor`)).toBeVisible();
  expect(catalogDetail).toHaveBeenCalledTimes(1);
  expect(catalogDetail).toHaveBeenCalledWith('catalog-item', 7);
  expect(catalogPage).not.toHaveBeenCalled();
  const [editor, props] = mockEditor.mock.calls.at(-1);
  expect(editor).toBe(type);
  expect(props.inventoryItemId).toBe(migratedItem({id: 'catalog-item', General: {Nome: 'Personal name'}, Specific: {custom: 9}})._task05.inventoryId);
  expect(props.initialData).toMatchObject({item_type: type, General: {Nome: 'Personal name', prezzo: 40}, Specific: {custom: 9, defaultValue: 2}});
  view.unmount();
});

test('self-contained inventory opens the saved type without catalog reads', () => {
  inventory(migratedItem({id: 'catalog-item', type: 'accessorio', General: {Nome: 'Ring'}}));
  openItem();
  expect(screen.getByText('accessorio editor')).toBeVisible();
  expect(catalogDetail).not.toHaveBeenCalled();
  expect(watchCatalogRevision).not.toHaveBeenCalled();
});

test('a failed item lookup can retry without falling back to the weapon editor', async () => {
  catalogDetail.mockRejectedValueOnce(new Error('Catalog item unavailable'));
  openItem();
  expect(await screen.findByRole('alert')).toHaveTextContent('Catalog item unavailable');
  expect(mockEditor).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', {name: 'Riprova'}));
  expect(await screen.findByText('armatura editor')).toBeVisible();
  expect(catalogDetail).toHaveBeenCalledTimes(2);
});

test('resolved editor keeps its snapshot when the catalog later changes', async () => {
  let publishRevision;
  const stop = jest.fn();
  watchCatalogRevision.mockImplementation((next) => { publishRevision = next; next(7); return stop; });
  const view = openItem();
  expect(await screen.findByText('armatura editor')).toBeVisible();
  expect(stop).toHaveBeenCalledTimes(1);
  const initialData = mockEditor.mock.calls.at(-1)[1].initialData;
  await act(async () => publishRevision(8));
  view.rerender(<PlayerInfo users={users.map((user) => ({...user, stats: {gold: 5}}))} />);
  expect(screen.getByText('armatura editor')).toBeVisible();
  expect(mockEditor.mock.calls.at(-1)[1].initialData).toBe(initialData);
  expect(catalogDetail).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
});

test('collapse releases the catalog listener and ignores a late detail result', async () => {
  let resolve;
  const stop = jest.fn();
  catalogDetail.mockImplementation(() => new Promise((done) => { resolve = done; }));
  watchCatalogRevision.mockImplementation((next) => { next(7); return stop; });
  openItem();
  fireEvent.click(screen.getByRole('button', {name: 'Comprimi'}));
  expect(stop).toHaveBeenCalledTimes(1);
  await act(async () => resolve({id: 'catalog-item', item_type: 'weapon'}));
  expect(mockEditor).not.toHaveBeenCalled();
});

test('access changes discard pending catalog results before reopening the editor', async () => {
  const pending = [];
  catalogDetail.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const view = openItem();
  mockGeneration = 1;
  // The mocked context does not broadcast updates, so also refresh the card prop.
  view.rerender(<PlayerInfo users={users.map((user) => ({...user}))} />);
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(async () => pending[0]({id: 'catalog-item', item_type: 'weapon'}));
  expect(mockEditor).not.toHaveBeenCalled();
  await act(async () => pending[1]({id: 'catalog-item', item_type: 'armatura'}));
  expect(await screen.findByText('armatura editor')).toBeVisible();
});
