import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Bazaar from './Bazaar';
import { AuthContext } from '../../AuthContext';
import { getCallable } from '../../data/functions/callableRegistry';
import { onSnapshot, getDoc } from '../../performance/firestore';
import { uploadTask07Source } from '../../data/media/mediaUpload';
import { createTask07AbortError } from '../../data/media/mediaErrors';

// Keep Bazaar, its detail hook, comparison panel, lazy boundary, all four real
// editors, catalog writer, receipt store, media pipeline and operation owner.
// Only server/storage transports and unrelated read/config surfaces are doubles.
let mockAccessGeneration = 1;
jest.mock('../../AuthContext', () => {
  const React = require('react');
  const AuthContext = React.createContext({});
  return {AuthContext, useAuth: () => React.useContext(AuthContext), useAuthSession: () => ({repositoryAccessGeneration: mockAccessGeneration})};
});
jest.mock('../firebaseConfig', () => ({db: {}}));
jest.mock('../firebaseStorage', () => ({storage: {}}));
jest.mock('../../performance/firestore', () => ({
  doc: (_db, collection, id) => ({id, path: `${collection}/${id}`, parent: {id: collection}}),
  onSnapshot: jest.fn(), getDoc: jest.fn(),
}));
jest.mock('../../data/functions/callableRegistry', () => ({getCallable: jest.fn()}));
jest.mock('../../data/media/mediaUpload', () => ({uploadTask07Source: jest.fn()}));
jest.mock('../../data/media/mediaFeatureFlags', () => ({isTask07MediaV1WriteEnabled: async () => true}));
jest.mock('../../data/configRepository', () => ({
  getSchema: async () => ({General: {Nome: '', Slot: ['Mano'], Effetto: '', prezzo: 0}, Specific: {Tipo: ['Test']}, Parametri: {Base: {Forza: {}}, Combattimento: {}, Special: {}}}),
  getCommonSpells: async () => ({}), getCommonTechniques: async () => ({}), getVarie: async () => ({}), subscribeConfigInvalidation: () => () => {},
}));
jest.mock('../../data/userDirectoryRepository', () => ({getUserDirectoryPage: async () => ({items: [], hasMore: false})}));
jest.mock('../../data/userData/userDataHooks', () => {
  const data = {Parametri: {Base: {}, Combattimento: {}}, stats: {gold: 1000}};
  const empty = {};
  return {useResources: () => ({data, status: 'fresh'}), useProgression: () => ({data}), usePersonalSpells: () => ({data: empty}), usePersonalTechniques: () => ({data: empty})};
});
jest.mock('../common/shellLayout', () => ({useShellLayout: () => ({topInset: 0})}));
jest.mock('../common/MediaImage', () => ({__esModule: true, default: ({src, alt}) => <img src={src || undefined} alt={alt}/>, hasMediaAsset: () => false}));
jest.mock('../common/MediaVideo', () => () => null);
jest.mock('../common/legacyMediaStorage', () => ({createLegacyStorageCleanup: () => ({addUrl: () => {}, flush: async () => {}})}));

const actor = {user: {uid: 'actor'}, userData: {role: 'dm'}};
const oldAssetId = `m_${'a'.repeat(40)}`;
const newAssetId = `m_${'b'.repeat(40)}`;
const spellAssetId = `m_${'c'.repeat(40)}`;
const types = ['weapon', 'armatura', 'accessorio', 'consumabile'];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};
let stored, revision, publish, upload, detailRefresh, writes, attachments, failNextWrite;
const clone = value => JSON.parse(JSON.stringify(value));
const app = (value = actor) => <AuthContext.Provider value={value}><Bazaar/></AuthContext.Provider>;
const originalTextEncoder = global.TextEncoder;
const originalCrypto = global.crypto;
beforeAll(() => {
  global.TextEncoder = require('util').TextEncoder;
  global.crypto = require('crypto').webcrypto;
});
afterAll(() => {global.TextEncoder = originalTextEncoder; global.crypto = originalCrypto;});

