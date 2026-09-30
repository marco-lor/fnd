import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SpellSide from './elements/spell_side';
import TecnicheSide from './elements/tecniche_side';
import { updateResource } from '../../data/userData/userDataCommands';
import TecnicheSpell from './TecnicheSpell';
import { getCommonTechniques } from '../../data/configRepository';
import { __resetRepositoryRuntimeForTests } from '../../data/repositoryRuntime';
import { doc, getDoc, labelFirestoreTarget } from '../../performance/firestore';
import { useAuth, useAuthSession } from '../../AuthContext';
import { usePersonalSpells, usePersonalTechniques, useProgression, useResources } from '../../data/userData/userDataHooks';

jest.mock('../../components/firebaseConfig', () => ({ db: {} }));
jest.mock('../../performance/firestore', () => ({
  doc: jest.fn((_db, ...parts) => ({ path: parts.join('/') })),
  getDoc: jest.fn(), labelFirestoreTarget: jest.fn(target => target),
}));
jest.mock('../../AuthContext', () => ({ useAuth: jest.fn(), useAuthSession: jest.fn() }));
jest.mock('../../data/userData/userDataHooks', () => ({
  usePersonalSpells: jest.fn(), usePersonalTechniques: jest.fn(), useProgression: jest.fn(), useResources: jest.fn(),
}));
jest.mock('../../data/userData/userDataCommands', () => ({ updateResource: jest.fn() }));
jest.mock('./elements/personalMediaEditor', () => () => null);
const mockCommits = [];
jest.mock('../common/MediaImage', () => ({
  __esModule: true, hasMediaAsset: () => true,
  default: ({ alt, variant }) => {
    require('react').useEffect(() => { mockCommits.push(alt); });
    return <img alt={alt} data-variant={variant} />;
  },
}));
jest.mock('../common/MediaVideo', () => () => null);

// task13a-cards-v1: 100 names in reverse insertion order, fixed cost/effect/media.
const fixture = Object.fromEntries(Array.from({ length: 100 }, (_, i) => {
  const name = `Spell ${String(99 - i).padStart(3, '0')}`;
  return [name, { Nome: name, Costo: '5 PM', 'Effetti Positivi': 'Luce', Azione: 'Standard', image_url: 'fixture.jpg' }];
}));
const userData = { uid: 'hero', stats: { manaCurrent: 10, level: 1 } };
const flush = async () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  jest.clearAllMocks(); __resetRepositoryRuntimeForTests(); mockCommits.length = 0;
  doc.mockImplementation((_db, ...parts) => ({ path: parts.join('/') }));
  labelFirestoreTarget.mockImplementation(target => target);
  getDoc.mockImplementation(async target => ({ exists: () => true, data: () => target.path === 'utils/varie' ? { dadiAnimaByLevel: [null, 'd6'] } : {} }));
  useAuth.mockReturnValue({ user: { uid: 'hero' }, userData: { characterId: 'hero' } });
  useAuthSession.mockReturnValue({ repositoryAccessGeneration: 0 });
  usePersonalSpells.mockReturnValue({ data: fixture, status: 'fresh' });
  usePersonalTechniques.mockReturnValue({ data: {}, status: 'fresh' });
  useProgression.mockReturnValue({ data: { stats: { level: 1 } }, status: 'fresh' });
  useResources.mockReturnValue({ data: { stats: { manaCurrent: 10 } }, status: 'fresh' });
});

