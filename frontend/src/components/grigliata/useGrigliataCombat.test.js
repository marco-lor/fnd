import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import useGrigliataCombat from './useGrigliataCombat';
import { GrigliataCombatPanel } from './GrigliataCombatPanel';
import GrigliataCombatAim from './GrigliataCombatAim';
import GrigliataCombatDiceTray from './GrigliataCombatDice';
import * as firestore from '../../performance/firestore';
import { getCallable } from '../../data/functions/callableRegistry';
import { runWithDurableOperationIntent } from '../../data/functions/backendOperationIntentStore';

jest.mock('../common/MediaImage', () => () => null);
jest.mock('../firebaseConfig', () => ({ db: { name: 'test-db' } }));
jest.mock('../../performance/firestore', () => ({
  collection: jest.fn(),
  labelFirestoreTarget: jest.fn(),
  limit: jest.fn(),
  onSnapshot: jest.fn(),
  orderBy: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
}));
jest.mock('../../data/functions/callableRegistry', () => ({ getCallable: jest.fn() }));
jest.mock('../../data/functions/backendOperationIntentStore', () => ({ runWithDurableOperationIntent: jest.fn() }));

const uid = 'nyx-user';
const JOURNAL = 'grigliata.combat-actions.public.subscribe.v1';
const OWNED = 'grigliata.combat-actions.actor.subscribe.v1';
const SCENE = 'grigliata.combat-actions.manager.subscribe.v1';
const MANAGER_PENDING = 'grigliata.combat-actions.manager-pending.subscribe.v1';
const MANAGER_CANCELLED = 'grigliata.combat-actions.manager-cancelled.subscribe.v1';
const PENDING = 'grigliata.combat-actions.actor-pending.subscribe.v1';
const OWNER_DAMAGE = 'grigliata.combat-requests.owner-damage.subscribe.v1';
const pawn = (tokenId, col, extra) => ({ tokenId, label: tokenId, ownerUid: tokenId === 'nyx' ? uid : 'other', col, row: 0, sizeSquares: 1, ...extra });
const id = tokenId => 'map__' + tokenId;
const at = ms => ({ toMillis: () => ms });
const entry = (key, ms, status = 'done') => ({ id: key, status, actorUid: uid, createdAt: at(ms) });
const others = (count, from) => Array.from({ length: count }, (_, index) => ({ ...entry('other-' + index, from + index), actorUid: 'other' }));
const sword = { id: 'weaponMain', kind: 'weapon', mode: 'single', minTargets: 1, maxTargets: 1, rangeFt: 5 };

let listeners;
let arsenal;
let mutate;
const props = (extra) => ({ uid, backgroundId: 'map', enabled: true, open: true, isManager: false, tokens: [], ...extra });
const emit = (label, entries) => act(() => listeners.get(label).next({ docs: entries.map(({ id: key, ...data }) => ({ id: key, data: () => data })) }));
const ids = list => list.map(item => item.placementId || item.id);
const readySword = { ...sword, name: 'Spada', attackDie: true, die: 12 };
const aimSword = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Scegli bersaglio sulla mappa/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Bersaglio foe' }));
};
const renderSwordBattle = ({ weapon = readySword, mana = 5 } = {}) => {
  const tokens = [pawn('nyx', 0), pawn('foe', 1)].map((token, i) => ({
    ...token, renderPosition: { x: 100 + 40 * i, y: 100, size: 35 },
  }));
  arsenal.mockResolvedValue({ data: { actor: { placementId: id('nyx'), hp: 10, mana }, actions: [weapon] } });
  function Battle() {
    const combat = useGrigliataCombat(props({ tokens }));
    return <>
      {combat.overlay && <GrigliataCombatAim aim={combat.overlay} tokens={tokens} grid={{ cellSizePx: 35 }}
        stageSize={{ width: 400, height: 500 }} viewport={{ x: 0, y: 0, scale: 1 }} />}
      {combat.tray && <GrigliataCombatDiceTray tray={combat.tray} nextDamage={combat.nextDamage}
        resultStatus={combat.resultStatus} resultOutcomes={combat.resultOutcomes} />}
      <GrigliataCombatPanel {...combat.panel} />
    </>;
  }
  return render(<Battle />);
};
const mount = async (actions, tokens) => {
  arsenal.mockResolvedValue({ data: { actor: { placementId: id('nyx'), hp: 10, mana: 5 }, actions } });
  const view = renderHook(hookProps => useGrigliataCombat(hookProps), { initialProps: props({ tokens }) });
  await waitFor(() => expect(view.result.current.panel.actions).toHaveLength(actions.length));
  return view;
};

beforeEach(() => {
  listeners = new Map();
  arsenal = jest.fn().mockResolvedValue({ data: { actions: [] } });
  mutate = jest.fn().mockResolvedValue({ data: {} });
  getCallable.mockImplementation(name => (name === 'getGrigliataCombatArsenal' ? arsenal : mutate));
  runWithDurableOperationIntent.mockImplementation(({ invoke }) => invoke('operation-1'));
  firestore.collection.mockImplementation((_db, name) => name);
  firestore.where.mockImplementation((...filter) => filter);
  firestore.orderBy.mockImplementation((...order) => ['orderBy', ...order]);
  firestore.limit.mockImplementation(count => ['limit', count]);
  firestore.query.mockImplementation((source, ...constraints) => ({ source, constraints }));
  firestore.labelFirestoreTarget.mockImplementation((target, label) => ({ ...target, label }));
  firestore.onSnapshot.mockImplementation((target, next, error) => {
    const unsubscribe = jest.fn();
    listeners.set(target.label, { target, next, error, unsubscribe });
    return unsubscribe;
  });
});

test('other people’s traffic never displaces an own action from pending or from the journal', () => {
  const { result } = renderHook(() => useGrigliataCombat(props()));
  emit(OWNED, [entry('mine', 2), entry('tie', 3, 'retry')]);
  // Out of the own window too: only the unwindowed pending listener still holds it.
  emit(PENDING, [entry('tie', 3, 'retry'), entry('old', 1, 'waiting')]);
  emit(JOURNAL, others(41, 100));

  expect(ids(result.current.panel.pending)).toEqual(['old', 'tie']);
  expect(result.current.panel.events).toHaveLength(44);
  expect(ids(result.current.panel.events).slice(0, 2)).toEqual(['other-40', 'other-39']);
  expect(ids(result.current.panel.events).slice(-3)).toEqual(['tie', 'mine', 'old']);
});

test('an armed attack waits for the map throw before spending and shows the reply faces', async () => {
  const weapon = { ...sword, name: 'Spada', attackDie: true, die: 12 };
  const { result } = await mount([weapon], [pawn('nyx', 0), pawn('foe', 1)]);
  mutate.mockResolvedValue({ data: { combatId: 'attack', rolls: [{ sides: 12, value: 7 }] } });
  act(() => result.current.panel.onBeginTargeting(weapon));
  act(() => result.current.overlay.pickToken(id('foe')));
  act(() => result.current.panel.onPrepareLaunch(weapon, { channel: 'TPC' }));
  expect(mutate).not.toHaveBeenCalled();
  expect(result.current.tray).toMatchObject({ phase: 'ready', notation: 'd12' });
  await act(() => result.current.tray.throwDice());
  // Older clients retained exactly this intent when a paid launch lost its reply.
  expect(runWithDurableOperationIntent.mock.calls[0][0].intent).toEqual({
    command: 'launch', backgroundId: 'map', actorPlacementId: id('nyx'), kind: 'weapon',
    actionId: 'weaponMain', targetPlacementIds: [id('foe')], channel: 'TPC',
  });
  expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
    command: 'launch', operationId: 'operation-1', rollMode: 'guided',
    targetPlacementIds: [id('foe')], channel: 'TPC',
  }));
  expect(result.current.tray).toMatchObject({ phase: 'result', rolls: [{ sides: 12, value: 7 }] });
});

test.each([
  [null, '2d12'],
  [['Bersaglio dell’attacco', 'Te o un alleato da curare'], 'd12'],
])('the declared targets determine the attack pool for roles %j', async (targetRoles, notation) => {
  const action = { ...sword, id: 'multi', kind: 'spell', mode: 'multiple', minTargets: 2, maxTargets: 2,
    rangeFt: 15, allowSelf: true, targetRoles, roleRangesFt: [15, 15], attackDie: true, die: 12 };
  const { result } = await mount([action], [pawn('nyx', 0), pawn('foe', 1), pawn('ally', 2)]);
  act(() => result.current.panel.onBeginTargeting(action));
  act(() => result.current.overlay.pickToken(id('foe')));
  act(() => result.current.overlay.pickToken(id('ally')));
  expect(result.current.panel.selection.targetIds).toEqual([id('foe'), id('ally')]);
  act(() => result.current.panel.onPrepareLaunch(action, { channel: 'TPC' }));
  expect(result.current.tray.notation).toBe(notation);
  expect(mutate).not.toHaveBeenCalled();
});

