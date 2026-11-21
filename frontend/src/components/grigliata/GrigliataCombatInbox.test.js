import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import GrigliataCombatInbox, { applyReceiptDamage } from './GrigliataCombatInbox';
import * as firestore from '../../performance/firestore';
import { getCallable } from '../../data/functions/callableRegistry';

jest.mock('../firebaseConfig', () => ({ db: { name: 'test-db' } }));
jest.mock('../../performance/firestore', () => ({
  collection: jest.fn(),
  doc: jest.fn(),
  labelFirestoreTarget: jest.fn(),
  onSnapshot: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
}));
jest.mock('../../data/functions/callableRegistry', () => ({ getCallable: jest.fn() }));

const uid = 'bro-user';
const PENDING = 'grigliata.combat-requests.pending.subscribe.v1';
const RECEIPT = 'grigliata.combat-requests.receipt-damage.subscribe.v1';
const DAMAGE_MAP = 'grigliata.combat-requests.active-map.subscribe.v1';
const mapSnapshot = (activeBackgroundId, fromCache = false) => ({
  exists: () => true, data: () => ({ activeBackgroundId }), metadata: { fromCache },
});
const RETRY_SAFE = 'Conferma non ricevuta. Riprova: un danno già registrato non viene applicato due volte.';
const request = {
  combatId: 'combat-1', backgroundId: 'map', ownerUid: uid, status: 'waiting', round: 1, actor: { name: 'Nyx' },
  target: { placementId: 'map__bro', name: 'Bro' }, action: { name: 'Spada', kind: 'weapon', hands: 1 },
  attack: { label: 'Mira', total: 12 }, defense: { label: 'Difesa', value: 2 },
};
const ownerCopy = target => ({
  ownerUid: uid, backgroundId: 'map', combatId: 'combat-1',
  ownerDamage: {
    kind: 'weapon', action: { name: 'Spada', hands: 1 },
    target: { placementId: 'map__bro', name: 'Bro', ownerUid: uid, status: 'done', round: 1, outcome: 'hit', damage: 9, critical: null, damageApplied: null, ...target },
  },
});

const DEFENSE_RETRY_SAFE = 'Conferma non ricevuta. Riprova: una difesa già registrata non viene ripetuta, ne vedrai l’esito.';
const lia = { ...request, id: 'req-2', target: { placementId: 'map__lia', name: 'Lia' } };
const HIT_REPLY = { data: { combatId: 'combat-1', round: 1, outcome: 'hit', damage: 9, effects: [] } };
const lostReply = () => Object.assign(new Error('internal'), { code: 'functions/internal' });
const copyOf = data => ({ id: 'req-1', exists: () => true, data: () => data, metadata: { fromCache: false } });
const deferred = () => {
  const handle = {};
  handle.promise = new Promise((resolve, reject) => Object.assign(handle, { resolve, reject }));
  return handle;
};

// Damage of an action that asks no defense, awaiting its owner's confirmation: the same private projection as a receipt.
const immediate = (id, { seconds = 1, ...target } = {}) => ({
  id, status: 'damagePending', createdAt: { seconds }, ownerUid: uid, backgroundId: 'map', combatId: 'combat-' + id,
  ownerDamage: {
    kind: 'spell', action: { name: 'Fulmine', hands: 0 },
    target: { placementId: 'map__bro', name: 'Bro', ownerUid: uid, status: 'done', round: 1, outcome: 'applied', damage: 9, critical: null, damageApplied: null, ...target },
  },
});
const copyFor = ({ id, ...data }, target = {}) => ({
  id, exists: () => true, metadata: { fromCache: false },
  data: () => ({ ...data, ownerDamage: { ...data.ownerDamage, target: { ...data.ownerDamage.target, ...target } } }),
});

let listeners;
let mutate;
let startingDamageMap;
const docs = list => ({ docs: list.map(({ id, ...data }) => ({ id, data: () => data })) });
const server = list => ({ ...docs(list), metadata: { fromCache: false } });
const cached = list => ({ ...docs(list), metadata: { fromCache: true } });
const MORE_DAMAGE = /^Danni da confermare/;
// The corner stack, newest first: the first status in the page while no prompt is open.
const cornerFeed = () => screen.getAllByRole('status')[0];
const openReceiptListeners = () => listener(RECEIPT).filter(entry => !entry.unsubscribe.mock.calls.length);
const listener = label => listeners.filter(entry => entry.target.label === label);
const defenseField = () => within(screen.getByRole('dialog', { name: 'Difesa' })).getByRole('spinbutton', { name: 'Difesa' });

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };
  listeners = [];
  mutate = jest.fn();
  startingDamageMap = 'map';
  getCallable.mockImplementation(() => mutate);
  firestore.collection.mockImplementation((_db, name) => ({ collection: name }));
  firestore.doc.mockImplementation((_db, ...path) => ({ path: path.join('/') }));
  firestore.where.mockImplementation((...filter) => filter);
  firestore.query.mockImplementation((source, ...constraints) => ({ source, constraints }));
  firestore.labelFirestoreTarget.mockImplementation((target, label, ownership) => ({ ...target, label, ownership }));
  firestore.onSnapshot.mockImplementation((target, ...args) => {
    const [next, error] = args.filter(arg => typeof arg === 'function');
    const options = args.find(arg => arg && typeof arg === 'object');
    const entry = { target, options, next, error, unsubscribe: jest.fn() };
    listeners.push(entry);
    if (target.label === DAMAGE_MAP && startingDamageMap) next(mapSnapshot(startingDamageMap));
    return entry.unsubscribe;
  });
});

