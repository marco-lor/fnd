import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { AuthContext } from '../../../AuthContext';
import { EditorVisibilitySelector, EditorConfigurationStatus, useEditorConfiguration } from './editorData';
import { invalidateConfig } from '../../../data/configRepository';
import { __resetRepositoryRuntimeForTests, setRepositoryActor } from '../../../data/repositoryRuntime';
import { getDoc, getDocs } from '../../../performance/firestore';

let mockGeneration = 1;
jest.mock('../../../AuthContext', () => ({AuthContext: require('react').createContext({}), useAuthSession: () => ({repositoryAccessGeneration: mockGeneration})}));
jest.mock('../../firebaseConfig', () => ({db: {}}));
jest.mock('../../../performance/firestore', () => ({
 doc: (_db, collection, id) => ({collection, id}), collection: (_db, name) => ({name}), labelFirestoreTarget: x => x,
 getDoc: jest.fn(), getDocs: jest.fn(), query: (...args) => args, orderBy: (...args) => args, limit: x => x,
 startAfter: (...after) => ({after}), where: (...args) => args, documentId: () => '__name__',
}));
const flush = async () => act(async () => { for (let i = 0; i < 35; i++) await Promise.resolve(); });
const deferred = () => { let resolve; const promise = new Promise(r => {resolve = r;}); return {resolve, promise}; };
const actor = {user: {uid: 'actor'}, userData: {role: 'dm'}};
const wrap = (child, value = actor) => <AuthContext.Provider value={value}>{child}</AuthContext.Provider>;
const document = index => {
 const id = `user-${String(index).padStart(3, '0')}`;
 const data = {schemaVersion: 1, characterId: `Character ${index}`, label: `Character ${index}`, normalizedLabel: id, role: 'player'};
 return {id, data: () => data, get: key => data[key]};
};
const configureDirectory = () => getDocs.mockImplementation(async target => {
 const after = target.find(part => part?.after)?.after?.[1];
 const start = after ? Number(after.slice(5)) + 1 : 0;
 return {docs: Array.from({length: Math.min(50, 200-start)}, (_, i) => document(start+i))};
});
const configSnapshot = data => ({exists: () => true, data: () => data});
function ConfigProbe() {
 const config = useEditorConfiguration('schema_weapon');
 return <><span>{config.loading ? 'loading-config' : config.schema?.name || 'empty-config'}</span><span>{Object.keys(config.commonSpells || {}).join(',')}</span><EditorConfigurationStatus configuration={config}/></>;
}
beforeEach(() => {
 __resetRepositoryRuntimeForTests(); setRepositoryActor('actor'); mockGeneration = 1; jest.clearAllMocks();
 getDoc.mockImplementation(async target => configSnapshot(target.id === 'utils' ? {tecniche_common: {Technique: {}}} : {name: 'current-config'}));
 configureDirectory();
});

test('directory waits for intent, resolves all 200 users through every cursor and reuses five cached pages', async () => {
 const onChange = jest.fn();
 const props = {visibility: 'all', allowedUsers: ['user-199', 'unknown'], onChange};
 const view = render(wrap(<EditorVisibilitySelector {...props}/>)); await flush(); expect(getDocs).not.toHaveBeenCalled();
 fireEvent.click(view.getByRole('button', {name: 'Utenti Selezionati'})); expect(onChange).toHaveBeenCalledWith('custom', props.allowedUsers);
 view.rerender(wrap(<EditorVisibilitySelector {...props} visibility="custom"/>)); await flush();
 expect(getDocs).toHaveBeenCalledTimes(5); expect(view.getAllByText('Character 199').length).toBeGreaterThan(0); expect(view.getByText('unknown')).toBeTruthy();
 expect(view.container.querySelectorAll('button').length).toBe(204);
 view.unmount();
 const reopen = render(wrap(<EditorVisibilitySelector {...props} visibility="custom"/>)); await flush(); expect(getDocs).toHaveBeenCalledTimes(5);
 expect(reopen.getAllByText('Character 199').length).toBeGreaterThan(0);
 process.stdout.write('TASK10_DIRECTORY_V1 users=200 pages=5 coldQueries=5 cachedReopenQueries=0 beforeIntentQueries=0\n');
});