beforeEach(() => {
  localStorage.clear(); mockAccessGeneration = 1;
  revision = 1; writes = 0; attachments = 0; failNextWrite = false;
  upload = deferred(); detailRefresh = deferred();
  URL.createObjectURL = jest.fn(() => 'blob:replacement');
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  onSnapshot.mockImplementation((_ref, next) => {
    publish = () => next({data: () => ({state: 'active', schemaVersion: 1, revision})});
    publish(); return () => {};
  });
  getDoc.mockImplementation(async () => ({exists: () => Boolean(stored), data: () => clone(stored)}));
  getCallable.mockImplementation(name => async input => {
    if (name === 'task09CatalogPage') return {data: {revision: input.revision, rows: [{id: stored.id, item_type: stored.item_type, name: stored.General.Nome, price: 1}], cursor: null}};
    if (name === 'task09CatalogDetail') {
      if (input.revision > 1) await detailRefresh.promise;
      return {data: clone(stored)};
    }
    if (name === 'task09WriteCatalogItem') {
      if (failNextWrite) {failNextWrite = false; throw new Error('metadata unavailable');}
      writes++;
      stored = input.replace ? {id: stored.id, ...clone(input.item)} : {...stored, ...clone(input.item)};
      revision++; publish();
      return {data: {ok: true}};
    }
    if (name === 'task07PrepareMediaUpload') return {data: {ok: true, replay: false, state: 'intent', sourcePresent: false, upload: {assetId: input.kind === 'spell' ? spellAssetId : newAssetId, sourcePath: 'media_uploads/actor/replacement/source'}}};
    if (name === 'task07GetMediaStatus') return {data: {ok: true, assetId: input.assetId, state: 'ready', ready: true, attached: false}};
    if (name === 'task07AttachMediaAsset') {
      attachments++;
      if (input.assetId === newAssetId) stored = {...stored, media: {assetId: newAssetId}, task07MediaRevision: 2};
      revision++; publish();
      return {data: {ok: true, assetId: input.assetId, state: 'attached'}};
    }
    if (name === 'task07AbandonMediaAsset') return {data: {ok: true}};
    throw new Error(`Unexpected callable: ${name}`);
  });
  uploadTask07Source.mockImplementation(({signal}) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(createTask07AbortError(signal.reason)), {once: true});
    if (signal.aborted) reject(createTask07AbortError(signal.reason));
    upload.promise.then(resolve, reject);
  }));
});
afterEach(() => {jest.restoreAllMocks(); jest.clearAllMocks();});

async function openPanelEditor(kind) {
  stored = {id: `fixture-${kind}`, item_type: kind, media: {assetId: oldAssetId}, task07MediaRevision: 1,
    General: {Nome: 'Original', Effetto: 'Saved effect', prezzo: 1, Slot: 'Mano', spells: {}}, Specific: {Tipo: 'Test'}, Parametri: {Base: {Forza: {'1': '17'}}, Combattimento: {}, Special: {}}, visibility: 'all'};
  const view = render(app());
  fireEvent.click(await screen.findByTestId(`bazaar-item-card-fixture-${kind}`));
  fireEvent.click(await screen.findByTitle('Modifica Oggetto'));
  await screen.findByRole('button', {name: 'Salva Modifiche'});
  fireEvent.change(document.querySelector('textarea'), {target: {value: 'Unsaved draft'}});
  fireEvent.change(document.querySelector('input[type="file"]'), {target: {files: [new File(['orange'], 'replacement.png', {type: 'image/png', lastModified: 1})]}});
  return view;
}

test.each(types)('panel %s replacement remains mounted while catalog detail refreshes and upload is pending', async kind => {
  await openPanelEditor(kind);
  fireEvent.click(screen.getByRole('button', {name: 'Salva Modifiche'}));
  await waitFor(() => { expect(console.error.mock.calls).toEqual([]); expect(writes).toBe(1); });
  await screen.findByTestId('bazaar-detail-placeholder');
  // This is the real parent boundary that previously unmounted the media owner.
  expect(screen.getByRole('button', {name: 'Saving...'})).toBeDisabled();
  expect(document.querySelector('textarea').value).toBe('Unsaved draft');
  expect(stored.media.assetId).toBe(oldAssetId);
  await waitFor(() => expect(uploadTask07Source).toHaveBeenCalledTimes(1));
  expect(uploadTask07Source.mock.calls[0][0].signal.aborted).toBe(false);
  await act(async () => {detailRefresh.resolve();});
  expect(screen.getByRole('button', {name: 'Saving...'})).toBeDisabled();
  await act(async () => {upload.resolve({entries: []});});
  await waitFor(() => expect(attachments).toBe(1));
  expect(stored.media.assetId).toBe(newAssetId);
  expect(stored.General.Effetto).toBe('Unsaved draft');
  await waitFor(() => expect(screen.queryByRole('button', {name: 'Saving...'})).not.toBeInTheDocument());
  expect(document.querySelector('textarea')).toBeNull();
  expect(console.error).not.toHaveBeenCalled();
});

test.each(types.flatMap(kind => ['metadata', 'upload'].map(stage => [kind, stage])))('%s %s failure preserves old media and the draft for retry', async (kind, stage) => {
  await openPanelEditor(kind);
  if (stage === 'metadata') failNextWrite = true;
  fireEvent.click(screen.getByRole('button', {name: 'Salva Modifiche'}));
  if (stage === 'upload') {
    await waitFor(() => expect(uploadTask07Source).toHaveBeenCalledTimes(1));
    await act(async () => {upload.reject(new Error('upload unavailable'));});
  }
  await waitFor(() => expect(console.error).toHaveBeenCalled());
  expect(console.error.mock.calls[0][1].message).toContain(`${stage} unavailable`);
  expect(screen.getByRole('button', {name: 'Salva Modifiche'})).toBeEnabled();
  expect(document.querySelector('textarea').value).toBe('Unsaved draft');
  expect(document.querySelector('img[src="blob:replacement"]')).not.toBeNull();
  expect(stored.media.assetId).toBe(oldAssetId);
  expect(stored.General.Effetto).toBe('Saved effect');
  expect(attachments).toBe(0);
  upload = deferred();
  await act(async () => {detailRefresh.resolve();});
  fireEvent.click(screen.getByRole('button', {name: 'Salva Modifiche'}));
  await waitFor(() => expect(uploadTask07Source).toHaveBeenCalledTimes(stage === 'upload' ? 2 : 1));
  await act(async () => {upload.resolve({entries: []});});
  await waitFor(() => expect(document.querySelector('textarea')).toBeNull());
  expect(stored.media.assetId).toBe(newAssetId);
  expect(stored.General.Effetto).toBe('Unsaved draft');
  expect(attachments).toBe(1);
});