test('after a hit, Home follows that one private request and applies its damage with the Registro’s command', async () => {
  const { unmount } = render(<GrigliataCombatInbox uid={uid} />);
  const [pending] = listener(PENDING);
  act(() => pending.next(docs([{ ...request, id: 'req-1' }])));
  mutate.mockResolvedValueOnce({ data: { combatId: 'combat-1', round: 1, outcome: 'hit', damage: 9, effects: [] } });
  fireEvent.click(screen.getByRole('button', { name: 'Tira Difesa' }));
  expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ command: 'defend', combatId: 'combat-1', targetPlacementId: 'map__bro', round: 1 }));
  act(() => pending.next(docs([])));
  await screen.findByText('Colpito');

  // A document listener on the answered request alone: never a query, never the public journal.
  const [receipt] = listener(RECEIPT);
  expect(listeners).toHaveLength(2);
  expect(receipt.target).toEqual({ path: 'grigliata_combat_requests/req-1', label: RECEIPT, ownership: 'shell' });
  expect(receipt.options).toEqual({ includeMetadataChanges: true });
  expect(firestore.doc).toHaveBeenCalledWith({ name: 'test-db' }, 'grigliata_combat_requests', 'req-1');
  expect(screen.getByText('Recupero il danno da confermare…')).toBeInTheDocument();

  act(() => receipt.next({ id: 'req-1', exists: () => true, data: () => ownerCopy({ critical: { score: 13, total: 12, tableRoll: '' } }), metadata: { fromCache: false } }));
  const form = screen.getByRole('form', { name: 'Applica danno a Bro' });
  expect(within(form).getByLabelText('Danno finale')).toHaveValue('12');
  mutate.mockResolvedValueOnce({ data: { combatId: 'combat-1', damageApplied: { amount: 12 } } });
  fireEvent.click(within(form).getByRole('button', { name: 'Applica danno' }));
  expect(mutate).toHaveBeenLastCalledWith({ command: 'applyDamage', combatId: 'combat-1', targetPlacementId: 'map__bro', amount: 12, criticalScore: 13 });
  expect(await screen.findByText('Danno applicato · 12')).toBeInTheDocument();

  // Closing the receipt ends its listener; the pending one stays until the inbox goes.
  fireEvent.click(screen.getByRole('button', { name: 'Chiudi esito difesa' }));
  expect(receipt.unsubscribe).toHaveBeenCalledTimes(1);
  expect(pending.unsubscribe).not.toHaveBeenCalled();
  unmount();
  expect(pending.unsubscribe).toHaveBeenCalledTimes(1);
  expect(receipt.unsubscribe).toHaveBeenCalledTimes(1);
});

test('a missing document reads as nothing to confirm, and the inbox going away ends the receipt listener', async () => {
  const { unmount } = render(<GrigliataCombatInbox uid={uid} />);
  act(() => listener(PENDING)[0].next(docs([{ ...request, id: 'req-1' }])));
  mutate.mockResolvedValueOnce({ data: { outcome: 'hit', damage: 9, effects: [] } });
  fireEvent.click(screen.getByRole('button', { name: 'Tira Difesa' }));
  act(() => listener(PENDING)[0].next(docs([])));
  await screen.findByText('Colpito');
  const [receipt] = listener(RECEIPT);
  act(() => receipt.next({ id: 'req-1', exists: () => false, data: () => undefined, metadata: { fromCache: false } }));
  expect(screen.queryByText('Recupero il danno da confermare…')).not.toBeInTheDocument();
  expect(screen.queryByRole('form', { name: /Applica danno/ })).not.toBeInTheDocument();
  unmount();
  expect(receipt.unsubscribe).toHaveBeenCalledTimes(1);
});

test('the application reports what to do: a lost reply is safe to retry, a refusal keeps the server’s reason', async () => {
  const payload = { combatId: 'combat-1', targetPlacementId: 'map__bro', amount: 9, criticalScore: null };
  mutate.mockRejectedValueOnce(Object.assign(new Error('internal'), { code: 'functions/internal' }));
  await expect(applyReceiptDamage(payload)).rejects.toThrow(RETRY_SAFE);
  mutate.mockRejectedValueOnce(Object.assign(new Error('Il critico è cambiato: controlla il danno aggiornato.'), { code: 'functions/failed-precondition' }));
  await expect(applyReceiptDamage(payload)).rejects.toThrow('Il critico è cambiato: controlla il danno aggiornato.');
  mutate.mockResolvedValueOnce({ data: { combatId: 'combat-1' } });
  await expect(applyReceiptDamage(payload)).rejects.toThrow(RETRY_SAFE);
  mutate.mockResolvedValueOnce({ data: { combatId: 'combat-1', damageApplied: { amount: 8 } } });
  await expect(applyReceiptDamage(payload)).resolves.toEqual({ amount: 8 });
  expect(mutate).toHaveBeenCalledWith({ command: 'applyDamage', ...payload });
  expect(getCallable).toHaveBeenCalledWith('mutateGrigliataCombat');
});

