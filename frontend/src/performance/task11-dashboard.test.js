import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useManagerUserData } from '../data/userData/managerUserData';
import PlayerInfo from '../components/dmDashboard/elements/playerInfo';
import { getUserDirectoryPage, subscribeUserDirectoryPage } from '../data/userDirectoryRepository';
import { subscribeManagerSummary } from '../data/userData/managerSummaryRepository';
import { subscribeUserDomain } from '../data/userData/userDataRepository';
import { getDocs, onSnapshot } from './firestore';
import { normalizeUserShell, normalizeV2StateDocument, normalizeV2InventoryDocument,
  normalizeV2PersonalContentDocument, mapV2PersonalContentItems } from '../data/userData/normalizers';

const { task11Dashboard: budget } = require('../../performance/budgets.json');
const { buildDocuments, buildManifest } = require('../../scripts/performance/fixtures');
const { buildManagerUserSummary } = require('../../functions/lib/managerUserSummaryProjection');
jest.mock('../AuthContext', () => ({ useAuthSession: () => ({ repositoryAccessGeneration: 0 }) }));
jest.mock('../components/firebaseConfig', () => ({ db: {} }));
jest.mock('../components/dmDashboard/elements/playerInfo/sections/PlayerInfoActionsRow', () => () => null);
jest.mock('../components/dmDashboard/elements/playerInfo/sections/PlayerInfoInventoryRow', () => () => null);
jest.mock('../data/userDirectoryRepository', () => ({ getUserDirectoryPage: jest.fn(), subscribeUserDirectoryPage: jest.fn() }));
jest.mock('../data/userData/managerSummaryRepository', () => ({ subscribeManagerSummary: jest.fn() }));
jest.mock('../data/userData/userDataRepository', () => ({ subscribeUserDomain: jest.fn() }));
jest.mock('../data/userData/userDataCommands', () => ({ adjustGold: jest.fn(), updateResource: jest.fn() }));
jest.mock('./firestore', () => ({
  collection: (_db, ...parts) => parts.join('/'), query: (target) => target,
  orderBy: jest.fn(), limit: jest.fn(), getDocs: jest.fn(), onSnapshot: jest.fn(),
}));

const documents = buildDocuments();
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const directories = documents.filter(({path, data}) => path.startsWith('user_directory/') && data.role === 'player')
  .sort((a, b) => a.data.normalizedLabel < b.data.normalizedLabel ? -1 : a.data.normalizedLabel > b.data.normalizedLabel ? 1 : a.path.localeCompare(b.path));
const asDoc = ({path, data}) => ({ id: path.split('/').pop(), data: () => data });
const domainDocuments = (uid, domain) => documents.filter(({path}) => (
  domain === 'profile' ? path === `users/${uid}` :
    ['inventory', 'spells', 'techniques'].includes(domain)
      ? path.startsWith(`users/${uid}/${domain === 'techniques' ? 'tecniche' : domain}/`)
      : path === `users/${uid}/state/${domain}`
));
const domainValue = (domain, docs) => {
  if (domain === 'profile') return normalizeUserShell(docs[0]?.data);
  if (domain === 'inventory') return docs.map((doc) => normalizeV2InventoryDocument(asDoc(doc)));
  if (domain === 'spells' || domain === 'techniques') return mapV2PersonalContentItems(docs.map((doc) => normalizeV2PersonalContentDocument(asDoc(doc))));
  return normalizeV2StateDocument(domain, docs[0]?.data);
};

