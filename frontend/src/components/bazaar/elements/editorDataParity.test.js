import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import useObjectUrl from '../../common/useObjectUrl';
import { AuthContext } from '../../../AuthContext';
import * as config from '../../../data/configRepository';
import * as directory from '../../../data/userDirectoryRepository';
import { __resetRepositoryRuntimeForTests, setRepositoryActor } from '../../../data/repositoryRuntime';
import { getDoc, getDocs, onSnapshot } from '../../../performance/firestore';
import { catalogSetDoc, catalogUpdateDoc } from '../../../data/bazaarCatalogRepository';
import { persistCanonicalInventoryItem } from '../../../data/media/privateInventoryMediaWriter';
import { isTask07CatalogItemWriterEnabled, runTask07CatalogItemWriter, retireTask07CatalogItemImage } from '../../../data/media/catalogItemMediaWriter';
import { AddWeaponOverlay } from './addWeapon';
import { AddArmaturaOverlay } from './addArmatura';
import { AddAccessorioOverlay } from './addAccessorio';
import { AddConsumabileOverlay } from './addConsumabile';
let mockAccessGeneration = 1;
jest.mock('../../../AuthContext', () => ({ AuthContext: require('react').createContext({}), AuthSessionContext: require('react').createContext({}), useAuthSession: () => ({repositoryAccessGeneration: mockAccessGeneration}) }));
jest.mock('../../firebaseConfig', () => ({db: {}}));
jest.mock('../../../performance/firestore', () => ({doc: (_db, collection, id) => ({id, collection}), collection: (_db, name) => ({name}), labelFirestoreTarget: x => x, getDoc: jest.fn(), getDocs: jest.fn(), onSnapshot: jest.fn(() => jest.fn()), query: (...args) => args, orderBy: (...args) => args, limit: x => x, startAfter: x => x, where: (...args) => args, documentId: () => '__name__'}));
jest.mock('../../../data/bazaarCatalogRepository', () => ({catalogSetDoc: jest.fn(), catalogUpdateDoc: jest.fn(), catalogDeleteDoc: jest.fn()}));
jest.mock('../../../data/userData/userDataHooks', () => {
 const data = { Parametri: {Base: {}, Combattimento: {}} }; const spells = {personal: {Nome: 'Personal'}}; const techniques = {};
 return {useProgression: () => ({data}), usePersonalSpells: () => ({data: spells}), usePersonalTechniques: () => ({data: techniques})};
});
jest.mock('../../common/legacyMediaStorage', () => ({createLegacyStorageCleanup: () => ({addUrl: () => {}, flush: async () => {}})}));
jest.mock('../../common/useObjectUrl', () => jest.fn(() => ''));
jest.mock('../../common/MediaImage', () => () => null);
jest.mock('../../../data/media/privateInventoryMediaWriter', () => ({persistCanonicalInventoryItem: jest.fn()}));
jest.mock('../../../data/userData/userDataCommands', () => ({createUserOperationId: () => 'fixture-operation'}));
jest.mock('../../../data/media/embeddedMediaRetry', () => ({task07EmbeddedFileFingerprint: file => file.name, resolveTask07CatalogCreateAttempt: () => ({blocked: false, resume: false})}));
jest.mock('../../../data/media/mediaConsumerAdapter', () => ({task07ConsumerNeedsAttention: () => false}));
jest.mock('../../../data/media/catalogItemMediaWriter', () => ({isTask07CatalogItemWriterEnabled: jest.fn(async () => false), runTask07CatalogItemWriter: jest.fn(), withTask07CatalogLegacyImageField: data => data, prepareTask07CatalogEmbeddedSpells: async ({customSpells}) => ({operations: [], spells: Object.fromEntries(customSpells.map(entry => [entry.spellData.Nome, entry.spellData]))}), retireTask07CatalogItemImage: jest.fn(async () => {}), task07CatalogItemImageEditorState: (item, options) => ({hasImage: !options?.removed && Boolean(item.General?.image_url), src: options?.removed ? '' : item.General?.image_url || ''}), task07CatalogEmbeddedSpellEditorState: item => ({linkedSpells: Object.keys(item.General?.spells || {}).filter(key => item.General.spells[key] === true), customSpells: Object.entries(item.General?.spells || {}).filter(([,v]) => v && typeof v === 'object').map(([name,v]) => ({spellData: {...v, Nome: v.Nome || name}}))})}));
const mockSectionCommits = {visibility: 0, spells: 0, Base: 0, Combattimento: 0, Special: 0};
jest.mock('./editorForm', () => {
 const actual = jest.requireActual('./editorForm');
 const React = require('react');
 return {...actual, EditorParameterTable: React.memo(props => {
  React.useLayoutEffect(() => { mockSectionCommits[props.paramCategory]++; });
  return actual.EditorParameterTable.type(props);
 })};
});
jest.mock('../../common/VisibilitySelector', () => { const Actual = jest.requireActual('../../common/VisibilitySelector').default; return props => { require('react').useLayoutEffect(() => { mockSectionCommits.visibility++; }); return <Actual {...props}/>; }; });
jest.mock('../../common/WeaponOverlay', () => ({WeaponOverlay: ({children, onSave}) => <div>{children}<button onClick={onSave}>fixture-save</button></div>}));
jest.mock('../../common/SpellOverlay', () => ({SpellOverlay: ({onClose}) => <button onClick={() => onClose({spellData: {Nome: 'Local spell'}})}>fixture-create-spell</button>}));
jest.mock('../../dmDashboard/elements/buttons/addSpell', () => ({AddSpellButton: ({onClick}) => { require('react').useLayoutEffect(() => { mockSectionCommits.spells++; }); return <button onClick={onClick}>fixture-add-spell</button>; }}));
const schema = {General: {Nome: '', Slot: ['Mano'], Effetto: '', prezzo: 0}, Specific: {Tipo: ['Test']}, Parametri: {Base: {Forza: {}}, Combattimento: {Attacco: {}}, Special: {Bonus: {}}}};
const typeSchemas = {
 Weapon: {...schema, Specific: {...schema.Specific, Hands: [1, 2]}},
 Armatura: {...schema, Specific: {...schema.Specific, slotCintura: 0}},
 Accessorio: {...schema, Specific: {...schema.Specific, Cariche: 0}},
 Consumabile: {...schema, Specific: {...schema.Specific, Cariche: 0, Riutilizzabile: false, Utilizzi: ['Azione', 'Reazione']}, Parametri: {...schema.Parametri, Special: {...schema.Parametri.Special, Stati: ['A', 'B']}}}
};
const item = {id: 'fixture', General: {Nome: 'Fixture', Slot: 'Mano', Effetto: 'Existing', prezzo: 123, ridCostoTecSingola: {Technique: 2}, ridCostoSpellSingola: {Common: 3}, spells: {Linked: true, Embedded: {Nome: 'Embedded', Costo: 3}}}, Specific: {Tipo: 'Test', Hands: 2, slotCintura: 3, Cariche: 4, Riutilizzabile: true, Utilizzi: ['Reazione']}, Parametri: {Base: {Forza: {'1': '17', '4': '18'}}, Combattimento: {Attacco: {'1': '6'}}, Special: {Bonus: {'1': '8'}, Stati: ['B']}}, visibility: 'custom', allowed_users: ['user-199', 'unknown']};
const actor = {user: {uid: 'actor', email: 'actor@test'}, userData: {role: 'dm', characterId: 'Actor'}};
const showMessage = () => {};
const types = [['Weapon', AddWeaponOverlay], ['Armatura', AddArmaturaOverlay], ['Accessorio', AddAccessorioOverlay], ['Consumabile', AddConsumabileOverlay]];
const flush = async () => { await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); }); };
const counts = () => ({schema: config.getSchema.mock.calls.length, spells: config.getCommonSpells.mock.calls.length, techniques: config.getCommonTechniques.mock.calls.length, directory: directory.getUserDirectoryPage.mock.calls.length, backendDocuments: getDoc.mock.calls.length, backendQueries: getDocs.mock.calls.length, collectionListeners: onSnapshot.mock.calls.length});
const delta = (a,b) => Object.fromEntries(Object.keys(a).map(k => [k, a[k]-b[k]]));
beforeEach(() => {
 __resetRepositoryRuntimeForTests(); setRepositoryActor('actor'); mockAccessGeneration = 1;
 jest.spyOn(config, 'getSchema'); jest.spyOn(config, 'getCommonSpells'); jest.spyOn(config, 'getCommonTechniques'); jest.spyOn(directory, 'getUserDirectoryPage');
 getDoc.mockImplementation(async target => ({exists: () => true, data: () => target.id === 'spells_common' ? {Common: {}} : target.id === 'utils' ? {tecniche_common: {Technique: {}}} : Object.entries(typeSchemas).find(([name]) => target.id === `schema_${name.toLowerCase()}`)?.[1] || schema})); persistCanonicalInventoryItem.mockResolvedValue({outcome: 'committed'}); getDocs.mockResolvedValue({docs: []}); onSnapshot.mockImplementation(() => jest.fn());
 isTask07CatalogItemWriterEnabled.mockResolvedValue(false); catalogUpdateDoc.mockReset(); catalogSetDoc.mockReset();
 jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {jest.restoreAllMocks(); jest.clearAllMocks();});
test.each(types)('task10-v1 parity/work: %s', async (name, Editor) => {
 const metrics = [];
 for (const mode of ['create', 'edit', 'inventory']) {
  const before = counts(); const props = mode === 'create' ? {} : {initialData: item, editMode: true, inventoryEditMode: mode === 'inventory'};
  const view = render(<AuthContext.Provider value={actor}><Editor {...props} showMessage={showMessage}/></AuthContext.Provider>); await flush();
  metrics.push({mode, open: delta(counts(), before)});
  expect(metrics[metrics.length-1].open).toMatchObject({schema: 2, spells: 1, techniques: 1, directory: mode === 'create' ? 0 : 1, collectionListeners: 0});
  const inputs = [...view.container.querySelectorAll('input')];
  if (mode !== 'create') { expect(inputs.some(input => input.value === 'Fixture')).toBe(true); expect(inputs.some(input => input.value === '17')).toBe(true); expect(view.container.textContent).toContain('unknown'); expect(view.container.textContent).toContain('Embedded'); }
  const sectionBefore = {...mockSectionCommits}; const typingBefore = counts(); const field = view.container.querySelector('textarea') || inputs.find(input => input.type === 'text' && !input.disabled && !input.placeholder?.includes('Cerca'));
  expect(field).toBeTruthy(); fireEvent.change(field, {target: {value: 'typed'}}); await flush(); metrics[metrics.length-1].typing = delta(counts(), typingBefore); metrics[metrics.length-1].typingSectionCommits = delta(mockSectionCommits, sectionBefore);
  expect(metrics[metrics.length-1].typingSectionCommits).toEqual({visibility: 0, spells: 0, Base: 0, Combattimento: 0, Special: 0});
  const paramBefore = {...mockSectionCommits}; const paramReadsBefore = counts();
  const paramInput = [...view.container.querySelectorAll('tr')].find(row => row.textContent.includes('Forza')).querySelector('input');
  fireEvent.change(paramInput, {target: {value: '43'}}); await flush();
  metrics[metrics.length-1].parameterSectionCommits = delta(mockSectionCommits, paramBefore);
  expect(metrics[metrics.length-1].parameterSectionCommits).toEqual({visibility: 0, spells: 0, Base: 1, Combattimento: 0, Special: 0});
  expect(Object.values(delta(counts(), paramReadsBefore)).every(value => value === 0)).toBe(true);
  const customBefore = counts(); fireEvent.click(view.getByText('fixture-add-spell')); await flush(); fireEvent.click(view.getByText('fixture-create-spell')); await flush();
  expect(view.container.textContent).toContain('Local spell'); metrics[metrics.length-1].customSpell = delta(counts(), customBefore);
  expect(Object.values(metrics[metrics.length-1].typing).every(value => value === 0)).toBe(true);
  expect(Object.values(metrics[metrics.length-1].customSpell).every(value => value === 0)).toBe(true);
  view.unmount();
 }
 process.stdout.write(`TASK10_FIXTURE_V1 ${name} ${JSON.stringify(metrics)}\n`);
});


test('task10-v1 cold/reopen/type switch sequence', async () => {
 const metrics = [];
 for (const [name, Editor] of [...types, types[0]]) {
  const before = counts(); const view = render(<AuthContext.Provider value={actor}><Editor showMessage={showMessage}/></AuthContext.Provider>); await flush();
  metrics.push({name, counts: delta(counts(), before)}); view.unmount();
 }
 process.stdout.write(`TASK10_SWITCH_V1 ${JSON.stringify(metrics)}\n`);
});



test.each(types)('task10-v1 save payload: %s create/edit/inventory', async (name, Editor) => {
 for (const mode of ['create', 'edit', 'inventory']) {
  const close = jest.fn();
  const props = mode === 'create' ? {} : {initialData: item, editMode: true, inventoryEditMode: mode === 'inventory', inventoryUserId: 'owner', inventoryItemId: 'inventory-1'};
  const view = render(<AuthContext.Provider value={actor}><Editor {...props} onClose={close} showMessage={showMessage}/></AuthContext.Provider>); await flush();
  if (mode === 'create') {
   const nameInput = [...view.container.querySelectorAll('input')].find(input => input.required);
   fireEvent.change(nameInput, {target: {value: 'Created'}});
  }
  fireEvent.click(view.getByText('fixture-save')); await flush();
  expect(close).toHaveBeenCalledWith(true);
  const payload = mode === 'inventory' ? persistCanonicalInventoryItem.mock.calls.slice(-1)[0][0].snapshot : (mode === 'create' ? catalogSetDoc : catalogUpdateDoc).mock.calls.slice(-1)[0][1];
  expect(payload.item_type).toBe(name.toLowerCase());
  expect(payload.General.Nome).toBe(mode === 'create' ? 'Created' : 'Fixture');
  expect(payload.Specific.Tipo).toBe('Test');
  expect(payload.visibility).toBe(mode === 'create' ? 'all' : 'custom');
  expect(payload.allowed_users).toEqual(mode === 'create' ? [] : ['user-199', 'unknown']);
  if (mode === 'create') {
   expect(payload.General.prezzo).toBe(0);
   if (name === 'Weapon') expect(payload.Specific.Hands).toBe(1);
   // Armor historically initializes a zero numeric schema default as an empty field.
   if (name === 'Armatura') expect(payload.Specific.slotCintura).toBe('');
   if (name === 'Accessorio' || name === 'Consumabile') expect(payload.Specific.Cariche).toBe(0);
   if (name === 'Consumabile') { expect(payload.Specific.Riutilizzabile).toBe(false); expect(payload.Specific.Utilizzi).toEqual([]); expect(payload.Parametri.Special.Stati).toEqual([]); }
  }
  if (mode !== 'create') {
   expect(payload.Parametri.Base.Forza).toEqual(['Weapon', 'Armatura'].includes(name) ? {'1': '17', '4': '18', '7': '', '10': ''} : {'1': '17', '4': '18'});
   expect(payload.General.prezzo).toBe(123);
   expect(payload.General.ridCostoTecSingola).toEqual({Technique: 2});
   expect(payload.General.ridCostoSpellSingola).toEqual({Common: 3});
   if (name === 'Weapon') expect(payload.Specific.Hands).toBe(2);
   if (name === 'Armatura') expect(payload.Specific.slotCintura).toBe(3);
   if (name === 'Accessorio' || name === 'Consumabile') expect(payload.Specific.Cariche).toBe(4);
   if (name === 'Consumabile') { expect(payload.Specific.Riutilizzabile).toBe(true); expect(payload.Specific.Utilizzi).toEqual(['Reazione']); expect(payload.Parametri.Special.Stati).toEqual(['B']); }
   expect(payload.Parametri.Combattimento.Attacco['1']).toBe('6');
   expect(payload.Parametri.Special.Bonus['1']).toBe('8');
   expect(payload.General.spells).toEqual({Linked: true, Embedded: {Nome: 'Embedded', Costo: 3}});
  }
  view.unmount();
 }
});

test.each(types)('configuration refresh preserves unsaved create form: %s', async (name, Editor) => {
 const child = () => <AuthContext.Provider value={actor}><Editor showMessage={showMessage}/></AuthContext.Provider>;
 const view = render(child());
 await flush();
 const nameField = () => [...view.container.querySelectorAll('input')].find(input => input.required);
 const nestedField = () => [...view.container.querySelectorAll('tr')].find(row => row.textContent.includes('Forza')).querySelector('input');
 const file = new File(['draft image'], 'draft.png', {type: 'image/png'});
 fireEvent.change(nameField(), {target: {value: 'Unsaved draft'}});
 fireEvent.change(nestedField(), {target: {value: '42'}});
 fireEvent.change(view.container.querySelector('input[type="file"]'), {target: {files: [file]}});
 fireEvent.click(view.getByText('fixture-add-spell')); await flush();
 fireEvent.click(view.getByText('fixture-create-spell')); await flush();
 const assertDraft = () => {
  expect(nameField().value).toBe('Unsaved draft');
  expect(nestedField().value).toBe('42');
  expect(view.container.textContent).toContain('Local spell');
  expect(useObjectUrl.mock.calls.slice(-1)[0][0]).toBe(file);
 };
 for (const documentId of ['spells_common', `schema_${name.toLowerCase()}`, 'schema_spell']) {
  act(() => config.invalidateConfig(documentId)); await flush(); assertDraft();
 }
 // Failure followed by retry must not turn a refresh into initialization.
 let now = 1000; jest.spyOn(Date, 'now').mockImplementation(() => now);
 getDoc.mockRejectedValueOnce(new Error('refresh offline'));
 act(() => config.invalidateConfig('spells_common')); await flush();
 expect(view.getByRole('alert')).toBeTruthy();
 now += 500; fireEvent.click(view.getByText('Riprova')); await flush(); assertDraft();
 // The same actor's authoritative access generation refreshes repositories.
 setRepositoryActor('actor'); mockAccessGeneration++;
 view.rerender(child()); await flush(); assertDraft();
});

test.each(types)('intentional item and mode changes initialize fresh drafts: %s', async (_name, Editor) => {
 const child = props => <AuthContext.Provider value={actor}><Editor showMessage={showMessage} {...props}/></AuthContext.Provider>;
 const view = render(child({initialData: item, editMode: true})); await flush();
 const nameField = () => [...view.container.querySelectorAll('input')].find(input => input.required);
 expect(nameField().value).toBe('Fixture');
 const nextItem = {...item, id: 'next-item', General: {...item.General, Nome: 'Next item', spells: {}}};
 view.rerender(child({initialData: nextItem, editMode: true})); await flush();
 expect(nameField().value).toBe('Next item');
 expect(view.container.textContent).not.toContain('Embedded');
 view.rerender(child({})); await flush();
 expect(nameField().value).toBe('');
 expect(view.container.textContent).not.toContain('Embedded');
 fireEvent.change(nameField(), {target: {value: 'New draft'}}); await flush();
 act(() => config.invalidateConfig('spells_common')); await flush();
 expect(nameField().value).toBe('New draft');
 view.rerender(child({initialData: item, editMode: true})); await flush();
 expect(nameField().value).toBe('Fixture');
 expect(view.container.textContent).toContain('Embedded');
});


test.each(types.slice(2))('legacy-root reductions round trip: %s edit/inventory', async (_name, Editor) => {
 const legacy = {...item, General: {...item.General}, ridCostoTecSingola: {Technique: 2}, ridCostoSpellSingola: {Common: 3}};
 delete legacy.General.ridCostoTecSingola; delete legacy.General.ridCostoSpellSingola;
 for (const inventoryEditMode of [false, true]) {
  const view = render(<AuthContext.Provider value={actor}><Editor initialData={legacy} editMode inventoryEditMode={inventoryEditMode} inventoryUserId="owner" inventoryItemId="inventory-1" onClose={() => {}} showMessage={showMessage}/></AuthContext.Provider>); await flush();
  fireEvent.click(view.getByText('fixture-save')); await flush();
  const payload = inventoryEditMode ? persistCanonicalInventoryItem.mock.calls.slice(-1)[0][0].snapshot : catalogUpdateDoc.mock.calls.slice(-1)[0][1];
  expect(payload.General.ridCostoTecSingola).toEqual({Technique: 2});
  expect(payload.General.ridCostoSpellSingola).toEqual({Common: 3});
  view.unmount();
 }
});

test.each(types)('image removal waits for durable metadata and can retry: %s', async (_name, Editor) => {
 const oldItem = {...item, General: {...item.General, image_url: 'https://example.test/old.png'}};
 const originalRead = getDoc.getMockImplementation();
 getDoc.mockImplementation(target => target.collection === 'items' ? Promise.resolve({exists: () => true, data: () => oldItem}) : originalRead(target));
 const order = [];
 catalogUpdateDoc.mockImplementationOnce(async () => { order.push('metadata-failed'); throw new Error('save failed'); }).mockImplementation(async () => { order.push('metadata-committed'); });
 retireTask07CatalogItemImage.mockImplementation(async () => { order.push('retired'); });
 jest.spyOn(console, 'error').mockImplementation(() => {});
 const close = jest.fn();
 const view = render(<AuthContext.Provider value={actor}><Editor initialData={oldItem} editMode onClose={close} showMessage={showMessage}/></AuthContext.Provider>); await flush();
 fireEvent.click(view.getByText(/Rimuovi Immagine/i));
 fireEvent.click(view.getByText('fixture-save')); await flush();
 expect(retireTask07CatalogItemImage).not.toHaveBeenCalled();
 expect(close).not.toHaveBeenCalled();
 expect(oldItem.General.image_url).toBe('https://example.test/old.png');
 fireEvent.click(view.getByText('fixture-save')); await flush();
 expect(order).toEqual(['metadata-failed', 'metadata-committed', 'retired']);
 expect(retireTask07CatalogItemImage).toHaveBeenCalledWith(expect.objectContaining({General: oldItem.General}));
 expect(close).toHaveBeenCalledWith(true);
});


test.each(types)('upload failure and retry use canonical writer; unmount cancels: %s', async (_name, Editor) => {
 isTask07CatalogItemWriterEnabled.mockResolvedValue(true);
 jest.spyOn(console, 'error').mockImplementation(() => {});
 runTask07CatalogItemWriter.mockRejectedValueOnce(new Error('upload failed'));
 const close = jest.fn();
 const view = render(<AuthContext.Provider value={actor}><Editor initialData={item} editMode onClose={close} showMessage={showMessage}/></AuthContext.Provider>); await flush();
 const file = new File(['image'], 'canonical.png', {type: 'image/png'});
 fireEvent.change(view.container.querySelector('input[type="file"]'), {target: {files: [file]}});
 fireEvent.click(view.getByText('fixture-save')); await flush();
 expect(close).not.toHaveBeenCalled(); expect(retireTask07CatalogItemImage).not.toHaveBeenCalled();
 expect(catalogUpdateDoc).not.toHaveBeenCalled();
 const order = [];
 catalogUpdateDoc.mockImplementation(async () => {order.push('parent');});
 runTask07CatalogItemWriter.mockImplementationOnce(async ({prepareEntity}) => { await prepareEntity(); order.push('processed-and-attached'); return {handled: true, status: 'saved'}; });
 fireEvent.click(view.getByText('fixture-save')); await flush();
 expect(order).toEqual(['parent', 'processed-and-attached']); expect(close).toHaveBeenCalledWith(true);
 expect(runTask07CatalogItemWriter.mock.calls.slice(-1)[0][0]).toEqual(expect.objectContaining({file, actorUid: 'actor', role: 'dm', prepareEntity: expect.any(Function), rollbackPreparedEntity: expect.any(Function), signal: expect.any(AbortSignal)}));
 // A later in-flight upload is canceled by the actual operation-owner hook.
 close.mockClear(); let pendingSignal;
 runTask07CatalogItemWriter.mockImplementationOnce(({signal}) => new Promise((resolve, reject) => { pendingSignal = signal; signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true}); }));
 fireEvent.change(view.container.querySelector('input[type="file"]'), {target: {files: [new File(['next'], 'next.png', {type: 'image/png'})]}});
 fireEvent.click(view.getByText('fixture-save')); await flush();
 expect(pendingSignal.aborted).toBe(false); view.unmount(); await flush(); expect(pendingSignal.aborted).toBe(true);
 expect(close).not.toHaveBeenCalled();
});

test.each(types.slice(2))('canonical reductions take precedence and retain missing options: %s', async (_name, Editor) => {
 const source = {...item, General: {...item.General, ridCostoTecSingola: {'Missing technique': 7}, ridCostoSpellSingola: {'Missing spell': 8}}, ridCostoTecSingola: {Legacy: 1}, ridCostoSpellSingola: {Legacy: 1}};
 const view = render(<AuthContext.Provider value={actor}><Editor initialData={source} editMode onClose={() => {}} showMessage={showMessage}/></AuthContext.Provider>); await flush();
 const selections = [...view.container.querySelectorAll('select')].map(element => element.value);
 expect(selections).toContain('Missing technique'); expect(selections).toContain('Missing spell');
 fireEvent.click(view.getByText('fixture-save')); await flush();
 expect(catalogUpdateDoc.mock.calls.slice(-1)[0][1].General).toMatchObject({ridCostoTecSingola: {'Missing technique': 7}, ridCostoSpellSingola: {'Missing spell': 8}});
});