test('a defense reply lost after the server recorded it keeps the prompt and its values, and a retry of the same round shows the recorded outcome', async () => {
  render(<GrigliataCombatInbox uid={uid} />);
  const [pending] = listener(PENDING);
  act(() => pending.next(docs([{ ...request, id: 'req-1' }])));
  fireEvent.change(defenseField(), { target: { value: '5' } });
  const lost = deferred();
  mutate.mockReturnValueOnce(lost.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Tira Difesa' }));
  const sent = { defense: 5, command: 'defend', combatId: 'combat-1', targetPlacementId: 'map__bro', round: 1 };
  expect(mutate).toHaveBeenLastCalledWith(sent);

  // The answer committed: the waiting listener drops the request while its reply is still on the way, then the reply is lost.
  act(() => pending.next(docs([])));
  expect(screen.getByRole('dialog', { name: 'Difesa' })).toHaveTextContent('Invio della risposta…');
  await act(async () => lost.reject(lostReply()));
  const dialog = screen.getByRole('dialog', { name: 'Difesa' });
  expect(within(dialog).getByRole('alert')).toHaveTextContent(DEFENSE_RETRY_SAFE);
  expect(defenseField()).toHaveValue(5);
  expect(defenseField()).toHaveAttribute('readonly');
  expect(within(dialog).queryByRole('button', { name: 'Tira Difesa' })).not.toBeInTheDocument();

  // The retry resends the same command for the same round; the server answers with the trial it already holds.
  mutate.mockResolvedValueOnce(HIT_REPLY);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Riprova' }));
  expect(mutate).toHaveBeenCalledTimes(2);
  expect(mutate).toHaveBeenLastCalledWith(sent);
  expect(await screen.findByText('Colpito')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Difesa ·/ })).not.toBeInTheDocument();
  expect(screen.getByText('Bro · Spada')).toBeInTheDocument();
  expect(listener(RECEIPT)).toHaveLength(1);
});

test('a postponed defense keeps its retry after answering another pawn’s defense', async () => {
  render(<GrigliataCombatInbox uid={uid} />);
  const [pending] = listener(PENDING);
  act(() => pending.next(docs([{ ...request, id: 'req-1' }, lia])));
  fireEvent.change(defenseField(), { target: { value: '5' } });
  const lost = deferred();
  mutate.mockReturnValueOnce(lost.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Tira Difesa' }));
  const sent = { defense: 5, command: 'defend', combatId: 'combat-1', targetPlacementId: 'map__bro', round: 1 };
  act(() => pending.next(docs([lia])));
  await act(async () => lost.reject(lostReply()));
  expect(screen.getByRole('alert')).toHaveTextContent(DEFENSE_RETRY_SAFE);
  fireEvent.click(screen.getByRole('button', { name: 'Più tardi' }));

  mutate.mockResolvedValueOnce({ data: { ...HIT_REPLY.data, outcome: 'miss', damage: null } });
  fireEvent.click(screen.getByRole('button', { name: 'Tira Difesa' }));
  expect(mutate).toHaveBeenLastCalledWith({ ...sent, defense: 2, targetPlacementId: 'map__lia' });
  act(() => pending.next(docs([])));
  await screen.findByText('Lia · Spada');

  fireEvent.click(screen.getByRole('button', { name: 'Difesa · 1' }));
  expect(defenseField()).toHaveValue(5);
  expect(defenseField()).toHaveAttribute('readonly');
  mutate.mockResolvedValueOnce(HIT_REPLY);
  fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
  expect(mutate).toHaveBeenCalledTimes(3);
  expect(mutate).toHaveBeenLastCalledWith(sent);
  await screen.findByText('Bro · Spada');
  const [receipt] = listener(RECEIPT);
  act(() => receipt.next(copyOf(ownerCopy())));
  expect(screen.getByRole('form', { name: 'Applica danno a Bro' })).toBeInTheDocument();
});

test('a held answer is let go by a refusal, with its reason kept in view, and by a change of account', async () => {
  const { rerender } = render(<GrigliataCombatInbox uid={uid} />);
  const [pending] = listener(PENDING);
  act(() => pending.next(docs([{ ...request, id: 'req-1' }])));
  mutate.mockRejectedValueOnce(lostReply());
  fireEvent.click(screen.getByRole('button', { name: 'Tira Difesa' }));
  act(() => pending.next(docs([])));
  // A deferred hold still counts in the launcher and comes back as it was.
  await screen.findByRole('button', { name: 'Riprova' });
  fireEvent.click(screen.getByRole('button', { name: 'Più tardi' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Difesa · 1' }));
  expect(defenseField()).toHaveValue(2);
  expect(defenseField()).toHaveAttribute('readonly');

  mutate.mockRejectedValueOnce(Object.assign(new Error('Richiesta di combattimento non disponibile.'), { code: 'functions/not-found' }));
  fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
  expect(await screen.findByText('Risposta non registrata')).toBeInTheDocument();
  expect(screen.getByText('Richiesta di combattimento non disponibile.')).toHaveClass('gc-error');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Difesa ·/ })).not.toBeInTheDocument();
  expect(mutate).toHaveBeenCalledTimes(2);

  // A lost reply again, then another account signs in: nothing of the first one's answer stays.
  act(() => pending.next(docs([{ ...request, id: 'req-1' }])));
  mutate.mockRejectedValueOnce(lostReply());
  fireEvent.click(screen.getByRole('button', { name: 'Tira Difesa' }));
  act(() => pending.next(docs([])));
  expect(await screen.findByRole('button', { name: 'Riprova' })).toBeInTheDocument();
  rerender(<GrigliataCombatInbox uid="lia-user" />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Difesa ·/ })).not.toBeInTheDocument();
  expect(screen.queryByText('Risposta non registrata')).not.toBeInTheDocument();
});