test.each(types)('%s retry after embedded upload failure does not upload the completed root image again', async kind => {
  await openPanelEditor(kind);
  fireEvent.click(screen.getByRole('button', {name: /Add Spell/i}));
  fireEvent.change(await screen.findByPlaceholderText('Spell Name *'), {target: {value: 'Draft spell'}});
  fireEvent.change(screen.getByLabelText('Spell image file'), {target: {files: [new File(['spell'], 'spell.png', {type: 'image/png'})]}});
  fireEvent.click(screen.getByRole('button', {name: 'Crea Spell Custom'}));
  let failedSpell = false;
  const originalUpload = uploadTask07Source.getMockImplementation();
  uploadTask07Source.mockImplementation(input => {
    if (input.file.name !== 'spell.png') return originalUpload(input);
    if (!failedSpell) {failedSpell = true; return Promise.reject(new Error('spell upload unavailable'));}
    return Promise.resolve({entries: []});
  });
  fireEvent.click(screen.getByRole('button', {name: 'Salva Modifiche'}));
  await waitFor(() => expect(uploadTask07Source).toHaveBeenCalledTimes(1));
  await act(async () => {detailRefresh.resolve(); upload.resolve({entries: []});});
  await waitFor(() => expect(console.error).toHaveBeenCalled());
  expect(stored.media.assetId).toBe(newAssetId);
  expect(document.querySelector('textarea').value).toBe('Unsaved draft');
  expect(screen.getByRole('button', {name: 'Salva Modifiche'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button', {name: 'Salva Modifiche'}));
  await waitFor(() => expect(document.querySelector('textarea')).toBeNull());
  expect(uploadTask07Source.mock.calls.map(([input]) => input.file.name)).toEqual(['replacement.png', 'spell.png', 'spell.png']);
  expect(attachments).toBe(2);
});

test.each(types.flatMap(kind => ['account', 'access', 'role', 'unmount'].map(change => [kind, change])))('%s pending replacement cancels on genuine %s change', async (kind, change) => {
  const view = await openPanelEditor(kind);
  fireEvent.click(screen.getByRole('button', {name: 'Salva Modifiche'}));
  await waitFor(() => expect(uploadTask07Source).toHaveBeenCalledTimes(1));
  const signal = uploadTask07Source.mock.calls[0][0].signal;
  if (change === 'account') view.rerender(app({...actor, user: {uid: 'other'}}));
  else if (change === 'access') {mockAccessGeneration++; view.rerender(app());}
  else if (change === 'role') view.rerender(app({...actor, userData: {role: 'player'}}));
  else view.unmount();
  expect(signal.aborted).toBe(true);
  expect(document.querySelector('textarea')).toBeNull();
  await waitFor(() => expect(console.error).toHaveBeenCalled());
  expect(console.error.mock.calls[0][1].code).toBe('aborted');
  expect(attachments).toBe(0);
  expect(stored.media.assetId).toBe(oldAssetId);
  await act(async () => {upload.resolve({entries: []}); detailRefresh.resolve();});
  expect(attachments).toBe(0);
});

test.each(types)('%s cancel followed by a different panel selection opens a fresh target', async kind => {
  await openPanelEditor(kind);
  fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
  expect(document.querySelector('textarea')).toBeNull();
  expect(writes).toBe(0);
  expect(uploadTask07Source).not.toHaveBeenCalled();
  await act(async () => {
    stored = {...stored, id: `next-${kind}`, General: {...stored.General, Nome: 'Next target', Effetto: 'Other effect'}};
    revision++; publish(); detailRefresh.resolve();
  });
  fireEvent.click(await screen.findByTestId(`bazaar-item-card-next-${kind}`));
  fireEvent.click(await screen.findByTitle('Modifica Oggetto'));
  await screen.findByRole('button', {name: 'Salva Modifiche'});
  expect(document.querySelector('input[required]').value).toBe('Next target');
  expect(document.querySelector('textarea').value).toBe('Other effect');
  expect(document.querySelector('img[src="blob:replacement"]')).toBeNull();
  expect(console.error).not.toHaveBeenCalled();
});