test('a tied melee attack keeps its recorded advantage for the next throw', async () => {
  const { result } = await mount([sword], [pawn('nyx', 0), pawn('foe', 1)]);
  const event = { id: 'tie', actorUid: uid };
  const target = { placementId: id('foe'), name: 'foe', round: 1, advantage: true, attack: { sides: 20 } };
  act(() => result.current.panel.onRetry(event, target));
  expect(result.current.tray.notation).toBe('2d20');
  expect(mutate).not.toHaveBeenCalled();
});

test('the result strip shows an extra attack die disclosed by the server', async () => {
  mutate.mockResolvedValueOnce({ data: { combatId: 'advantage', rolls: [{ sides: 12, value: 8 }, { sides: 12, value: 3 }] } });
  renderSwordBattle();
  await aimSword();
  expect(screen.getByText('d12', { selector: '.gc-dice-head code' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Tira i dadi' }));
  expect(await screen.findByText('2d12', { selector: '.gc-dice-head code' })).toBeVisible();
});

test('clicking Spada’s map target opens the ready tray before mutation and a hit leads to its own map throw', async () => {
  mutate.mockResolvedValueOnce({ data: { combatId: 'hit', rolls: [{ sides: 12, value: 9 }] } })
    .mockResolvedValueOnce({ data: { combatId: 'hit', damage: 5, rolls: [{ sides: 4, value: 3 }, { sides: 4, value: 2 }] } });
  renderSwordBattle();
  await aimSword();
  const throwButton = screen.getByRole('button', { name: 'Tira i dadi' });
  expect(throwButton).toHaveFocus();
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.click(throwButton);
  expect(await screen.findByRole('list', { name: 'Risultati dei dadi' })).toHaveTextContent('d12 9');
  emit(PENDING, [{ ...entry('hit', 1, 'awaitingDamage'), action: readySword, targets: [{
    placementId: id('foe'), name: 'foe', status: 'done', outcome: 'hit', round: 1, pendingDamage: { round: 1, expr: '2d4' },
  }] }]);
  fireEvent.click(screen.getByRole('button', { name: 'Tiro di danno · foe' }));
  expect(mutate).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Tira i dadi' }));
  expect(await screen.findByText('5 danni proposti')).toBeVisible();
  expect(mutate).toHaveBeenLastCalledWith({ command: 'rollDamage', combatId: 'hit', targetPlacementId: id('foe'), round: 1 });
});

test.each(['Rimuovi foe', 'Spendi 2 PF'])('changing %s retires an uncertain map retry with the old declaration', async control => {
  renderSwordBattle({ weapon: { ...readySword, cost: 2 }, mana: 0 });
  await aimSword();
  expect(screen.queryByRole('button', { name: 'Tira i dadi' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Spendi 2 PF'));
  fireEvent.click(screen.getByRole('button', { name: 'Vai al tiro sulla mappa' }));
  mutate.mockRejectedValueOnce(Object.assign(new Error('link down'), { code: 'functions/unavailable' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tira i dadi' }));
  expect(await screen.findByRole('button', { name: 'Riprova il tiro' })).toBeVisible();
  const change = control === 'Spendi 2 PF' ? screen.getByLabelText(control) : screen.getByRole('button', { name: control });
  fireEvent.click(change);
  expect(screen.queryByRole('button', { name: 'Riprova il tiro' })).not.toBeInTheDocument();
  expect(mutate).toHaveBeenCalledTimes(1);
});

test('the map shows an evaded Spada and can still lead to a different action’s pending damage', async () => {
  renderSwordBattle();
  await aimSword();
  mutate.mockResolvedValueOnce({ data: { combatId: 'evaded', rolls: [{ sides: 12, value: 4 }] } });
  fireEvent.click(screen.getByRole('button', { name: 'Tira i dadi' }));
  await screen.findByRole('list', { name: 'Risultati dei dadi' });
  emit(OWNED, [{ ...entry('evaded', 2), kind: 'weapon', action: readySword,
    targets: [{ placementId: id('foe'), name: 'foe', outcome: 'resisted', status: 'done' }] }]);
  const outcomes = screen.getByRole('list', { name: 'Esiti dei bersagli' });
  expect(outcomes).toHaveTextContent('foe');
  expect(outcomes).toHaveTextContent(/evitato/i);
  emit(PENDING, [{ ...entry('other', 1, 'awaitingDamage'), kind: 'spell', action: { name: 'Singolarità' },
    targets: [{ placementId: id('foe'), name: 'foe', status: 'done', outcome: 'hit', round: 2,
      pendingDamage: { round: 2, kind: 'effect', label: 'Danno proposto', expr: 'd20' } }] }]);
  fireEvent.click(screen.getByRole('button', { name: 'Tiro di danno · foe · Singolarità' }));
  expect(screen.getByRole('region', { name: 'Singolarità · Danno contro foe' })).toBeVisible();
  expect(mutate).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Tira i dadi' }));
  expect(mutate).toHaveBeenLastCalledWith({ command: 'rollDamage', combatId: 'other', targetPlacementId: id('foe'), round: 2 });
  await screen.findByText('Azione registrata.');
});

test('a pending targetless damage after refresh is an independent round-one throw', async () => {
  const { result } = renderHook(() => useGrigliataCombat(props()));
  const event = { ...entry('spell', 1, 'awaitingDamage'), pendingDamage: { round: 1, expr: '1d100' } };
  emit(PENDING, [event]);
  expect(result.current.panel.pending).toEqual([event]);
  expect(result.current.nextDamage).toMatchObject({ label: 'Tiro di danno · Azione' });
  mutate.mockResolvedValue({ data: { damage: 100, rolls: [{ sides: 100, value: 100 }] } });
  act(() => result.current.panel.onRollDamage(event, null));
  expect(mutate).not.toHaveBeenCalled();
  expect(result.current.tray).toMatchObject({ phase: 'ready', notation: '1d100' });
  await act(() => result.current.tray.throwDice());
  expect(mutate).toHaveBeenCalledWith({
    command: 'rollDamage', combatId: 'spell', targetPlacementId: null, round: 1,
  });
  expect(result.current.tray).toMatchObject({ phase: 'result', rolls: [{ sides: 100, value: 100 }] });
});

test('the first guided critical uses the chosen score in the tray and a score edit sends directly', async () => {
  const { result } = renderHook(() => useGrigliataCombat(props()));
  const event = { ...entry('critical', 1), action: { criticalHasDice: true, criticalExpr: '2d4' } };
  const hit = { placementId: id('foe'), name: 'foe', round: 2 };
  mutate.mockResolvedValue({ data: { combatId: 'critical', rolls: [{ sides: 4, value: 2 }, { sides: 4, value: 3 }] } });
  act(() => { result.current.panel.onCritical(event, hit, 1); });
  expect(mutate).not.toHaveBeenCalled();
  expect(result.current.tray).toMatchObject({ phase: 'ready', notation: '2d4' });
  await act(() => result.current.tray.throwDice());
  expect(mutate).toHaveBeenLastCalledWith({ command: 'critical', combatId: 'critical', targetPlacementId: id('foe'), round: 2, score: 1 });
  await act(() => result.current.panel.onCritical(event, { ...hit, critical: { score: 1 } }, 2));
  expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({ score: 2 }));
  expect(result.current.tray.phase).toBe('result');
});

test('player pending is actor-scoped and manager pending covers only unresolved actions on the selected map', () => {
  const pendingQuery = {
    source: 'grigliata_combat_actions', label: PENDING,
    constraints: [['backgroundId', '==', 'map'], ['actorUid', '==', uid], ['status', 'in', ['waiting', 'retry', 'awaitingDamage', 'awaitingConfirmation']]],
  };
  const ownQuery = {
    source: 'grigliata_combat_actions', label: OWNED,
    constraints: [['backgroundId', '==', 'map'], ['actorUid', '==', uid], ['orderBy', 'updatedAt', 'desc'], ['limit', 40]],
  };
  const { unmount } = renderHook(() => useGrigliataCombat(props()));
  expect([...listeners.keys()]).toEqual([JOURNAL, OWNED, PENDING, OWNER_DAMAGE]);
  expect(listeners.get(PENDING).target).toEqual(pendingQuery);
  expect(listeners.get(OWNED).target).toEqual(ownQuery);
  expect(listeners.get(JOURNAL).target.constraints).toEqual([
    ['backgroundId', '==', 'map'], ['shared', '==', true], ['orderBy', 'createdAt', 'desc'], ['limit', 40],
  ]);
  // A player also reads the redacted outcomes on their own pawns of the actions not shared with the table.
  expect(listeners.get(OWNER_DAMAGE).target).toEqual({
    source: 'grigliata_combat_requests', label: OWNER_DAMAGE,
    constraints: [['ownerUid', '==', uid], ['backgroundId', '==', 'map'], ['orderBy', 'ownerDamageUpdatedAt', 'desc'], ['limit', 40]],
  });
  unmount();

  listeners.clear();
  renderHook(() => useGrigliataCombat(props({ isManager: true })));
  expect([...listeners.keys()]).toEqual([SCENE, OWNED, MANAGER_PENDING, MANAGER_CANCELLED]);
  expect(listeners.get(MANAGER_PENDING).target).toEqual({
    source: 'grigliata_combat_actions', label: MANAGER_PENDING,
    constraints: [['backgroundId', '==', 'map'], ['status', 'in', ['waiting', 'retry', 'awaitingDamage', 'awaitingConfirmation']]],
  });
  expect(listeners.get(OWNED).target).toEqual(ownQuery);
  expect(listeners.get(MANAGER_CANCELLED).target.constraints).toEqual([
    ['backgroundId', '==', 'map'], ['status', '==', 'cancelled'], ['orderBy', 'updatedAt', 'desc'], ['limit', 40],
  ]);
  expect(listeners.get(SCENE).target.constraints).toEqual([['backgroundId', '==', 'map'], ['orderBy', 'createdAt', 'desc'], ['limit', 40]]);
});

test('Ricarica reopens the listeners only after one has failed; a launch never does', async () => {
  const { result } = await mount([sword], [pawn('nyx', 0), pawn('foe', 1)]);
  act(() => result.current.panel.onBeginTargeting(sword));
  act(() => result.current.overlay.pickToken(id('foe')));
  await act(() => result.current.panel.onLaunch(sword, {}));
  await act(async () => result.current.reload());
  expect(arsenal).toHaveBeenCalledTimes(3);
  expect(firestore.onSnapshot).toHaveBeenCalledTimes(4);

  const failed = [...listeners.values()];
  emit(PENDING, [entry('old', 1, 'waiting')]);
  act(() => listeners.get(PENDING).error(new Error('Connessione persa.')));
  expect(result.current.panel.error).toBe('Connessione persa.');
  expect(result.current.panel.pending).toEqual([]);
  await act(async () => result.current.reload());
  expect(firestore.onSnapshot).toHaveBeenCalledTimes(8);
  failed.forEach(({ unsubscribe }) => expect(unsubscribe).toHaveBeenCalledTimes(1));
  emit(PENDING, [entry('old', 1, 'waiting')]);
  expect(result.current.panel.error).toBeUndefined();
  expect(ids(result.current.panel.pending)).toEqual(['old']);
});

test('a failed pending listener is reported like the other feeds and recovers with its next snapshot', () => {
  const { result } = renderHook(() => useGrigliataCombat(props()));
  emit(PENDING, [entry('old', 1, 'waiting')]);
  act(() => listeners.get(PENDING).error(new Error('Missing or insufficient permissions.')));
  expect(result.current.panel.error).toBe('Missing or insufficient permissions.');
  expect(result.current.panel.pending).toEqual([]);

  emit(PENDING, [entry('old', 1, 'waiting')]);
  expect(result.current.panel.error).toBeUndefined();
  expect(ids(result.current.panel.pending)).toEqual(['old']);
});

test('listeners are opened once per map and each is closed exactly once', () => {
  const { rerender, unmount } = renderHook(hookProps => useGrigliataCombat(hookProps), { initialProps: props() });
  rerender(props({ tokens: [] }));
  expect(firestore.onSnapshot).toHaveBeenCalledTimes(4);

  const first = [...listeners.values()];
  rerender(props({ backgroundId: 'cave' }));
  expect(firestore.onSnapshot).toHaveBeenCalledTimes(8);
  first.forEach(({ unsubscribe }) => expect(unsubscribe).toHaveBeenCalledTimes(1));
  expect(listeners.get(PENDING).target.constraints[0]).toEqual(['backgroundId', '==', 'cave']);
  expect(listeners.get(OWNER_DAMAGE).target.constraints[1]).toEqual(['backgroundId', '==', 'cave']);

  const second = [...listeners.values()];
  unmount();
  [...first, ...second].forEach(({ unsubscribe }) => expect(unsubscribe).toHaveBeenCalledTimes(1));
  expect(() => second.forEach(({ next }) => next({ docs: [] }))).not.toThrow();
});

test('a fallen target is decided by the map marker alone and selected targets keep their distance', async () => {
  const revive = { ...sword, id: 'rune', kind: 'spell', allowDead: true, requireDead: true };
  const tokens = [pawn('nyx', 0), pawn('downed', 1, { stats: { hpCurrent: 0 } }), pawn('marked', 0, { row: 1, isDead: true })];
  const { result, rerender } = await mount([sword, revive], tokens);

  expect(ids(result.current.panel.targets)).toEqual([id('downed')]);
  act(() => result.current.panel.onBeginTargeting(sword));
  act(() => result.current.overlay.pickToken(id('downed')));
  expect(result.current.panel.selection.targetIds).toEqual([id('downed')]);
  expect(result.current.panel.targets.find(target => target.placementId === id('downed')).distanceFt).toBe(5);

  act(() => result.current.panel.onSelectAction(revive));
  expect(ids(result.current.panel.targets)).toEqual([id('marked')]);
  rerender(props({ tokens: tokens.slice(0, 2) }));
  expect(result.current.panel.targets).toEqual([]);
});

test('ordered roles use their own range and a complete selection offers nothing more', async () => {
  const leone = {
    id: 'leone', kind: 'spell', mode: 'multiple', minTargets: 2, maxTargets: 2, rangeFt: 5, allowSelf: true,
    targetRoles: ['Bersaglio dell’attacco', 'Te o un alleato da curare'], roleRangesFt: [5, 10],
  };
  const { result } = await mount([leone], [pawn('nyx', 0), pawn('foe', 1), pawn('ally', 2), pawn('far', 5)]);

  act(() => result.current.panel.onBeginTargeting(leone));
  expect(ids(result.current.overlay.candidates)).toEqual([id('foe')]);
  act(() => result.current.overlay.pickToken(id('foe')));
  expect(ids(result.current.overlay.candidates)).toEqual([id('nyx'), id('foe'), id('ally')]);
  act(() => result.current.overlay.pickToken(id('ally')));
  expect(result.current.overlay.candidates.map(({ placementId, distanceFt }) => [placementId, distanceFt]))
    .toEqual([[id('foe'), 5], [id('ally'), 10]]);
  act(() => result.current.overlay.pickToken(id('nyx')));
  expect(result.current.panel.selection.targetIds).toEqual([id('foe'), id('ally')]);
});

test('an area preview counts fallen pawns only when the action allows them', async () => {
  const blast = { id: 'blast', kind: 'spell', mode: 'area', minTargets: 0, maxTargets: 0, rangeFt: 30, area: { shape: 'square', sideSquares: 3, anchor: 'center' } };
  const rite = { ...blast, id: 'rite', allowDead: true };
  const { result } = await mount([blast, rite], [pawn('nyx', 0), pawn('foe', 3), pawn('marked', 4, { isDead: true })]);

  act(() => result.current.panel.onBeginTargeting(blast));
  act(() => result.current.overlay.pickPoint({ col: 3, row: 0 }));
  expect(ids(result.current.panel.selection.areaTargets)).toEqual([id('foe')]);
  act(() => result.current.panel.onSelectAction(rite));
  act(() => result.current.panel.onBeginTargeting(rite));
  act(() => result.current.overlay.pickPoint({ col: 3, row: 0 }));
  expect(ids(result.current.panel.selection.areaTargets)).toEqual([id('foe'), id('marked')]);
});

test('a launch never carries a map cell kept from an action that left the repertoire', async () => {
  const step = { id: 'step', kind: 'tecnica', mode: 'point', minTargets: 0, maxTargets: 0, rangeFt: 30 };
  const { result } = await mount([step, sword], [pawn('nyx', 0), pawn('foe', 1)]);
  act(() => result.current.panel.onBeginTargeting(step));
  act(() => result.current.overlay.pickPoint({ col: 1, row: 1 }));
  expect(result.current.panel.selection.point).toEqual({ col: 1, row: 1 });

  arsenal.mockResolvedValue({ data: { actor: { placementId: id('nyx') }, actions: [sword] } });
  act(() => result.current.reload());
  await waitFor(() => expect(result.current.panel.actions).toEqual([sword]));
  expect(result.current.panel.selection.point).toBeNull();
  act(() => result.current.panel.onBeginTargeting(sword));
  act(() => result.current.overlay.pickToken(id('foe')));
  await act(() => result.current.panel.onLaunch(sword, {}));
  expect(mutate).toHaveBeenCalledWith({
    command: 'launch', rollMode: 'guided', backgroundId: 'map', actorPlacementId: id('nyx'), kind: 'weapon', actionId: 'weaponMain',
    targetPlacementIds: [id('foe')], operationId: 'operation-1',
  });
});

test('a launch pins the weapon shown, and a refused launch reloads the arsenal and keeps its error in view', async () => {
  const dagger = { ...sword, name: 'Pugnale', version: 'v1' };
  const { result } = await mount([dagger], [pawn('nyx', 0), pawn('foe', 1)]);
  act(() => result.current.panel.onBeginTargeting(dagger));
  act(() => result.current.overlay.pickToken(id('foe')));
  // The main hand was re-equipped on another device: same slot id, new definition.
  const axe = { ...sword, name: 'Ascia', version: 'v2' };
  arsenal.mockResolvedValue({ data: { actor: { placementId: id('nyx') }, actions: [axe] } });
  const changed = "L'azione è cambiata: controlla l'arsenale aggiornato.";
  mutate.mockRejectedValueOnce(Object.assign(new Error(changed), { code: 'functions/failed-precondition' }));
  await act(() => result.current.panel.onLaunch(dagger, {}));
  expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({ actionId: 'weaponMain', actionVersion: 'v1' }));

  await waitFor(() => expect(result.current.panel.actions).toEqual([axe]));
  expect(arsenal).toHaveBeenCalledTimes(2);
  expect(result.current.panel.error).toBe(changed);
  expect(result.current.panel.selection).toMatchObject({ actionId: 'weaponMain', actionKind: 'weapon', targetIds: [id('foe')] });
  await act(() => result.current.panel.onLaunch(axe, {}));
  expect(mutate).toHaveBeenLastCalledWith(expect.objectContaining({ actionId: 'weaponMain', actionVersion: 'v2', targetPlacementIds: [id('foe')] }));
  expect(result.current.panel.error).toBeUndefined();
});

test('a launch that completes while the next action is drafted leaves that draft alone', async () => {
  const bolt = { id: 'bolt', kind: 'spell', mode: 'single', minTargets: 1, maxTargets: 1, rangeFt: 30 };
  const { result } = await mount([sword, bolt], [pawn('nyx', 0), pawn('foe', 1), pawn('ally', 2)]);
  act(() => result.current.panel.onBeginTargeting(sword));
  act(() => result.current.overlay.pickToken(id('foe')));
  let answer;
  mutate.mockReturnValueOnce(new Promise(resolve => { answer = resolve; }));
  let launch;
  act(() => { launch = result.current.panel.onLaunch(sword, {}); });

  act(() => result.current.panel.onBeginTargeting(bolt));
  act(() => result.current.overlay.pickToken(id('ally')));
  await act(async () => {
    answer({ data: {} });
    await launch;
  });
  await waitFor(() => expect(arsenal).toHaveBeenCalledTimes(2));
  expect(result.current.panel.selection).toMatchObject({ actionId: 'bolt', actionKind: 'spell', targetIds: [id('ally')], picking: false });
});

test('an action that left the repertoire gives way for good: equipping its item again brings back neither it nor its targets', async () => {
  const bolt = { id: 'bolt', kind: 'spell', mode: 'single', minTargets: 1, maxTargets: 1, rangeFt: 30 };
  const rift = { ...bolt, id: 'item:weaponMain:fenditura', sourceItem: 'Clessidra' };
  const { result } = await mount([sword, bolt, rift], [pawn('nyx', 0), pawn('foe', 1)]);
  act(() => result.current.panel.onBeginTargeting(rift));
  act(() => result.current.overlay.pickToken(id('foe')));
  const reloadWith = async (actions) => {
    arsenal.mockResolvedValue({ data: { actor: { placementId: id('nyx') }, actions } });
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.panel.actions).toEqual(actions));
  };

  await reloadWith([sword, bolt]);
  expect(result.current.panel.selection).toMatchObject({ actionId: 'bolt', actionKind: 'spell', targetIds: [] });
  await reloadWith([sword, bolt, rift]);
  expect(result.current.panel.selection).toMatchObject({ actionId: 'bolt', actionKind: 'spell', targetIds: [], point: null, picking: false });
});

test('coming back to the window after unequipping an item elsewhere reloads the arsenal and clears its spell', async () => {
  const bolt = { id: 'bolt', kind: 'spell', mode: 'single', minTargets: 1, maxTargets: 1, rangeFt: 30 };
  const grab = { ...bolt, id: 'item:weaponOff:afferra', sourceItem: 'Catena del Predatore' };
  const { result, unmount } = await mount([sword, grab, bolt], [pawn('nyx', 0), pawn('foe', 1)]);
  act(() => result.current.panel.onBeginTargeting(grab));
  act(() => result.current.overlay.pickToken(id('foe')));
  expect(result.current.panel.selection).toMatchObject({ actionId: grab.id, targetIds: [id('foe')] });

  // The item is unequipped in another tab; nothing reloads until the player comes back.
  let resolveReload;
  arsenal.mockReturnValue(new Promise(resolve => { resolveReload = resolve; }));
  const calls = arsenal.mock.calls.length;
  act(() => { window.dispatchEvent(new Event('focus')); });
  // Until the reload answers, the stale repertoire cannot be launched.
  expect(result.current.panel.arsenalSync).toBe('reloading');
  await act(async () => resolveReload({ data: { actor: { placementId: id('nyx') }, actions: [sword, bolt] } }));
  await waitFor(() => expect(result.current.panel.actions).toEqual([sword, bolt]));
  expect(result.current.panel.arsenalSync).toBe('ready');
  expect(arsenal.mock.calls.length).toBe(calls + 1);
  expect(result.current.panel.selection).toMatchObject({ actionId: 'bolt', actionKind: 'spell', targetIds: [] });

  unmount();
  window.dispatchEvent(new Event('focus'));
  expect(arsenal.mock.calls.length).toBe(calls + 1);
});

test('a reopened panel or a failed reload never launches on the arsenal it still shows', async () => {
  const { result, rerender } = await mount([sword], [pawn('nyx', 0), pawn('foe', 1)]);
  expect(result.current.panel.arsenalSync).toBe('ready');

  // Reopening the panel fetches again; until then the cached arsenal is not launchable.
  let resolveReload;
  arsenal.mockReturnValue(new Promise(resolve => { resolveReload = resolve; }));
  rerender(props({ tokens: [pawn('nyx', 0), pawn('foe', 1)], open: false }));
  rerender(props({ tokens: [pawn('nyx', 0), pawn('foe', 1)] }));
  expect(result.current.panel.arsenalSync).toBe('reloading');
  await act(async () => resolveReload({ data: { actor: { placementId: id('nyx') }, actions: [sword] } }));
  await waitFor(() => expect(result.current.panel.arsenalSync).toBe('ready'));

  // A reload that fails keeps the arsenal on screen but not launchable, until a reload succeeds.
  arsenal.mockRejectedValue(new Error('Connessione interrotta.'));
  act(() => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(result.current.panel.arsenalSync).toBe('failed'));
  expect(result.current.panel.actions).toEqual([sword]);
  arsenal.mockResolvedValue({ data: { actor: { placementId: id('nyx') }, actions: [sword] } });
  act(() => result.current.reload());
  await waitFor(() => expect(result.current.panel.arsenalSync).toBe('ready'));
});

function Harness({ onView, showPanel = true, ...hookProps }) {
  const view = useGrigliataCombat(hookProps);
  onView(view);
  return showPanel ? <GrigliataCombatPanel {...view.panel} /> : null;
}
const nyx = { placementId: id('nyx'), name: 'Nyx', hp: 10, mana: 5 };
const show = async (actions, tokens) => {
  const current = {};
  arsenal.mockResolvedValue({ data: { actor: nyx, actions } });
  render(<Harness {...props({ tokens })} onView={view => { current.view = view; }} />);
  await waitFor(() => expect(current.view.panel.actions).toHaveLength(actions.length));
  return current;
};
const statusCards = () => screen.queryAllByRole('region', { name: 'Stato dell’azione' });

test('an own attack answered late keeps its journal entry and critical, and becomes the pawn’s latest result', async () => {
  const strike = { ...sword, name: 'Spada', hands: 1 };
  const current = await show([strike], [pawn('nyx', 0)]);
  const bro = { placementId: id('bro'), name: 'bro' };
  const launched = (key, ms, extra) => ({ ...entry(key, ms), actor: nyx, kind: 'weapon', action: strike, ...extra });
  const old = launched('old', 1, { status: 'waiting', targets: [{ ...bro, status: 'waiting', round: 1 }] });
  const quick = launched('quick', 5, { resolvedAt: at(6), targets: [{ ...bro, status: 'done', outcome: 'resisted', round: 1 }] });
  emit(JOURNAL, others(41, 100));
  emit(OWNED, [quick, old]);
  emit(PENDING, [old]);
  expect(statusCards().map(card => card.textContent)).toEqual([expect.stringContaining('In attesa'), expect.stringContaining('Colpo evitato')]);

  const answered = { ...old, status: 'done', resolvedAt: at(200), targets: [{ ...bro, status: 'done', outcome: 'hit', damage: 7, round: 1 }] };
  emit(OWNED, [quick, answered]);
  emit(PENDING, []);
  expect(statusCards().map(card => card.textContent)).toEqual([expect.stringContaining('Colpo a segno · 7 danni proposti')]);
  expect(ids(current.view.panel.events)).toContain('old');
  expect(screen.getByText('Colpo a segno · 7 danni proposti', { selector: '.gc-log-caption span' })).toBeInTheDocument();
  // The only hit in the journal: its entry carries the critical control.
  expect(screen.getByText('Critico da tabella')).toBeInTheDocument();
});

test('a stale pending copy never masks a resolved hit: the newest copy of each action wins', async () => {
  const strike = { ...sword, name: 'Spada', hands: 1 };
  const current = await show([strike], [pawn('nyx', 0)]);
  const bro = { placementId: id('bro'), name: 'bro' };
  const waiting = {
    ...entry('blow', 1, 'waiting'), actor: nyx, kind: 'weapon', action: strike, updatedAt: at(10),
    targets: [{ ...bro, status: 'waiting', round: 1 }],
  };
  const hit = { ...waiting, status: 'done', resolvedAt: at(20), updatedAt: at(20), targets: [{ ...bro, status: 'done', outcome: 'hit', damage: 7, round: 1 }] };
  emit(OWNED, [hit]);
  emit(PENDING, [waiting]);
  expect(current.view.panel.pending).toEqual([]);
  expect(current.view.panel.events).toEqual([hit]);
  expect(statusCards().map(card => card.textContent)).toEqual([expect.stringContaining('Colpo a segno · 7 danni proposti')]);
  expect(screen.getByText('Critico da tabella')).toBeInTheDocument();

  // A server timestamp not committed yet reads null: that copy is the newest.
  emit(PENDING, [{ ...waiting, updatedAt: null }]);
  expect(ids(current.view.panel.pending)).toEqual(['blow']);
});

// Delivers to every open listener what Firestore returns for its query over these documents (equality, `in`, orderBy, limit).
const serve = documents => listeners.forEach(({ target, next }) => {
  let docs = documents;
  for (const [head, ...rest] of target.constraints) {
    if (head === 'orderBy') docs = [...docs].sort((a, b) => (b[rest[0]].toMillis() - a[rest[0]].toMillis()) * (rest[1] === 'desc' ? 1 : -1));
    else if (head === 'limit') docs = docs.slice(0, rest[0]);
    else docs = docs.filter(doc => (rest[0] === 'in' ? rest[1].includes(doc[head]) : doc[head] === rest[1]));
  }
  act(() => next({ docs: docs.map(({ id: key, ...data }) => ({ id: key, data: () => data })) }));
});

test.each(['awaitingDamage', 'waiting', 'retry'])('the DM can roll older player damage from Registro when the event is %s', async status => {
  const current = {};
  render(<Harness {...props({ isManager: true })} onView={view => { current.view = view; }} />);
  const hit = { placementId: id('bro'), name: 'Bro', status: 'done', outcome: 'hit', round: 2,
    pendingDamage: { round: 2, kind: 'effect', expr: '1d4' } };
  const playerAction = {
    ...entry('old-player', 1, status), actorUid: 'absent-player', shared: false, backgroundId: 'map',
    actor: { placementId: id('absent'), name: 'Assente' }, kind: 'spell', action: { name: 'Singolarità' }, updatedAt: at(3),
    targets: status === 'awaitingDamage' ? [hit] : [hit, { placementId: id('lia'), name: 'Lia', status, round: 1 }],
  };
  const otherMap = { ...playerAction, id: 'other-map', backgroundId: 'cave', action: { name: 'Fuori scena' } };
  const own = { ...entry('dm-action', 2, 'waiting'), backgroundId: 'map', actor: nyx, action: { name: 'Azione del master' }, updatedAt: at(2) };
  serve([playerAction, otherMap, own, ...others(40, 100).map(event => ({ ...event, backgroundId: 'map' }))]);

  expect(ids(current.view.panel.events)).toContain('old-player');
  expect(ids(current.view.panel.events)).not.toContain('other-map');
  expect(ids(current.view.panel.pending)).toEqual(['dm-action']);
  expect(statusCards().map(card => card.textContent)).toEqual([expect.stringContaining('Azione del master')]);
  fireEvent.click(screen.getByText('Registro'));
  fireEvent.click(screen.getByText('Singolarità'));
  fireEvent.click(screen.getByRole('button', { name: 'Danno contro Bro · vai al tiro sulla mappa' }));
  expect(current.view.tray).toMatchObject({ phase: 'ready', title: 'Singolarità · Danno contro Bro' });
  expect(mutate).not.toHaveBeenCalled();
  await act(() => current.view.tray.throwDice());
  expect(mutate).toHaveBeenCalledWith({ command: 'rollDamage', combatId: 'old-player', targetPlacementId: id('bro'), round: 2 });
});

test('an own action answered after 40 newer own launches stays in the journal and is the pawn’s latest result', async () => {
  const strike = { ...sword, name: 'Spada', hands: 1 };
  const current = await show([strike], [pawn('nyx', 0)]);
  const bro = { placementId: id('bro'), name: 'bro' };
  const launched = (key, ms, extra) => ({
    ...entry(key, ms), backgroundId: 'map', shared: true, actor: nyx, kind: 'weapon', action: strike, updatedAt: at(ms), ...extra,
  });
  const newer = Array.from({ length: 40 }, (_, index) => launched('newer-' + index, 10 + index, {
    resolvedAt: at(10 + index), targets: [{ ...bro, status: 'done', outcome: 'resisted', round: 1 }],
  }));
  const old = launched('old', 1, { status: 'waiting', targets: [{ ...bro, status: 'waiting', round: 1 }] });
  serve([old, ...newer]);
  expect(ids(current.view.panel.pending)).toEqual(['old']);

  const answered = { ...old, status: 'done', resolvedAt: at(500), updatedAt: at(500), targets: [{ ...bro, status: 'done', outcome: 'hit', damage: 7, round: 1 }] };
  serve([answered, ...newer]);
  expect(current.view.panel.pending).toEqual([]);
  // The journal still lists it last, in launch order, and the status card shows its answer.
  expect(ids(current.view.panel.events)).toHaveLength(41);
  expect(ids(current.view.panel.events).slice(-2)).toEqual(['newer-0', 'old']);
  expect(statusCards().map(card => card.textContent)).toEqual([expect.stringContaining('Colpo a segno · 7 danni proposti')]);
});

test('the DM may apply damage to every target and a player only to their own, nobody in the narration overlay or the player preview', () => {
  const event = { id: 'blow' };
  const mine = { placementId: id('nyx'), ownerUid: uid };
  const theirs = { placementId: id('bro'), ownerUid: 'other' };
  const allowed = panel => [mine, theirs].map(target => panel.canApplyDamage(event, target));
  const { result, rerender } = renderHook(hookProps => useGrigliataCombat(hookProps), { initialProps: props() });
  expect(result.current.panel.onApplyDamage).toEqual(expect.any(Function));
  expect(allowed(result.current.panel)).toEqual([true, false]);
  // The Registro holds a player to the proposed minimum and shows defense audits only to the DM.
  expect(result.current.panel.isManager).toBe(false);
  rerender(props({ suspended: true }));
  expect(result.current.panel.onApplyDamage).toBeUndefined();
  expect(allowed(result.current.panel)).toEqual([false, false]);
  rerender(props({ isManager: true, suspended: true }));
  expect(result.current.panel.onApplyDamage).toBeUndefined();
  expect(allowed(result.current.panel)).toEqual([false, false]);
  expect(result.current.panel.isManager).toBe(false);
  rerender(props({ isManager: true }));
  expect(result.current.panel.onApplyDamage).toEqual(expect.any(Function));
  expect(allowed(result.current.panel)).toEqual([true, true]);
  expect(result.current.panel.isManager).toBe(true);
});

test('the DM applies damage once, retaining a submitted amount and its error across a closed panel', async () => {
  const current = {};
  const tokens = [pawn('bro', 1)];
  const view = (open = true) => <Harness {...props({ isManager: true, tokens, open })} showPanel={open} onView={value => { current.view = value; }} />;
  const { rerender } = render(view());
  const strike = { ...sword, name: 'Spada', hands: 1 };
  const bro = { placementId: id('bro'), name: 'bro', ownerUid: 'other' };
  const critical = { score: 13, multiplier: 'x1', effect: 'Attacco furtivo', total: 10, roll: 3, bonus: 0, reduction: 1, tableRoll: '' };
  const blow = {
    ...entry('blow', 1), actorUid: 'other', actor: { placementId: id('orc'), name: 'Orco' }, kind: 'weapon', action: strike,
    updatedAt: at(10), resolvedAt: at(10), targets: [{ ...bro, status: 'done', outcome: 'hit', round: 1, damage: 7, critical }],
  };
  const openLog = () => {
    emit(SCENE, [blow]);
    fireEvent.click(screen.getByText('Registro'));
    fireEvent.click(screen.getByText('Spada', { selector: '.gc-log-caption strong' }));
  };
  openLog();
  const form = () => screen.queryByRole('form', { name: 'Applica danno a bro' });
  const field = () => within(form()).getByLabelText('Danno finale');
  const apply = () => within(form()).getByRole('button', { name: 'Applica danno' });
  expect(field()).toHaveValue('10');
  fireEvent.change(field(), { target: { value: '12' } });

  let refuse;
  mutate.mockReturnValueOnce(new Promise((_, reject) => { refuse = reject; }));
  const button = apply();
  fireEvent.click(button);
  fireEvent.click(button);
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(mutate).toHaveBeenCalledWith({ command: 'applyDamage', combatId: 'blow', targetPlacementId: id('bro'), amount: 12, criticalScore: 13 });
  expect(button).toHaveTextContent('Applicazione…');
  rerender(view(false));
  rerender(view());
  openLog();
  expect(field()).toHaveValue('12');
  expect(field()).toHaveAttribute('readonly');

  const stale = Object.assign(new Error('Il critico è cambiato: controlla il danno.'), { code: 'functions/failed-precondition' });
  await act(async () => refuse(stale));
  expect(within(form()).getByRole('alert')).toHaveTextContent('Il critico è cambiato: controlla il danno.');
  expect(field()).toHaveValue('12');
  expect(current.view.panel.error).toBeUndefined();
  expect(current.view.panel.busy).toBe(false);
  expect(screen.getAllByRole('alert')).toHaveLength(1);

  // The retry is recorded: the server's amount is shown at once, and a stale copy of the action never brings the form back.
  fireEvent.change(field(), { target: { value: '0' } });
  mutate.mockResolvedValueOnce({ data: { combatId: 'blow', damageApplied: { amount: 0 } } });
  fireEvent.click(apply());
  expect(mutate).toHaveBeenLastCalledWith({ command: 'applyDamage', combatId: 'blow', targetPlacementId: id('bro'), amount: 0, criticalScore: 13 });
  expect(await screen.findByText('Danno applicato · 0')).toBeInTheDocument();
  expect(form()).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  emit(SCENE, [blow]);
  expect(form()).not.toBeInTheDocument();
  emit(SCENE, [{ ...blow, updatedAt: at(20), targets: [{ ...blow.targets[0], damageApplied: { amount: 0 } }] }]);
  expect(screen.getByText('Danno applicato · 0')).toBeInTheDocument();
  expect(mutate).toHaveBeenCalledTimes(2);
});

test('damage waits for its critical calculation and is unavailable when the target leaves the board', async () => {
  const tokens = [pawn('bro', 1)];
  const { result, rerender } = renderHook(hookProps => useGrigliataCombat(hookProps), {
    initialProps: props({ tokens, isManager: true }),
  });
  const event = { id: 'blow', actorUid: uid };
  const target = { placementId: id('bro'), ownerUid: 'other', round: 1 };
  let confirm;
  mutate.mockReturnValueOnce(new Promise(resolve => { confirm = resolve; }));
  act(() => {
    const { onCritical, onApplyDamage } = result.current.panel;
    onCritical(event, target, 13);
    onApplyDamage(event, target, 7);
  });
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ command: 'critical', score: 13 }));
  expect(result.current.panel.damageState(event, target)).toMatchObject({ criticalPending: true });
  await act(async () => confirm({ data: { critical: { score: 13 } } }));
  rerender(props({ tokens: [], isManager: true }));
  expect(result.current.panel.damageState(event, target)).toMatchObject({ unavailable: true });
  act(() => { result.current.panel.onApplyDamage(event, target, 7); });
  expect(mutate).toHaveBeenCalledTimes(1);
});

test('the panel and the aim follow one selection when the chosen spell leaves the repertoire', async () => {
  const bolt = { id: 'bolt', kind: 'spell', name: 'Dardo', mode: 'single', minTargets: 1, maxTargets: 1, rangeFt: 30, cost: 1 };
  const rift = { ...bolt, id: 'item:weaponMain:fenditura', name: 'Fenditura Temporale', sourceItem: 'Clessidra', cost: 0 };
  const current = await show([sword, bolt, rift], [pawn('nyx', 0), pawn('foe', 1)]);
  fireEvent.click(screen.getByRole('button', { name: 'Spell' }));
  fireEvent.click(screen.getByRole('button', { name: /Fenditura Temporale/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Scegli bersaglio sulla mappa' }));
  act(() => current.view.overlay.pickToken(id('foe')));
  expect(current.view.panel.selection).toMatchObject({ actionId: rift.id, actionKind: 'spell', targetIds: [id('foe')] });

  // The item is unequipped: the spell tab stays, its first spell is selected with an empty pick, and aiming uses it.
  arsenal.mockResolvedValue({ data: { actor: nyx, actions: [sword, bolt] } });
  act(() => current.view.reload());
  await waitFor(() => expect(current.view.panel.actions).toHaveLength(2));
  expect(current.view.panel.selection).toMatchObject({ actionId: 'bolt', actionKind: 'spell', targetIds: [], picking: false });
  expect(screen.getByRole('button', { name: 'Spell' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: /Dardo/ })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Scegli bersaglio sulla mappa' }));
  expect(current.view.overlay.action).toBe(bolt);
  expect(current.view.panel.selection).toMatchObject({ actionId: 'bolt', actionKind: 'spell', picking: true });

  act(() => current.view.overlay.finish());
  arsenal.mockResolvedValue({ data: { actor: nyx, actions: [sword] } });
  act(() => current.view.reload());
  await waitFor(() => expect(current.view.panel.actions).toHaveLength(1));
  expect(screen.getByText('Nessuno spell appreso.')).toBeInTheDocument();
  expect(current.view.overlay).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Armi' }));
  expect(current.view.panel.selection).toMatchObject({ actionId: 'weaponMain', actionKind: 'weapon' });
});

const blade = { ...sword, name: 'Spada', hands: 1 };
const openEntry = caption => {
  fireEvent.click(screen.getByText('Registro'));
  fireEvent.click(screen.getByText(caption, { selector: '.gc-log-caption strong' }));
};
const damageForms = () => screen.queryAllByRole('form', { name: /^Applica danno a / });
const playerView = (extra) => {
  const current = {};
  const view = render(<Harness {...props(extra)} onView={value => { current.view = value; }} />);
  return { current, ...view };
};
// One shared action that landed on a pawn of this player and on someone else's.
const mixedVolley = () => ({
  id: 'volley', actorUid: 'orc-user', actor: { placementId: id('orc'), name: 'Orco' }, kind: 'weapon', action: blade, status: 'done',
  shared: true, createdAt: at(1), updatedAt: at(1), resolvedAt: at(1),
  targets: [
    { placementId: id('bro'), name: 'bro', ownerUid: 'other', status: 'done', outcome: 'hit', round: 1, damage: 5 },
    { placementId: id('lia'), name: 'Lia', ownerUid: uid, status: 'done', outcome: 'hit', round: 1, damage: 7 },
  ],
});

test('a player applies damage only to their own pawn within one action, also when the board hides it', async () => {
  // Lia is out of sight in the fog: her absence from the board proves nothing, the server checks the live pawn.
  const { current } = playerView({ tokens: [pawn('bro', 1)] });
  const volley = mixedVolley();
  emit(JOURNAL, [volley]);
  openEntry('Spada');
  expect(damageForms()).toHaveLength(1);
  const form = screen.getByRole('form', { name: 'Applica danno a Lia' });
  expect(screen.queryByText('Bersaglio non più sulla mappa.')).not.toBeInTheDocument();

  const field = within(form).getByLabelText('Danno finale');
  expect(field).toHaveValue('7');
  // The proposal is the player's minimum: less is refused in place, more is sent.
  fireEvent.change(field, { target: { value: '6' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Applica danno' }));
  expect(within(form).getByRole('alert')).toHaveTextContent('Il danno non può essere inferiore a 7: solo il DM può ridurlo.');
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: '9' } });
  mutate.mockResolvedValueOnce({ data: { combatId: 'volley', damageApplied: { amount: 9 } } });
  fireEvent.click(within(form).getByRole('button', { name: 'Applica danno' }));
  expect(mutate).toHaveBeenCalledWith({ command: 'applyDamage', combatId: 'volley', targetPlacementId: id('lia'), amount: 9, criticalScore: null });
  expect(await screen.findByText('Danno applicato · 9')).toBeInTheDocument();
  expect(damageForms()).toHaveLength(0);

  // The other side is refused in the command itself too, not only by the missing form.
  act(() => { current.view.panel.onApplyDamage(volley, volley.targets[0], 5); });
  expect(mutate).toHaveBeenCalledTimes(1);
});

test('a player’s pawn shown on the board under another owner is no longer theirs to damage', () => {
  playerView({ tokens: [pawn('bro', 1), pawn('lia', 2)] });
  emit(JOURNAL, [mixedVolley()]);
  openEntry('Spada');
  expect(damageForms()).toHaveLength(0);
  expect(screen.getByText('Bersaglio non più sulla mappa.')).toBeInTheDocument();
});

test('a player who owns none of the targets gets no command and no hint, and the DM still gets every target', () => {
  const { unmount } = playerView({ uid: 'outsider', tokens: [pawn('bro', 1)] });
  emit(JOURNAL, [mixedVolley()]);
  openEntry('Spada');
  expect(damageForms()).toHaveLength(0);
  expect(screen.queryByText('Bersaglio non più sulla mappa.')).not.toBeInTheDocument();
  unmount();

  playerView({ uid: 'dm-user', isManager: true, tokens: [pawn('bro', 1), pawn('lia', 2, { ownerUid: uid })] });
  emit(SCENE, [mixedVolley()]);
  openEntry('Spada');
  expect(damageForms().map(form => form.getAttribute('aria-label'))).toEqual(['Applica danno a bro', 'Applica danno a Lia']);
});

test('a lost reply asks for a retry in plain words, and the retry is sent as it was', async () => {
  playerView({ tokens: [] });
  emit(JOURNAL, [mixedVolley()]);
  openEntry('Spada');
  const form = screen.getByRole('form', { name: 'Applica danno a Lia' });
  mutate.mockRejectedValueOnce(Object.assign(new Error('internal'), { code: 'functions/internal' }));
  fireEvent.click(within(form).getByRole('button', { name: 'Applica danno' }));
  expect(await within(form).findByRole('alert'))
    .toHaveTextContent('Conferma non ricevuta. Riprova: un danno già registrato non viene applicato due volte.');
  // The server keeps the first application: a retry gets the recorded amount back.
  mutate.mockResolvedValueOnce({ data: { combatId: 'volley', damageApplied: { amount: 7 } } });
  fireEvent.click(within(form).getByRole('button', { name: 'Applica danno' }));
  expect(mutate).toHaveBeenCalledTimes(2);
  expect(mutate).toHaveBeenLastCalledWith({ command: 'applyDamage', combatId: 'volley', targetPlacementId: id('lia'), amount: 7, criticalScore: null });
  expect(await screen.findByText('Danno applicato · 7')).toBeInTheDocument();
});

const critical = { score: 13, multiplier: 'x1', effect: 'Attacco furtivo', total: 10, roll: 3, bonus: 0, reduction: 1, tableRoll: '' };
// The server's redacted copy of one outcome on one of the player's pawns, with fields the journal must never show.
const ownerCopy = (combatId, tokenId, name, target, ms, extra) => ({
  id: combatId + '__' + id(tokenId), ownerUid: uid, backgroundId: 'map', combatId, ownerDamageUpdatedAt: at(ms),
  status: 'done', actor: { name: 'Orco' }, attack: { label: 'Mira', total: 15 }, defense: { kind: 'dodge' },
  ownerDamage: {
    kind: 'weapon', action: { name: 'Pugnale', hands: 1, id: 'weaponMain', description: 'Nascosto' },
    target: { placementId: id(tokenId), name, ownerUid: uid, status: 'done', round: 1, attack: { total: 15 }, ...target },
  },
  ...extra,
});

test('a player reads one private entry per action with only their pawns, applies its damage with the critical, and sees the receipt', async () => {
  const { current } = playerView({ tokens: [pawn('bro', 1)] });
  emit(OWNER_DAMAGE, [
    ownerCopy('ambush', 'lia', 'Lia', { outcome: 'hit', damage: 7, critical }, 20, { createdAt: at(3) }),
    ownerCopy('ambush', 'nyx', 'Nyx', { outcome: 'resisted', damage: null }, 10, { createdAt: at(3) }),
  ]);
  expect(current.view.panel.events).toEqual([{
    id: 'ambush', ownerPrivate: true, status: 'done', kind: 'weapon', actor: { name: 'Attaccante nascosto' },
    action: { name: 'Pugnale', hands: 1 }, createdAt: expect.anything(), updatedAt: expect.anything(),
    targets: [
      { placementId: id('lia'), name: 'Lia', ownerUid: uid, status: 'done', round: 1, outcome: 'hit', damage: 7, critical, damageApplied: undefined, updatedAt: expect.anything() },
      { placementId: id('nyx'), name: 'Nyx', ownerUid: uid, status: 'done', round: 1, outcome: 'resisted', damage: null, critical: undefined, damageApplied: undefined, updatedAt: expect.anything() },
    ],
  }]);
  expect(current.view.panel.events[0].createdAt.toMillis()).toBe(3);

  openEntry('Pugnale');
  expect(screen.getByText(/^Attaccante nascosto/, { selector: '.gc-log-caption small' })).toHaveTextContent('Attaccante nascostoLia e Nyx');
  expect(screen.getByText('Riepilogo privato: solo l’esito sulle tue pedine.')).toBeInTheDocument();
  expect(screen.queryByText(/Orco/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Mira/)).not.toBeInTheDocument();
  expect(screen.getByText('13 · x1')).toBeInTheDocument();
  // The critical belongs to the attacker: the defender only reads it.
  expect(screen.queryByText('Critico da tabella')).not.toBeInTheDocument();
  expect(damageForms()).toHaveLength(1);
  const form = screen.getByRole('form', { name: 'Applica danno a Lia' });
  expect(within(form).getByLabelText('Danno finale')).toHaveValue('10');

  mutate.mockResolvedValueOnce({ data: { combatId: 'ambush', damageApplied: { amount: 10 } } });
  fireEvent.click(within(form).getByRole('button', { name: 'Applica danno' }));
  expect(mutate).toHaveBeenCalledWith({ command: 'applyDamage', combatId: 'ambush', targetPlacementId: id('lia'), amount: 10, criticalScore: 13 });
  expect(await screen.findByText('Danno applicato · 10')).toBeInTheDocument();

  // Applied elsewhere first (the DM): the recorded amount wins and the form never comes back.
  emit(OWNER_DAMAGE, [ownerCopy('ambush', 'lia', 'Lia', { outcome: 'hit', damage: 7, critical, damageApplied: { amount: 8 } }, 30)]);
  expect(screen.getByText('Danno applicato · 8')).toBeInTheDocument();
  expect(damageForms()).toHaveLength(0);
});

test('the owner receipt survives an older full snapshot arriving after it', () => {
  const { current } = playerView({ tokens: [] });
  const full = mixedVolley();
  emit(OWNER_DAMAGE, [ownerCopy(full.id, 'lia', 'Lia', {
    outcome: 'hit', damage: 7, critical, damageApplied: { amount: 11 },
  }, 20)]);
  fireEvent.click(screen.getByText('Registro'));
  fireEvent.click(screen.getByText('Pugnale', { selector: '.gc-log-caption strong' }));
  expect(screen.getByText('Danno applicato · 11')).toBeVisible();
  emit(JOURNAL, [full]);

  expect(screen.getByText('Danno applicato · 11')).toBeVisible();
  expect(damageForms()).toHaveLength(0);
  const [merged] = current.view.panel.events;
  expect(merged.actor).toEqual(full.actor);
  expect(merged.targets[0]).toEqual(full.targets[0]);
  expect(merged.targets[1]).toMatchObject({ critical, damageApplied: { amount: 11 } });
});

test('the attacker confirms cancellation from the status card, sees the result and reloads the arsenal', async () => {
  await show([sword], [pawn('nyx', 0)]);
  const event = { ...entry('mine', 2, 'awaitingConfirmation'), actor: nyx, action: { name: 'Spada' } };
  emit(PENDING, [event]);
  const card = statusCards()[0];
  expect(within(card).getByRole('status')).toHaveTextContent('In attesa della conferma del danno');
  fireEvent.click(within(card).getByRole('button', { name: /^Annulla tiro/ }));
  expect(within(card).getByRole('button', { name: 'Mantieni il tiro' })).toHaveFocus();
  expect(mutate).not.toHaveBeenCalled();
  fireEvent.click(within(card).getByRole('button', { name: 'Mantieni il tiro' }));
  expect(within(card).getByRole('button', { name: /^Annulla tiro/ })).toHaveFocus();
  fireEvent.click(within(card).getByRole('button', { name: /^Annulla tiro/ }));
  mutate.mockResolvedValueOnce({ data: { combatId: event.id, status: 'cancelled', cancellation: { needsReview: true } } });
  fireEvent.click(within(card).getByRole('button', { name: /^Conferma annullamento/ }));
  await waitFor(() => expect(statusCards()[0]).toHaveTextContent('Annullata'));
  expect(mutate).toHaveBeenCalledWith({ command: 'cancel', combatId: event.id });
  expect(arsenal).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('Effetti da verificare al tavolo.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Annulla tiro/ })).not.toBeInTheDocument();
});

test('only the newest confirmation takes a quick card, and the DM can cancel an older player event from Registro', async () => {
  const { current } = playerView({ isManager: true });
  const make = (key, time, status, actorUid = uid) => ({
    ...entry(key, time, status), backgroundId: 'map', updatedAt: at(time), actorUid, action: { name: key },
  });
  const older = make('Tiro precedente', 1, 'awaitingConfirmation');
  const latest = { ...make('Tiro nuovo', 80, 'awaitingConfirmation'), updatedAt: at(90) };
  const laterLaunch = make('Tiro lanciato dopo', 83, 'awaitingConfirmation');
  const player = make('Tiro di Orco', 2, 'awaitingConfirmation', 'orc-user');
  serve([older, latest, laterLaunch, player, make('Difesa in corso', 4, 'waiting'), ...Array.from({ length: 42 }, (_, i) => (
    make('Già risolta ' + i, 10 + i, 'done', 'orc-user')
  ))]);
  expect(statusCards().map(card => card.querySelector('strong').textContent)).toEqual(['Difesa in corso', 'Tiro nuovo']);
  expect(ids(current.view.panel.events)).toEqual(expect.arrayContaining([older.id, player.id]));

  openEntry(player.action.name);
  fireEvent.click(screen.getByRole('button', { name: 'Annulla tiro · Tiro di Orco' }));
  expect(screen.getByText('Annullare Tiro di Orco?')).toBeVisible();
  mutate.mockResolvedValueOnce({ data: { combatId: player.id, status: 'cancelled', cancellation: { needsReview: true } } });
  fireEvent.click(screen.getByRole('button', { name: 'Conferma annullamento · Tiro di Orco' }));
  expect(await screen.findByText('Effetti da verificare al tavolo.')).toBeVisible();
  expect(mutate).toHaveBeenCalledWith({ command: 'cancel', combatId: player.id });
  expect(mutate).toHaveBeenCalledTimes(1);
  mutate.mockResolvedValueOnce({ data: { combatId: player.id, corrections: [{
    reason: 'barrierCapacity', subject: { kind: 'character', id: 'orc-user' }, amounts: { barrieraCurrent: 3 },
  }] } });
  fireEvent.click(screen.getByRole('button', { name: 'Mostra correzioni' }));
  expect(await screen.findByText('3 punti barriera')).toBeVisible();
  expect(mutate).toHaveBeenLastCalledWith({ command: 'getCancellationDetails', combatId: player.id });
});

test('a remote cancellation of an older player roll closes the DM tray and keeps its review in Registro', () => {
  const { result } = renderHook(() => useGrigliataCombat(props({ isManager: true })));
  const old = { ...entry('old-roll', 1, 'awaitingDamage'), actorUid: 'another-player',
    targets: [], pendingDamage: {expr: '1d4', round: 1} };
  emit(SCENE, others(40, 100));
  emit(MANAGER_PENDING, [old]);
  act(() => result.current.panel.onRollDamage(old, null));
  expect(result.current.tray).toMatchObject({ combatId: old.id, phase: 'ready' });
  emit(MANAGER_PENDING, []);
  emit(MANAGER_CANCELLED, [{...old, status: 'cancelled', cancellation: {needsReview: true}, updatedAt: at(200)}]);
  expect(result.current.tray).toBeNull();
  expect(result.current.panel.events.find(event => event.id === old.id)).toMatchObject({
    status: 'cancelled', cancellation: {needsReview: true},
  });
});

test('a cancellation invalidates a sending tray for that action and ignores its late reply', async () => {
  const { result } = renderHook(() => useGrigliataCombat(props()));
  const roll = { ...entry('roll', 1, 'awaitingDamage'), pendingDamage: { round: 1, expr: '1d4' } };
  const other = { ...roll, id: 'other' };
  emit(PENDING, [roll, other]);
  act(() => result.current.panel.onRollDamage(roll, null));
  let resolveRoll;
  mutate.mockReturnValueOnce(new Promise(resolve => { resolveRoll = resolve; }));
  act(() => { result.current.tray.throwDice(); });
  expect(result.current.tray.phase).toBe('sending');
  mutate.mockResolvedValueOnce({ data: { combatId: roll.id, status: 'cancelled' } });
  await act(() => result.current.panel.onCancel(roll));
  expect(result.current.tray).toBeNull();
  expect(ids(result.current.panel.pending)).toEqual(['other']);
  const otherTray = result.current.nextDamage;
  act(() => otherTray.prepare());
  await act(async () => resolveRoll({ data: { combatId: roll.id, damage: 4, rolls: [{ sides: 4, value: 4 }] } }));
  expect(result.current.tray).toMatchObject({ combatId: other.id, phase: 'ready' });
  emit(OWNED, [{ ...roll, status: 'cancelled' }]);
  expect(result.current.tray).toMatchObject({ combatId: other.id, phase: 'ready' });
  act(() => result.current.panel.onRollDamage(roll, null));
  expect(result.current.tray).toMatchObject({ combatId: other.id, phase: 'ready' });
});

test('cancelling one action leaves another sending tray alone, and a remote cancellation retires a late error', async () => {
  const { result } = renderHook(() => useGrigliataCombat(props()));
  const roll = { ...entry('roll', 1, 'awaitingDamage'), pendingDamage: { round: 1, expr: '1d4' } };
  const other = entry('other', 2, 'waiting');
  emit(PENDING, [roll, other]);
  act(() => result.current.panel.onRollDamage(roll, null));
  let rejectRoll;
  mutate.mockReturnValueOnce(new Promise((_, reject) => { rejectRoll = reject; }));
  act(() => { result.current.tray.throwDice(); });
  mutate.mockResolvedValueOnce({ data: { combatId: other.id, status: 'cancelled' } });
  await act(() => result.current.panel.onCancel(other));
  expect(result.current.tray).toMatchObject({ combatId: roll.id, phase: 'sending' });

  emit(OWNED, [{ ...roll, status: 'cancelled' }]);
  expect(result.current.tray).toBeNull();
  await act(async () => rejectRoll(new Error('Tiro già annullato')));
  expect(result.current.tray).toBeNull();
  expect(result.current.panel.error).toBeUndefined();
});

test('a cancelled record and a cancelled private request suppress stale damage copies of that action', () => {
  const { result } = renderHook(() => useGrigliataCombat(props()));
  const full = mixedVolley();
  const ownCopy = ownerCopy(full.id, 'lia', 'Lia', { outcome: 'hit', damage: 7 }, 30);
  const hiddenCopy = ownerCopy('hidden', 'nyx', 'Nyx', { outcome: 'hit', damage: 6 }, 40);
  emit(OWNER_DAMAGE, [ownCopy, hiddenCopy]);
  emit(JOURNAL, [{ ...full, status: 'cancelled', updatedAt: at(20) }]);
  expect(result.current.panel.events.find(event => event.id === full.id).status).toBe('cancelled');
  emit(JOURNAL, []);
  expect(ids(result.current.panel.events)).toEqual(['hidden']);
  emit(OWNER_DAMAGE, [ownCopy, hiddenCopy, { ...hiddenCopy, id: 'terminal-request', status: 'cancelled', ownerDamage: undefined }]);
  expect(result.current.panel.events).toEqual([]);
  emit(OWNER_DAMAGE, [hiddenCopy]);
  expect(result.current.panel.events).toEqual([]);
});

test('two same-name hidden pawns have distinct damage controls without coordinates', async () => {
  playerView({ tokens: [] });
  emit(OWNER_DAMAGE, [
    ownerCopy('ambush', 'nyx', 'Guardia', { outcome: 'hit', damage: 7 }, 20),
    ownerCopy('ambush', 'lia', 'Guardia', { outcome: 'hit', damage: 5 }, 19),
  ]);
  fireEvent.click(screen.getByText('Registro'));
  fireEvent.click(screen.getByText('Pugnale', { selector: '.gc-log-caption strong' }));
  const first = screen.getByRole('form', { name: 'Applica danno a Guardia · Pedina 1' });
  const second = screen.getByRole('form', { name: 'Applica danno a Guardia · Pedina 2' });
  expect(within(first).getByLabelText('Danno finale')).toHaveValue('5');
  expect(within(second).getByLabelText('Danno finale')).toHaveValue('7');
  mutate.mockResolvedValueOnce({ data: { combatId: 'ambush', damageApplied: { amount: 7 } } });
  fireEvent.click(within(second).getByRole('button', { name: 'Applica danno' }));
  expect(await screen.findByText('Danno applicato · 7')).toBeInTheDocument();
  expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ targetPlacementId: id('nyx') }));
});

test('a full record lends the display context and other people’s copies are never shown', () => {
  const { current } = playerView({ tokens: [] });
  const full = { ...mixedVolley(), id: 'ambush', shared: false, actorUid: uid, actor: { placementId: id('nyx'), name: 'Nyx' }, updatedAt: at(21) };
  emit(OWNER_DAMAGE, [
    ownerCopy('ambush', 'lia', 'Lia', { outcome: 'hit', damage: 7 }, 20),
    ownerCopy('other-action', 'lia', 'Lia', { outcome: 'hit', damage: 2, ownerUid: 'someone-else' }, 15),
    ownerCopy('solo', 'nyx', 'Nyx', { outcome: 'hit', damage: 4 }, 10),
  ]);
  expect(ids(current.view.panel.events)).toEqual(['ambush', 'solo']);
  emit(OWNED, [full]);
  expect(ids(current.view.panel.events)).toEqual(['solo', 'ambush']);
  expect(current.view.panel.events.find(event => event.id === 'ambush')).toEqual(full);
  expect(within(screen.getByText('Registro')).getByText('2')).toBeInTheDocument();

  // A failed private listener reports like the others and its next snapshot recovers.
  act(() => listeners.get(OWNER_DAMAGE).error(new Error('Missing or insufficient permissions.')));
  expect(current.view.panel.error).toBe('Missing or insufficient permissions.');
  expect(ids(current.view.panel.events)).toEqual(['ambush']);
  emit(OWNER_DAMAGE, [ownerCopy('solo', 'nyx', 'Nyx', { outcome: 'hit', damage: 4 }, 10)]);
  expect(current.view.panel.error).toBeUndefined();
});