test('a definitive refusal while the request is still waiting stays on its prompt, editable', async () => {
  render(<GrigliataCombatInbox uid={uid} />);
  const [pending] = listener(PENDING);
  act(() => pending.next(docs([{ ...request, id: 'req-1' }])));
  mutate.mockRejectedValueOnce(Object.assign(new Error('Il valore di difesa non è valido.'), { code: 'functions/invalid-argument' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tira Difesa' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Il valore di difesa non è valido.');
  expect(defenseField()).not.toHaveAttribute('readonly');
  expect(screen.getByRole('button', { name: 'Tira Difesa' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Riprova' })).not.toBeInTheDocument();
});

test('an unsent amount and the critical it was typed against follow the receipt between the dialog and the corner, and so does focus', async () => {
  render(<GrigliataCombatInbox uid={uid} />);
  const [pending] = listener(PENDING);
  act(() => pending.next(docs([{ ...request, id: 'req-1' }, lia])));
  mutate.mockResolvedValueOnce(HIT_REPLY);
  fireEvent.click(screen.getByRole('button', { name: 'Tira Difesa' }));
  act(() => pending.next(docs([lia])));
  await screen.findByText('Colpito');
  const [receipt] = listener(RECEIPT);
  act(() => receipt.next(copyOf(ownerCopy({ critical: { score: 13, total: 12, tableRoll: '' } }))));
  // Lia's prompt keeps focus over Bro's receipt above it.
  expect(defenseField()).toHaveFocus();
  const inDialog = within(screen.getByRole('dialog', { name: 'Difesa' })).getByLabelText('Danno finale');
  expect(inDialog).toHaveValue('12');
  inDialog.focus();
  fireEvent.change(inDialog, { target: { value: '6' } });

  // Lia's request is settled elsewhere: the dialog closes mid-edit and the field moves to the corner, focus with it.
  act(() => pending.next(docs([])));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const inCorner = screen.getByLabelText('Danno finale');
  expect(inCorner).not.toBe(inDialog);
  expect(inCorner).toHaveValue('6');
  expect(inCorner).toHaveFocus();

  // The attacker confirms another critical: the amount stays, flagged against its own critical.
  act(() => receipt.next(copyOf(ownerCopy({ critical: { score: 15, total: 14, tableRoll: '' } }))));
  expect(screen.getByText(/Danno proposto aggiornato: 14\./)).toBeInTheDocument();
  expect(screen.getByLabelText('Danno finale')).toHaveValue('6');

  // A new prompt opens over it and takes focus; the amount comes along, unsent.
  act(() => pending.next(docs([{ ...lia, id: 'req-3' }])));
  const dialog = screen.getByRole('dialog', { name: 'Difesa' });
  expect(defenseField()).toHaveFocus();
  expect(within(dialog).getByLabelText('Danno finale')).toHaveValue('6');
  expect(within(dialog).getByText(/Danno proposto aggiornato: 14\./)).toBeInTheDocument();

  // Put off with Escape: focus returns to the field being edited before the prompt opened.
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Danno finale')).toHaveFocus();
  expect(screen.getByLabelText('Danno finale')).toHaveValue('6');

  // Taking the new proposal sends it with the critical it was computed from.
  fireEvent.click(screen.getByRole('button', { name: 'Usa la proposta' }));
  expect(screen.getByLabelText('Danno finale')).toHaveValue('14');
  mutate.mockResolvedValueOnce({ data: { combatId: 'combat-1', damageApplied: { amount: 14 } } });
  fireEvent.click(screen.getByRole('button', { name: 'Applica danno' }));
  expect(mutate).toHaveBeenLastCalledWith({ command: 'applyDamage', combatId: 'combat-1', targetPlacementId: 'map__bro', amount: 14, criticalScore: 15 });
  expect(await screen.findByText('Danno applicato · 14')).toBeInTheDocument();
});

test('a sent amount and its error survive the move too, and nothing is sent twice', async () => {
  render(<GrigliataCombatInbox uid={uid} />);
  const [pending] = listener(PENDING);
  act(() => pending.next(docs([{ ...request, id: 'req-1' }, lia])));
  mutate.mockResolvedValueOnce(HIT_REPLY);
  fireEvent.click(screen.getByRole('button', { name: 'Tira Difesa' }));
  act(() => pending.next(docs([lia])));
  await screen.findByText('Colpito');
  act(() => listener(RECEIPT)[0].next(copyOf(ownerCopy())));
  fireEvent.change(screen.getByLabelText('Danno finale'), { target: { value: '11' } });
  mutate.mockRejectedValueOnce(lostReply());
  fireEvent.click(screen.getByRole('button', { name: 'Applica danno' }));
  expect(await screen.findByText(RETRY_SAFE)).toBeInTheDocument();
  act(() => pending.next(docs([])));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Danno finale')).toHaveValue('11');
  expect(screen.getByRole('alert')).toHaveTextContent(RETRY_SAFE);
  expect(mutate.mock.calls.filter(([payload]) => payload.command === 'applyDamage')).toHaveLength(1);
});

test('after a lost copy, a reload started from the receipt hands focus back to its field, unless the viewer moved on', async () => {
  render(<><button type="button">Mappa</button><GrigliataCombatInbox uid={uid} /></>);
  const [pending] = listener(PENDING);
  act(() => pending.next(docs([{ ...request, id: 'req-1' }])));
  mutate.mockResolvedValueOnce(HIT_REPLY);
  fireEvent.click(screen.getByRole('button', { name: 'Tira Difesa' }));
  act(() => pending.next(docs([])));
  await screen.findByText('Colpito');
  act(() => listener(RECEIPT)[0].next(copyOf(ownerCopy())));
  fireEvent.change(screen.getByLabelText('Danno finale'), { target: { value: '4' } });

  act(() => listener(RECEIPT)[0].error(new Error('offline')));
  const reload = screen.getByRole('button', { name: 'Ricarica il danno' });
  reload.focus();
  fireEvent.click(reload);
  expect(screen.getByText('Recupero il danno da confermare…')).toBeInTheDocument();
  act(() => listener(RECEIPT)[1].next(copyOf(ownerCopy())));
  expect(screen.getByLabelText('Danno finale')).toHaveFocus();
  expect(screen.getByLabelText('Danno finale')).toHaveValue('4');

  // The same reload, but the viewer went to the map while it loaded: focus stays there.
  act(() => listener(RECEIPT)[1].error(new Error('offline')));
  screen.getByRole('button', { name: 'Ricarica il danno' }).focus();
  fireEvent.click(screen.getByRole('button', { name: 'Ricarica il danno' }));
  screen.getByRole('button', { name: 'Mappa' }).focus();
  act(() => listener(RECEIPT)[2].next(copyOf(ownerCopy())));
  expect(screen.getByRole('button', { name: 'Mappa' })).toHaveFocus();
  expect(screen.getByLabelText('Danno finale')).toHaveValue('4');
});

test('one owner listener reads waiting defenses and damage to confirm together, with the server’s own sync', () => {
  render(<GrigliataCombatInbox uid={uid} />);
  const [pending] = listener(PENDING);
  expect(listeners).toHaveLength(1);
  expect(pending.target).toEqual(expect.objectContaining({
    source: { collection: 'grigliata_combat_requests' },
    constraints: [['ownerUid', '==', uid], ['status', 'in', ['waiting', 'damagePending']]],
    ownership: 'shell',
  }));
  expect(pending.options).toEqual({ includeMetadataChanges: true });
});

test('immediate damage opens a corner receipt on Home without a prompt or focus, and its confirmation outlives the query', async () => {
  render(<><button type="button">Mappa</button><GrigliataCombatInbox uid={uid} /></>);
  screen.getByRole('button', { name: 'Mappa' }).focus();
  const [pending] = listener(PENDING);
  const bolt = immediate('req-9');
  act(() => pending.next(server([bolt])));

  // No defense to roll or tap: no dialog and no defense launcher, only the outcome with its damage.
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Difesa ·/ })).not.toBeInTheDocument();
  // Announced through the stack's own status, like a defense outcome.
  const card = cornerFeed();
  expect(card).toHaveTextContent('Bro · Fulmine');
  expect(card).toHaveTextContent('Danno subito');
  expect(card).toHaveTextContent('Nessuna difesa richiesta');
  expect(screen.getByRole('button', { name: 'Mappa' })).toHaveFocus();

  // The same document watch as a defense receipt: the request alone, read from the server's copy.
  const [receipt] = listener(RECEIPT);
  expect(receipt.target).toEqual({ path: 'grigliata_combat_requests/req-9', label: RECEIPT, ownership: 'shell' });
  expect(receipt.options).toEqual({ includeMetadataChanges: true });
  expect(within(card).getByText('Recupero il danno da confermare…')).toBeInTheDocument();
  act(() => receipt.next(copyFor(bolt)));
  expect(within(card).getByLabelText('Danno finale')).toHaveValue('9');
  expect(screen.getByRole('button', { name: 'Mappa' })).toHaveFocus();

  // A later write (here a critical) updates the projection: the same receipt reads it, none is added or announced again.
  const critical = { critical: { score: 13, total: 12, tableRoll: '' } };
  act(() => pending.next(server([immediate('req-9', critical)])));
  act(() => pending.next(cached([immediate('req-9', critical)])));
  act(() => receipt.next(copyFor(bolt, critical)));
  expect(screen.getAllByText('Danno subito')).toHaveLength(1);
  expect(listener(RECEIPT)).toHaveLength(1);
  const form = screen.getByRole('form', { name: 'Applica danno a Bro' });
  expect(within(form).getByLabelText('Danno finale')).toHaveValue('12');

  mutate.mockResolvedValueOnce({ data: { combatId: 'combat-req-9', damageApplied: { amount: 12 } } });
  fireEvent.click(within(form).getByRole('button', { name: 'Applica danno' }));
  expect(mutate).toHaveBeenLastCalledWith({ command: 'applyDamage', combatId: 'combat-req-9', targetPlacementId: 'map__bro', amount: 12, criticalScore: 13 });
  expect(await screen.findByText('Danno applicato · 12')).toBeInTheDocument();

  // Confirmed: the query drops the request, its document stays readable with the amount recorded.
  act(() => pending.next(server([])));
  act(() => receipt.next(copyFor(bolt, { ...critical, damageApplied: { amount: 12 } })));
  expect(screen.getByText('Danno applicato · 12')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: MORE_DAMAGE })).not.toBeInTheDocument();
  expect(receipt.unsubscribe).not.toHaveBeenCalled();
  expect(mutate).toHaveBeenCalledTimes(1);
});