// Exercise real manager and card lifecycle against the unchanged deterministic
// fixture. These are serialized document payload bytes, NOT Firestore wire bytes.
describe('Task11 deterministic Dashboard data ownership', () => {
  test.each(['first', 'populated', 'three-primary'])('%s page: 0/1/3 expansions and cleanup', async (pageName) => {
    const offset = pageName === 'first' ? 0 : directories.findIndex(({path}) => path === 'user_directory/perf-player');
    // Supplemental ownership case: existing fixture primary documents, arranged
    // into a 10-row view. It is not claimed to be a contiguous directory page.
    const primaryIds = ['perf-player', 'perf-peer-2', 'perf-peer-3'];
    const page = pageName === 'three-primary'
      ? [...primaryIds.map((uid) => directories.find(({path}) => path === `user_directory/${uid}`)), ...directories.slice(0, 7)]
      : directories.slice(offset, offset + 10);
    const items = page.map(({path, data}) => ({ id: path.split('/')[1], ...data }));
    const active = new Map();
    let receivedBytes = 0;
    let catalogReads = 0;
    let directoryReads = 0;
    const receiveDirectory = () => {
      receivedBytes += page.reduce((sum, doc) => sum + bytes(doc.data), 0);
      directoryReads += 1;
      return { items, hasMore: true, cursor: null };
    };
    getUserDirectoryPage.mockImplementation(async () => receiveDirectory());
    subscribeUserDirectoryPage.mockImplementation((observer) => {
      active.set('directory', 'directory');
      observer.next(receiveDirectory());
      return () => active.delete('directory');
    });
    subscribeManagerSummary.mockImplementation((uid, observer) => {
      const summary = buildManagerUserSummary(Object.fromEntries(['progression', 'resources', 'settings'].map((domain) => [domain, domainDocuments(uid, domain)[0]?.data])));
      active.set(`${uid}:summary`, 'summary');
      receivedBytes += bytes(summary);
      observer.next(summary);
      return () => active.delete(`${uid}:summary`);
    });
    subscribeUserDomain.mockImplementation((uid, domain, observer) => {
      const key = `${uid}:${domain}`;
      const docs = domainDocuments(uid, domain);
      active.set(key, domain);
      receivedBytes += docs.reduce((sum, doc) => sum + bytes(doc.data), 0);
      observer.next(domainValue(domain, docs));
      return () => active.delete(key);
    });
    getDocs.mockImplementation(async () => {
      catalogReads += 1;
      const catalog = documents.filter(({path}) => path.startsWith('items/'));
      receivedBytes += catalog.reduce((sum, doc) => sum + bytes(doc.data), 0);
      return { forEach: (cb) => catalog.forEach((doc) => cb(asDoc(doc))) };
    });
    onSnapshot.mockImplementation((target, next) => {
      active.set(target, 'dice');
      const rolls = documents.filter(({path}) => path.startsWith(`${target}/`)).slice(0, 20);
      receivedBytes += rolls.reduce((sum, doc) => sum + bytes(doc.data), 0);
      next({ forEach: (cb) => rolls.forEach((doc) => cb(asDoc(doc))) });
      return () => active.delete(target);
    });
    const Harness = () => {
      const state = useManagerUserData(true);
      return <PlayerInfo {...state} variant="card" />;
    };
    const view = render(<Harness />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Espandi' })).toHaveLength(10));
    const samples = [];
    const capture = (expanded) => samples.push({ expanded, active: active.size,
      domains: [...active.values()].reduce((counts, domain) => ({ ...counts, [domain]: (counts[domain] || 0) + 1 }), {}),
      serializedDocumentBytes: receivedBytes, catalogReads, directoryReads });
    capture(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Espandi' })[0]);
    await act(async () => {});
    capture(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Espandi' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Espandi' })[0]);
    await act(async () => {});
    capture(3);
    for (const button of screen.getAllByRole('button', { name: 'Comprimi' })) fireEvent.click(button);
    capture('collapsed');
    view.unmount();
    expect(active.size).toBe(0);
    console.log('TASK11_MEASUREMENT', JSON.stringify({ page: pageName, fixtureHash: buildManifest(documents).hash, samples }));
    expect(samples[0].domains.directory).toBe(1);
    expect(samples[0].active).toBe(budget.listeners[0]);
    expect(samples[1].active).toBe(budget.listeners[1]);
    expect(samples[2].active).toBe(budget.listeners[2]);
    expect(samples[3].active).toBe(budget.listeners[0]);
    expect(samples[0].catalogReads).toBe(0);
    expect(samples[0].directoryReads).toBe(1);
    expect(samples[0].serializedDocumentBytes).toBeLessThanOrEqual(budget.serializedPayloadBytes[0]);
    expect(samples[1].serializedDocumentBytes).toBeLessThanOrEqual(budget.serializedPayloadBytes[1]);
    expect(samples[2].serializedDocumentBytes).toBeLessThanOrEqual(budget.serializedPayloadBytes[2]);
    expect(samples[1].domains.dice).toBe(1);
    expect(samples[2].domains.dice).toBe(3);
    expect(samples[3].domains.dice || 0).toBe(0);
  });
});