test('directory failure retains unknown selection and allows retry after repository backoff', async () => {
 let now = 1000; jest.spyOn(Date, 'now').mockImplementation(() => now);
 getDocs.mockRejectedValueOnce(new Error('offline'));
 const view = render(wrap(<EditorVisibilitySelector visibility="custom" allowedUsers={['unknown']} onChange={() => {}}/>)); await flush();
 expect(view.getByRole('alert')).toBeTruthy(); expect(view.getByText('unknown')).toBeTruthy();
 now += 500; fireEvent.click(view.getByText('Riprova utenti')); await flush();
 expect(view.queryByRole('alert')).toBeNull(); expect(view.getByText('Character 199')).toBeTruthy();
 Date.now.mockRestore();
});

test('directory cancels paging after hidden intent, unmount or same-actor access transition', async () => {
 const pending = deferred(); getDocs.mockReturnValueOnce(pending.promise);
 const props = {visibility: 'custom', allowedUsers: ['unknown'], onChange: () => {}};
 const view = render(wrap(<EditorVisibilitySelector {...props}/>)); await flush();
 setRepositoryActor('actor'); mockGeneration++;
 view.rerender(wrap(<EditorVisibilitySelector {...props}/>)); await flush();
 expect(view.getByText('Character 199')).toBeTruthy();
 pending.resolve({docs: [document(999)]}); await flush(); expect(view.queryByText('Character 999')).toBeNull();
 view.unmount();
 const pendingSecond = deferred(); setRepositoryActor('actor'); getDocs.mockReturnValueOnce(pendingSecond.promise);
 const second = render(wrap(<EditorVisibilitySelector {...props}/>)); await flush(); second.unmount();
 const calls = getDocs.mock.calls.length;
 pendingSecond.resolve({docs: Array.from({length: 50}, (_, i) => document(i))}); await flush(); expect(getDocs).toHaveBeenCalledTimes(calls);
});

test('configuration loads once, refreshes only explicitly invalidated data and preserves cache reuse', async () => {
 const view = render(wrap(<ConfigProbe/>)); await flush(); expect(getDoc).toHaveBeenCalledTimes(4);
 view.rerender(wrap(<ConfigProbe/>)); await flush(); expect(getDoc).toHaveBeenCalledTimes(4);
 getDoc.mockImplementation(async target => configSnapshot(target.id === 'spells_common' ? {UpdatedSpell: {}} : {name: 'new-config'}));
 act(() => invalidateConfig('spells_common')); await flush(); expect(getDoc).toHaveBeenCalledTimes(5); expect(view.getByText('UpdatedSpell')).toBeTruthy();
 act(() => invalidateConfig('varie')); await flush(); expect(getDoc).toHaveBeenCalledTimes(5);
 view.unmount(); const reopened = render(wrap(<ConfigProbe/>)); await flush(); expect(getDoc).toHaveBeenCalledTimes(5); expect(reopened.getByText('UpdatedSpell')).toBeTruthy();
});

test('configuration retries failures and fences stale actor/access results', async () => {
 let now = 1000; jest.spyOn(Date, 'now').mockImplementation(() => now);
 getDoc.mockRejectedValueOnce(new Error('offline'));
 const view = render(wrap(<ConfigProbe/>)); await flush(); expect(view.getByRole('alert')).toBeTruthy();
 now += 500; fireEvent.click(view.getByText('Riprova')); await flush(); expect(view.getByText('current-config')).toBeTruthy();
 const pending = deferred(); getDoc.mockReturnValueOnce(pending.promise);
 act(() => invalidateConfig('schema_weapon')); await flush();
 setRepositoryActor('other'); mockGeneration++;
 view.rerender(wrap(<ConfigProbe/>, {user: {uid: 'other'}, userData: {role: 'player'}})); await flush();
 pending.resolve(configSnapshot({name: 'stale-secret'})); await flush(); expect(view.queryByText('stale-secret')).toBeNull(); expect(view.getByText('current-config')).toBeTruthy();
 Date.now.mockRestore();
});

test('hiding custom visibility cancels pending paging without discarding selected IDs', async () => {
 const pending = deferred(); getDocs.mockReturnValueOnce(pending.promise);
 const props = {allowedUsers: ['unknown'], onChange: () => {}};
 const view = render(wrap(<EditorVisibilitySelector {...props} visibility="custom"/>)); await flush();
 view.rerender(wrap(<EditorVisibilitySelector {...props} visibility="all"/>));
 pending.resolve({docs: Array.from({length: 50}, (_, i) => document(i))}); await flush();
 expect(getDocs).toHaveBeenCalledTimes(1);
 expect(view.queryByRole('status')).toBeNull();
});