test('Home holds an owner to the proposed damage as the minimum, while the DM signed in sets any amount', async () => {
  const { rerender } = render(<GrigliataCombatInbox uid={uid} />);
  const bolt = immediate('req-9');
  act(() => listener(PENDING)[0].next(server([bolt])));
  act(() => listener(RECEIPT)[0].next(copyFor(bolt)));
  expect(screen.getByLabelText('Danno finale')).toHaveAccessibleDescription('Minimo 9: puoi aumentarlo; per ridurlo chiedi al DM.');
  rerender(<GrigliataCombatInbox uid={uid} isManager />);
  expect(screen.getByLabelText('Danno finale')).toHaveAccessibleDescription('');
  fireEvent.change(screen.getByLabelText('Danno finale'), { target: { value: '0' } });
  mutate.mockResolvedValueOnce({ data: { combatId: 'combat-req-9', damageApplied: { amount: 0 } } });
  fireEvent.click(screen.getByRole('button', { name: 'Applica danno' }));
  expect(mutate).toHaveBeenLastCalledWith({ command: 'applyDamage', combatId: 'combat-req-9', targetPlacementId: 'map__bro', amount: 0, criticalScore: null });
  expect(await screen.findByText('Danno applicato · 0')).toBeInTheDocument();
});

test('Home defers immediate damage from another map and restores the draft when its map is active again', () => {
  startingDamageMap = null;
  render(<GrigliataCombatInbox uid={uid} />);
  const [pending] = listener(PENDING);
  const bolt = immediate('req-map');
  act(() => pending.next(server([bolt])));
  expect(screen.queryByText('Danno subito')).not.toBeInTheDocument();
  const [board] = listener(DAMAGE_MAP);
  expect(board.target.path).toBe('grigliata_state/current');
  act(() => board.next(mapSnapshot('map', true)));
  act(() => board.next(mapSnapshot('elsewhere')));
  expect(screen.queryByText('Danno subito')).not.toBeInTheDocument();
  expect(openReceiptListeners()).toHaveLength(0);

  act(() => board.next(mapSnapshot('map')));
  const [receipt] = openReceiptListeners();
  act(() => receipt.next(copyFor(bolt)));
  fireEvent.change(screen.getByLabelText('Danno finale'), { target: { value: '7' } });
  act(() => board.next(mapSnapshot('elsewhere')));
  expect(screen.queryByRole('form', { name: 'Applica danno a Bro' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: MORE_DAMAGE })).not.toBeInTheDocument();
  act(() => board.next(mapSnapshot('map')));
  const [restored] = openReceiptListeners();
  expect(restored).not.toBe(receipt);
  act(() => restored.next(copyFor(bolt)));
  expect(screen.getByLabelText('Danno finale')).toHaveValue('7');
  expect(mutate).not.toHaveBeenCalled();
});