test('task13a 100-card initial, single-item update and cold/warm config work', async () => {
  const onEdit = jest.fn();
  const view = render(<SpellSide personalSpells={fixture} userData={userData} onEditPersonalSpell={onEdit} />);
  await flush();
  const initialCards = screen.getAllByRole('img').length;
  const initialCommits = mockCommits.length;
  await Promise.all(Array.from({ length: 100 }, () => getCommonTechniques()));
  const coldReads = getDoc.mock.calls.length;
  mockCommits.length = 0;
  view.rerender(<SpellSide personalSpells={{ ...fixture, 'Spell 000': { ...fixture['Spell 000'], Costo: '6 PM' } }} userData={userData} onEditPersonalSpell={onEdit} />);
  await flush();
  const oneItemCommits = mockCommits.length;
  view.unmount();
  render(<SpellSide personalSpells={fixture} userData={userData} onEditPersonalSpell={onEdit} />);
  await flush();
  await Promise.all(Array.from({ length: 100 }, () => getCommonTechniques()));
  const warmReads = getDoc.mock.calls.length - coldReads;
  console.info('TASK13A_METRICS', JSON.stringify({ fixture: 'task13a-cards-v1', initialCards, initialCommits, oneItemCommits, coldReads, warmReads }));
  expect(coldReads).toBe(2);
  expect(warmReads).toBe(0);
  expect(initialCards).toBeLessThanOrEqual(24);
  expect(oneItemCommits).toBe(1);
});

test('task13a filtering reaches every card and keeps the focused incremental control', async () => {
  render(<TecnicheSpell />); await flush();
  const input = screen.getByPlaceholderText('Cerca per nome o effetto...');
  input.focus(); fireEvent.change(input, { target: { value: 'Spell 099' } }); await flush();
  expect(input).toHaveFocus();
  expect(screen.getAllByRole('img').map(img => img.alt)).toEqual(['Spell 099']);
  fireEvent.change(input, { target: { value: '' } }); await flush();
  const more = screen.getByRole('button', { name: /Mostra altri.*Spellbook/i });
  more.focus();
  for (let i = 0; i < 4; i += 1) { fireEvent.click(more); await flush(); expect(more).toHaveFocus(); }
  expect(screen.getAllByRole('img')).toHaveLength(100);
  expect(getDoc.mock.calls.filter(([target]) => target.path === 'utils/varie')).toHaveLength(1);
  expect(getDoc.mock.calls.filter(([target]) => target.path === 'utils/tecniche_common')).toHaveLength(1);
  expect(more).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getAllByRole('img').map(img => img.alt)).toEqual(Object.keys(fixture).reverse());
});




test.each(['spell', 'tecnica'])('small %s lists preserve client insufficient mana and exact delta/retry payload', async kind => {
  const data = { Uno: { Nome: 'Uno', Costo: '5 PM' } };
  const viewFor = mana => kind === 'spell'
    ? <SpellSide personalSpells={data} userData={{ ...userData, stats: { manaCurrent: mana } }} />
    : <TecnicheSide personalTecniche={data} userData={{ ...userData, stats: { manaCurrent: mana } }} />;
  const view = render(viewFor(4)); await flush();
  expect(screen.getAllByRole('img')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /Mostra altri/ })).toBeNull();
  fireEvent.click(screen.getAllByRole('button')[0]);
  expect(screen.getByRole('button', { name: 'Conferma' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Conferma' }));
  expect(updateResource).not.toHaveBeenCalled();
  view.rerender(viewFor(6));
  fireEvent.click(screen.getByRole('button', { name: 'Conferma' })); await flush();
  expect(updateResource).toHaveBeenCalledWith({ resource: 'mana', mode: 'delta', value: -5, retryKey: `${kind === 'spell' ? 'spell' : 'tecnica'}-use:hero:Uno` });
});

test('100 techniques also mount one chunk and update only the changed card', async () => {
  const onEdit = jest.fn();
  const view = render(<TecnicheSide personalTecniche={fixture} userData={userData} onEditPersonalTecnica={onEdit} />);
  expect(screen.getAllByRole('img')).toHaveLength(24);
  expect(mockCommits).toHaveLength(24);
  mockCommits.length = 0;
  view.rerender(<TecnicheSide personalTecniche={{ ...fixture, 'Spell 000': { ...fixture['Spell 000'], Costo: '6 PM' } }} userData={userData} onEditPersonalTecnica={onEdit} />);
  expect(mockCommits).toEqual(['Spell 000']);
});