test('parking four receipts on another map releases their slots and the new map’s first hit opens directly', () => {
  render(<GrigliataCombatInbox uid={uid} />);
  const [pending] = listener(PENDING);
  const firstMap = ['Ada', 'Bea', 'Cid', 'Dag'].map(name => immediate(name, { name, placementId: 'map__' + name }));
  act(() => pending.next(server(firstMap)));
  expect(openReceiptListeners()).toHaveLength(4);
  const [board] = listener(DAMAGE_MAP);
  const bolt = { ...immediate('new-map', { name: 'Eva', placementId: 'new-map__eva' }), backgroundId: 'new-map' };

  act(() => board.next(mapSnapshot('new-map')));
  expect(openReceiptListeners()).toHaveLength(0);
  act(() => pending.next(server([...firstMap, bolt])));
  expect(screen.getByText('Eva · Fulmine')).toBeInTheDocument();
  expect(openReceiptListeners()).toHaveLength(1);
  expect(screen.queryByRole('button', { name: MORE_DAMAGE })).not.toBeInTheDocument();

  act(() => board.next(mapSnapshot('map')));
  expect(screen.queryByText('Eva · Fulmine')).not.toBeInTheDocument();
  expect(screen.getByText('Dag · Fulmine')).toBeInTheDocument();
  expect(openReceiptListeners()).toHaveLength(4);
});

test('only the server’s copy for this owner opens damage to confirm, the DM applying first shows its amount, and another account sees none of it', () => {
  const { rerender } = render(<GrigliataCombatInbox uid={uid} />);
  const [pending] = listener(PENDING);
  const bolt = immediate('req-9');
  // A cached copy may be one already applied; a copy for another account or another owner's pawn is never this owner's.
  act(() => pending.next(cached([bolt])));
  act(() => pending.next(server([{ ...immediate('req-x'), ownerUid: 'lia-user' }, immediate('req-y', { ownerUid: 'lia-user' })])));
  act(() => pending.next(cached([bolt])));
  expect(screen.queryByText('Danno subito')).not.toBeInTheDocument();
  expect(listener(RECEIPT)).toHaveLength(0);
  expect(screen.queryByRole('button', { name: MORE_DAMAGE })).not.toBeInTheDocument();

  act(() => pending.next(server([bolt])));
  const [receipt] = listener(RECEIPT);
  act(() => receipt.next(copyFor(bolt)));
  expect(screen.getByRole('form', { name: 'Applica danno a Bro' })).toBeInTheDocument();

  // The DM applies it first: the query drops it and the receipt shows, and announces, the amount the server recorded.
  act(() => pending.next(server([])));
  act(() => receipt.next(copyFor(bolt, { damageApplied: { amount: 7 } })));
  expect(screen.getByText('Danno applicato · 7')).toBeInTheDocument();
  expect(screen.getByText('Danno applicato a Bro: 7.')).toBeInTheDocument();
  expect(mutate).not.toHaveBeenCalled();

  // Another account signs in: Bro's receipts and listeners go, and a cached copy cannot bring anything back.
  act(() => pending.next(server([immediate('req-10', { seconds: 2 })])));
  expect(listener(RECEIPT)).toHaveLength(2);
  rerender(<GrigliataCombatInbox uid="lia-user" />);
  expect(screen.queryByText('Danno subito')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: MORE_DAMAGE })).not.toBeInTheDocument();
  expect(openReceiptListeners()).toHaveLength(0);
  expect(pending.unsubscribe).toHaveBeenCalledTimes(1);
  const liaPending = listener(PENDING)[1];
  expect(liaPending.target.constraints[0]).toEqual(['ownerUid', '==', 'lia-user']);
  act(() => liaPending.next(cached([{ ...immediate('req-l', { ownerUid: 'lia-user' }), ownerUid: 'lia-user' }])));
  expect(screen.queryByText('Danno subito')).not.toBeInTheDocument();
  expect(listener(RECEIPT)).toHaveLength(2);
});

test('damage left to confirm after a dismissal or a burst stays one tap away in the corner, with at most four listeners', () => {
  render(<GrigliataCombatInbox uid={uid} />);
  const [pending] = listener(PENDING);
  const burst = ['Ada', 'Bea', 'Cid', 'Dag', 'Eva']
    .map((name, index) => immediate('req-' + name, { seconds: index + 1, name, placementId: 'map__' + name }));
  act(() => pending.next(server(burst)));
  expect(openReceiptListeners()).toHaveLength(4);
  expect(screen.queryByText('Ada · Fulmine')).not.toBeInTheDocument();
  expect(screen.getByText('Eva · Fulmine')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Danni da confermare · 1' })).toBeInTheDocument();

  // A receipt closed with its damage unconfirmed joins the count, and a later write brings neither back by itself.
  fireEvent.click(within(cornerFeed()).getAllByRole('button', { name: 'Chiudi esito danno' })[0]);
  act(() => pending.next(server(burst.map(entry => ({ ...entry })))));
  expect(screen.queryByText('Eva · Fulmine')).not.toBeInTheDocument();
  expect(screen.queryByText('Ada · Fulmine')).not.toBeInTheDocument();
  expect(openReceiptListeners()).toHaveLength(3);

  // The count reopens them, still within four: the oldest shown makes room and is counted in turn.
  fireEvent.click(screen.getByRole('button', { name: 'Danni da confermare · 2' }));
  expect(screen.getByText('Ada · Fulmine')).toBeInTheDocument();
  expect(screen.getByText('Eva · Fulmine')).toBeInTheDocument();
  expect(screen.queryByText('Bea · Fulmine')).not.toBeInTheDocument();
  expect(openReceiptListeners()).toHaveLength(4);
  expect(screen.getByRole('button', { name: 'Danni da confermare · 1' })).toBeInTheDocument();

  // Applied elsewhere meanwhile: nothing is left to reopen.
  act(() => pending.next(server(burst.filter(entry => entry.id !== 'req-Bea'))));
  expect(screen.queryByRole('button', { name: MORE_DAMAGE })).not.toBeInTheDocument();
});

test('every hidden receipt is reached even when reopening a batch pushes other receipts out', () => {
  render(<GrigliataCombatInbox uid={uid} />);
  const [pending] = listener(PENDING);
  const burst = Array.from({ length: 9 }, (_, index) => immediate('req-' + index, {
    seconds: index + 1, name: 'Pedina ' + index, placementId: 'map__' + index,
  }));
  act(() => pending.next(server(burst)));
  fireEvent.click(within(cornerFeed()).getAllByRole('button', { name: 'Chiudi esito danno' })[0]);
  expect(screen.queryByText('Pedina 8 · Fulmine')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: MORE_DAMAGE }));
  fireEvent.click(screen.getByRole('button', { name: MORE_DAMAGE }));
  expect(screen.getByText('Pedina 8 · Fulmine')).toBeInTheDocument();
  expect(openReceiptListeners()).toHaveLength(4);
});

test('damage arriving in the background keeps the focused defense receipt and an explicitly reopened receipt retains its amount', async () => {
  render(<GrigliataCombatInbox uid={uid} />);
  const [pending] = listener(PENDING);
  act(() => pending.next(server([{ ...request, id: 'req-1' }])));
  mutate.mockResolvedValueOnce(HIT_REPLY);
  fireEvent.click(screen.getByRole('button', { name: 'Tira Difesa' }));
  act(() => pending.next(server([])));
  await screen.findByText('Colpito');
  act(() => listener(RECEIPT)[0].next(copyOf(ownerCopy())));
  const field = screen.getByLabelText('Danno finale');
  field.focus();
  fireEvent.change(field, { target: { value: '6' } });

  // A new burst waits so the focused amount and submit button stay in view.
  const burst = Array.from({ length: 4 }, (_, index) => immediate('burst-' + index, {
    seconds: index + 1, name: 'Pedina ' + index, placementId: 'map__' + index,
  }));
  act(() => pending.next(server(burst)));
  expect(field).toHaveValue('6');
  expect(field).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Danni da confermare · 4' })).toBeInTheDocument();
  expect(openReceiptListeners()).toHaveLength(1);

  // Explicitly opening the overflow can move the answered defense to the end of the queue, with its draft.
  fireEvent.click(screen.getByRole('button', { name: MORE_DAMAGE }));
  expect(screen.queryByText('Bro · Spada')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: MORE_DAMAGE }));
  const reopened = openReceiptListeners().find(entry => entry.target.path.endsWith('/req-1'));
  act(() => reopened.next(copyOf(ownerCopy())));
  expect(within(screen.getByRole('form', { name: 'Applica danno a Bro' })).getByLabelText('Danno finale')).toHaveValue('6');
  expect(openReceiptListeners()).toHaveLength(4);
});

test('the number shown for a same-name pawn stays fixed as other receipts come and go', () => {
  render(<GrigliataCombatInbox uid={uid} />);
  const [pending] = listener(PENDING);
  const guard = (key, seconds) => immediate(key, { seconds, name: 'Guardia', placementId: 'map__' + key });
  const first = guard('b', 1);
  const second = guard('c', 2);
  act(() => pending.next(server([first, second])));
  expect(screen.getByText('Guardia · Pedina 2 · Fulmine')).toBeInTheDocument();
  fireEvent.click(within(cornerFeed()).getAllByRole('button', { name: 'Chiudi esito danno' })[1]);
  expect(screen.getByText('Guardia · Pedina 2 · Fulmine')).toBeInTheDocument();
  act(() => pending.next(server([first, second, guard('a', 3)])));
  expect(screen.getByText('Guardia · Pedina 2 · Fulmine')).toBeInTheDocument();
  expect(screen.getByText('Guardia · Pedina 3 · Fulmine')).toBeInTheDocument();
});

test('a dismissed damage reopened from the count hands focus to its amount once the server’s copy arrives', () => {
  render(<GrigliataCombatInbox uid={uid} />);
  const [pending] = listener(PENDING);
  const bolt = immediate('req-9');
  act(() => pending.next(server([bolt])));
  act(() => listener(RECEIPT)[0].next(copyFor(bolt)));
  fireEvent.click(screen.getByRole('button', { name: 'Chiudi esito danno' }));
  expect(screen.queryByText('Bro · Fulmine')).not.toBeInTheDocument();

  const more = screen.getByRole('button', { name: 'Danni da confermare · 1' });
  more.focus();
  fireEvent.click(more);
  expect(screen.queryByRole('button', { name: MORE_DAMAGE })).not.toBeInTheDocument();
  expect(screen.getByText('Recupero il danno da confermare…')).toBeInTheDocument();
  act(() => listener(RECEIPT)[1].next(copyFor(bolt)));
  expect(screen.getByLabelText('Danno finale')).toHaveFocus();
  expect(screen.getAllByText('Danno subito')).toHaveLength(1);
});

test('damage arriving during a defense waits for the prompt to close and then opens in the corner', async () => {
  render(<GrigliataCombatInbox uid={uid} />);
  const [pending] = listener(PENDING);
  const defense = { ...request, id: 'req-1' };
  act(() => pending.next(server([defense])));
  expect(defenseField()).toHaveFocus();
  expect(screen.queryByText('Danno subito')).not.toBeInTheDocument();

  const bolt = immediate('req-9', { seconds: 2, name: 'Lia', placementId: 'map__lia' });
  act(() => pending.next(server([defense, bolt])));
  const dialog = screen.getByRole('dialog', { name: 'Difesa' });
  expect(within(dialog).queryByText('Lia · Fulmine')).not.toBeInTheDocument();
  expect(defenseField()).toHaveFocus();
  expect(openReceiptListeners()).toHaveLength(0);

  // Once the defense closes, both outcomes are available together in the corner.
  mutate.mockResolvedValueOnce({ data: { ...HIT_REPLY.data, outcome: 'resisted', damage: null } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Tira Difesa' }));
  expect(mutate).toHaveBeenLastCalledWith({ defense: 2, command: 'defend', combatId: 'combat-1', targetPlacementId: 'map__bro', round: 1 });
  act(() => pending.next(server([bolt])));
  expect(await screen.findByText('Colpo evitato')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByText('Lia · Fulmine')).toBeInTheDocument();
  expect(listener(RECEIPT)).toHaveLength(1);
  act(() => listener(RECEIPT)[0].next(copyFor(bolt)));
  expect(screen.getByLabelText('Danno finale')).toHaveValue('9');
  expect(screen.queryByRole('button', { name: MORE_DAMAGE })).not.toBeInTheDocument();
});
