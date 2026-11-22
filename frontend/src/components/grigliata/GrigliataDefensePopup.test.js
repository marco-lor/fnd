import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { GrigliataDefensePopup, receiptOwnerDamage } from './GrigliataDefensePopup';

const uid = 'bro-user';
const pawn = name => ({ placementId: 'map__' + name.toLowerCase(), name });
const defenseRequest = (id, name = 'Bro', extra) => ({
  id, combatId: 'combat-' + id, backgroundId: 'map', ownerUid: uid, status: 'waiting', round: 1,
  actor: { name: 'Nyx' }, target: pawn(name), action: { name: 'Spada', kind: 'weapon', hands: 1 },
  attack: { label: 'Mira', total: 12 }, defense: { label: 'Difesa', value: 2 }, ...extra,
});
const HIT = { outcome: 'hit', damage: 9, effects: [] };
// The server's private copy for one request, with what the defender's own reply never decides.
const ownerCopy = (request, target, extra) => ({
  ownerUid: uid, backgroundId: 'map', combatId: request.combatId,
  ownerDamage: {
    kind: 'weapon', action: { name: 'Spada', hands: 1 },
    target: {
      placementId: request.target.placementId, name: request.target.name, ownerUid: uid, status: 'done', round: 1,
      outcome: 'hit', damage: 9, critical: null, damageApplied: null, ...target,
    },
  },
  ...extra,
});
const deferred = () => {
  const handle = {};
  handle.promise = new Promise((resolve, reject) => Object.assign(handle, { resolve, reject }));
  return handle;
};

let watches;
let onWatchDamage;
const live = requestId => watches.filter(watch => watch.requestId === requestId && !watch.stop.mock.calls.length);
const emit = (request, data, fromCache = false) => act(() => {
  live(request.id).at(-1).next({ id: request.id, data, fromCache });
});
const damageForm = name => screen.queryByRole('form', { name: 'Applica danno a ' + name });
const amountOf = name => within(damageForm(name)).getByLabelText('Danno finale');

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };
  watches = [];
  onWatchDamage = jest.fn((requestId, observer) => {
    const watch = { requestId, ...observer, stop: jest.fn() };
    watches.push(watch);
    return watch.stop;
  });
});

function setup(requests, { answers = [HIT], onApplyDamage = jest.fn() } = {}) {
  const onRespond = jest.fn();
  answers.forEach(answer => onRespond.mockResolvedValueOnce(answer));
  const props = { currentUserId: uid, onRespond, onWatchDamage, onApplyDamage };
  const view = render(<GrigliataDefensePopup {...props} requests={requests} />);
  const show = (list, extra) => view.rerender(<GrigliataDefensePopup {...props} {...extra} requests={list} />);
  // Answers the prompt shown, lets the host drop the answered request as the pending listener does, and waits for its receipt.
  const answer = async (answered, rest) => {
    fireEvent.click(screen.getByRole('button', { name: 'Invia Difesa' }));
    show(rest);
    await screen.findByText(answered.target.name + ' · ' + answered.action.name);
  };
  return { ...view, props, onRespond, onApplyDamage, show, answer };
}

test('only a landed answer with concrete damage follows its own private request, and the form waits for the server’s copy', async () => {
  const request = defenseRequest('req-a');
  const { answer } = setup([request]);
  await answer(request, []);

  expect(onWatchDamage).toHaveBeenCalledTimes(1);
  expect(onWatchDamage).toHaveBeenCalledWith('req-a', expect.objectContaining({ next: expect.any(Function), error: expect.any(Function) }));
  expect(screen.getByText('Recupero il danno da confermare…')).toBeInTheDocument();
  expect(damageForm('Bro')).not.toBeInTheDocument();

  // A cached copy may predate the answer: still waiting, even when it already carries the damage.
  emit(request, { ...request, status: 'waiting' }, true);
  emit(request, ownerCopy(request), true);
  expect(damageForm('Bro')).not.toBeInTheDocument();
  expect(screen.getByText('Recupero il danno da confermare…')).toBeInTheDocument();

  emit(request, ownerCopy(request, { damage: 7 }));
  expect(screen.queryByText('Recupero il danno da confermare…')).not.toBeInTheDocument();
  expect(amountOf('Bro')).toHaveValue('7');
  expect(within(damageForm('Bro')).getByRole('button', { name: 'Applica danno' })).toBeInTheDocument();
});

test('a fresh waiting copy read during submission does not settle an eventual damage receipt', async () => {
  const request = defenseRequest('req-a');
  const reply = deferred();
  const { onRespond, show } = setup([request], { answers: [] });
  onRespond.mockReturnValueOnce(reply.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Invia Difesa' }));
  emit(request, request);
  show([]);
  await act(async () => reply.resolve(HIT));
  expect(screen.getByText('Recupero il danno da confermare…')).toBeVisible();
  emit(request, ownerCopy(request));
  expect(amountOf('Bro')).toHaveValue('9');
});

test('a guided defense watches for the attacker’s damage and does not open a second receipt when the request is listed', async () => {
  const request = defenseRequest('req-guided');
  const { answer, show } = setup([request], { answers: [{ outcome: 'hit', damagePending: true }] });
  await answer(request, []);
  expect(screen.getByText('In attesa che l’attaccante tiri il danno.')).toBeVisible();
  expect(damageForm('Bro')).not.toBeInTheDocument();
  const pending = ownerCopy(request, {}, { status: 'damagePending', id: request.id, defense: request.defense });
  show([], { activeDamageBackgroundId: 'map', damageRequests: [pending] });
  emit(request, pending);
  expect(screen.getAllByText('Bro · Spada')).toHaveLength(1);
  expect(screen.queryByText('In attesa che l’attaccante tiri il danno.')).not.toBeInTheDocument();
  expect(amountOf('Bro')).toHaveValue('9');
});

test('reopening guided damage on another device preserves the private defense label', () => {
  const request = defenseRequest('req-guided', 'Bro', { defense: { label: 'Disciplina' } });
  const pending = ownerCopy(request, {}, { status: 'damagePending', id: request.id, defense: request.defense });
  render(<GrigliataDefensePopup currentUserId={uid} onRespond={jest.fn()} onWatchDamage={onWatchDamage}
    onApplyDamage={jest.fn()} activeDamageBackgroundId="map" damageRequests={[pending]} />);
  expect(screen.getByText('Disciplina')).toBeVisible();
  expect(screen.queryByText('Nessuna difesa richiesta')).not.toBeInTheDocument();
  emit(request, pending);
  expect(amountOf('Bro')).toHaveValue('9');
});

test('a settled guided defense without a damage proposal closes without leaving a launcher', async () => {
  const request = defenseRequest('req-no-damage', 'Bro', { action: { name: 'Singolarità', kind: 'spell', damageExpr: '1d4-3' } });
  const { answer, show } = setup([request], { answers: [{ outcome: 'hit', damagePending: true }] });
  await answer(request, []);
  emit(request, { ...request, status: 'done' });
  expect(screen.getByText('In attesa che l’attaccante tiri il danno.')).toBeVisible();
  emit(request, { ...request, status: 'done', damagePending: false });
  expect(screen.getByText('Nessun danno da applicare')).toBeVisible();
  expect(damageForm('Bro')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Chiudi esito difesa' }));
  expect(screen.queryByText('Nessun danno da applicare')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Danni da confermare/ })).not.toBeInTheDocument();
  show([]);
  expect(screen.queryByRole('button', { name: /Danni da confermare/ })).not.toBeInTheDocument();
});

test('a guided defense closed before a negative roll loses its launcher as soon as the private request settles', async () => {
  const request = defenseRequest('req-late-negative', 'Bro', { action: { name: 'Singolarità', kind: 'spell', damageExpr: '1d4-3' } });
  const { answer } = setup([request], { answers: [{ outcome: 'hit', damagePending: true }] });
  await answer(request, []);
  emit(request, { ...request, status: 'done', damagePending: true });
  const [watch] = live(request.id);
  fireEvent.click(screen.getByRole('button', { name: 'Chiudi esito difesa' }));
  expect(screen.getByRole('button', { name: 'Danni da confermare · 1' })).toBeVisible();
  expect(live(request.id)).toEqual([watch]);

  const settled = { ...request, status: 'done', damagePending: false };
  emit(request, settled, true);
  expect(screen.getByRole('button', { name: 'Danni da confermare · 1' })).toBeVisible();
  emit(request, settled);
  expect(screen.queryByRole('button', { name: /Danni da confermare/ })).not.toBeInTheDocument();
  expect(watch.stop).toHaveBeenCalledTimes(1);
  expect(live(request.id)).toHaveLength(0);
});

test.each([0, 6])('a late guided proposal of %s stays accessible as the owner query takes over', async amount => {
  const request = defenseRequest('req-late-proposal');
  const { answer, show } = setup([request], { answers: [{ outcome: 'hit', damagePending: true }] });
  await answer(request, []);
  const [watch] = live(request.id);
  fireEvent.click(screen.getByRole('button', { name: 'Chiudi esito difesa' }));
  expect(live(request.id)).toEqual([watch]);

  const settled = ownerCopy(request, { damage: amount }, {
    status: 'damagePending', target: request.target, damagePending: false, id: request.id, defense: request.defense,
  });
  emit(request, settled);
  expect(live(request.id)).toEqual([watch]);
  show([], { damageRequests: [settled], activeDamageBackgroundId: 'map' });
  expect(watch.stop).toHaveBeenCalledTimes(1);
  expect(live(request.id)).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Danni da confermare · 1' }));
  expect(live(request.id)).toHaveLength(1);
  expect(damageForm('Bro')).not.toBeInTheDocument();
  expect(screen.getByText('Recupero il danno da confermare…')).toBeVisible();
  emit(request, settled);
  expect(amountOf('Bro')).toHaveValue(String(amount));
  expect(screen.getAllByText('Bro · Spada')).toHaveLength(1);
});

test.each([null, 0, 9])('a guided receipt can be reopened while pending or with a concrete damage proposal of %s', async amount => {
  const request = defenseRequest('req-reopen-guided');
  const { answer } = setup([request], { answers: [{ outcome: 'hit', damagePending: true }] });
  await answer(request, []);
  const copy = amount === null ? { ...request, status: 'done', damagePending: true }
    : ownerCopy(request, { damage: amount }, { status: 'damagePending', target: request.target, damagePending: false });
  emit(request, copy);
  fireEvent.click(screen.getByRole('button', { name: 'Chiudi esito difesa' }));
  fireEvent.click(screen.getByRole('button', { name: 'Danni da confermare · 1' }));
  emit(request, copy);
  expect({
    waiting: Boolean(screen.queryByText('In attesa che l’attaccante tiri il danno.')),
    amount: screen.queryByLabelText('Danno finale')?.value ?? null,
  }).toEqual({ waiting: amount === null, amount: amount === null ? null : String(amount) });
});

const CONSENT = { action: { name: 'Rito', kind: 'spell' }, defense: { consent: true, label: 'Consenso' } };
test.each([
  ['a resisted hit', { outcome: 'resisted', damage: null, effects: [] }, 'Colpo evitato', {}, 'Invia Difesa'],
  ['a hit without a damage roll', { outcome: 'hit', damage: null, effects: [] }, 'Colpito', {}, 'Invia Difesa'],
  ['a consent with healing only', { outcome: 'accepted', damage: null, effects: [{ kind: 'heal', amount: 3, targetPlacementId: 'map__bro' }] }, 'Effetto accettato', CONSENT, 'Accetta'],
  ['a consent refused', { outcome: 'declined', damage: null, effects: [] }, 'Effetto rifiutato', CONSENT, 'Rifiuta'],
])('%s has a dismissible receipt until cancellation and no damage form', async (_label, reply, outcomeText, extra, button) => {
  const request = defenseRequest('req-a', 'Bro', extra);
  const { show } = setup([request], { answers: [reply] });
  fireEvent.click(screen.getByRole('button', { name: button }));
  show([]);
  expect(await screen.findByText(outcomeText)).toBeInTheDocument();
  expect(damageForm('Bro')).not.toBeInTheDocument();
  expect(screen.queryByText('Recupero il danno da confermare…')).not.toBeInTheDocument();
  emit(request, { ...request, status: 'cancelled' });
  expect(screen.queryByText(outcomeText)).not.toBeInTheDocument();
});

test('an accepted effect with a numeric damage on this pawn gets the form too', async () => {
  const request = defenseRequest('req-a', 'Bro', { action: { name: 'Fulmine', kind: 'spell' }, defense: { consent: true, label: 'Consenso' } });
  const reply = { outcome: 'accepted', damage: null, effects: [{ kind: 'damage', amount: 4, targetPlacementId: 'map__bro' }] };
  setup([request], { answers: [reply] });
  fireEvent.click(screen.getByRole('button', { name: 'Accetta' }));
  await screen.findByText('Effetto accettato');
  emit(request, ownerCopy(request, { outcome: 'accepted', damage: 4 }, { ownerDamage: undefined }));
  // The server has no damage for it after all: nothing to confirm, no lingering wait.
  expect(damageForm('Bro')).not.toBeInTheDocument();
  expect(screen.queryByText('Recupero il danno da confermare…')).not.toBeInTheDocument();
  emit(request, ownerCopy(request, { outcome: 'accepted', damage: 4 }));
  expect(amountOf('Bro')).toHaveValue('4');
});

test('a copy is read only for this owner, action, pawn, map and request, and only its damage fields', () => {
  const request = defenseRequest('req-a');
  const scope = { requestId: 'req-a', combatId: request.combatId, placementId: 'map__bro', ownerUid: uid, backgroundId: 'map' };
  const copy = ownerCopy(request, { attack: { total: 15 }, actor: 'Nyx' }, { actor: { name: 'Nyx' } });
  expect(receiptOwnerDamage({ id: 'req-a', data: copy }, scope)).toEqual({
    placementId: 'map__bro', name: 'Bro', ownerUid: uid, status: 'done', round: 1, outcome: 'hit', damage: 9,
    critical: null, damageApplied: null,
  });
  const target = copy.ownerDamage.target;
  [
    { id: 'req-b', data: copy },
    { id: 'req-a', data: null },
    { id: 'req-a', data: { ...copy, ownerUid: 'someone-else' } },
    { id: 'req-a', data: { ...copy, combatId: 'other-combat' } },
    { id: 'req-a', data: { ...copy, backgroundId: 'other-map' } },
    { id: 'req-a', data: { ...copy, ownerDamage: { ...copy.ownerDamage, target: { ...target, placementId: 'map__lia' } } } },
    { id: 'req-a', data: { ...copy, ownerDamage: { ...copy.ownerDamage, target: { ...target, ownerUid: 'someone-else' } } } },
  ].forEach(snapshot => expect(receiptOwnerDamage(snapshot, scope)).toBeNull());
});

test('a copy for someone else never fills the receipt', async () => {
  const request = defenseRequest('req-a');
  const { answer } = setup([request]);
  await answer(request, []);
  emit(request, ownerCopy(request, { ownerUid: 'someone-else' }, { ownerUid: 'someone-else' }));
  expect(damageForm('Bro')).not.toBeInTheDocument();
  expect(screen.queryByText('Recupero il danno da confermare…')).not.toBeInTheDocument();
});

test('the live critical sets the minimum, a table roll is left to the DM with its formula, and a changed critical holds a refused amount', async () => {
  const request = defenseRequest('req-a');
  const onApplyDamage = jest.fn().mockRejectedValueOnce(new Error('Il critico è cambiato: controlla il danno aggiornato.'));
  const { answer } = setup([request], { onApplyDamage });
  await answer(request, []);

  // The owner has no number to confirm for a critical rolled at the table.
  emit(request, ownerCopy(request, { critical: { score: 20, tableRoll: '2d6 + 3', total: 4 } }));
  expect(damageForm('Bro')).not.toBeInTheDocument();
  expect(screen.getByText('Critico da calcolare al tavolo: il danno lo applica il DM.')).toBeInTheDocument();
  expect(screen.getByText('2d6 + 3')).toBeInTheDocument();

  emit(request, ownerCopy(request));
  expect(amountOf('Bro')).toHaveAccessibleDescription('Minimo 9: puoi aumentarlo; per ridurlo chiedi al DM.');
  fireEvent.change(amountOf('Bro'), { target: { value: '6' } });
  fireEvent.click(within(damageForm('Bro')).getByRole('button', { name: 'Applica danno' }));
  expect(onApplyDamage).not.toHaveBeenCalled();
  expect(within(damageForm('Bro')).getByRole('alert')).toHaveTextContent('Il danno non può essere inferiore a 9: solo il DM può ridurlo.');
  fireEvent.change(amountOf('Bro'), { target: { value: '10' } });
  fireEvent.click(within(damageForm('Bro')).getByRole('button', { name: 'Applica danno' }));
  expect(onApplyDamage).toHaveBeenLastCalledWith({ combatId: 'combat-req-a', targetPlacementId: 'map__bro', amount: 10, criticalScore: null });
  expect(await within(damageForm('Bro')).findByRole('alert')).toHaveTextContent('Il critico è cambiato: controlla il danno aggiornato.');
  expect(amountOf('Bro')).toHaveValue('10');

  // The attacker confirms a critical: the refused amount stays, flagged, until the new proposal is taken.
  emit(request, ownerCopy(request, { critical: { score: 13, total: 14, tableRoll: '' } }));
  expect(within(damageForm('Bro')).getByText(/Danno proposto aggiornato: 14\./)).toBeInTheDocument();
  expect(screen.getByText('14 danni proposti')).toBeVisible();
  expect(screen.queryByText('9 danni proposti')).not.toBeInTheDocument();
  fireEvent.click(within(damageForm('Bro')).getByRole('button', { name: 'Applica danno' }));
  expect(onApplyDamage).toHaveBeenCalledTimes(1);
  fireEvent.click(within(damageForm('Bro')).getByRole('button', { name: 'Usa la proposta' }));
  expect(amountOf('Bro')).toHaveValue('14');
  onApplyDamage.mockResolvedValueOnce({ amount: 14 });
  fireEvent.click(within(damageForm('Bro')).getByRole('button', { name: 'Applica danno' }));
  expect(onApplyDamage).toHaveBeenLastCalledWith({ combatId: 'combat-req-a', targetPlacementId: 'map__bro', amount: 14, criticalScore: 13 });
  expect(await screen.findByText('Danno applicato · 14')).toBeInTheDocument();
  expect(damageForm('Bro')).not.toBeInTheDocument();
});

test('the DM confirming a pawn of theirs from Home sets any amount, a critical rolled at the table included', async () => {
  const request = defenseRequest('req-a');
  const onApplyDamage = jest.fn().mockResolvedValueOnce({ amount: 0 });
  const { answer, show } = setup([request], { onApplyDamage });
  await answer(request, []);
  show([], { isManager: true });
  emit(request, ownerCopy(request, { critical: { score: 20, tableRoll: '2d6 + 3', total: 4 } }));
  expect(amountOf('Bro')).toHaveValue('');
  expect(amountOf('Bro')).toHaveAccessibleDescription('2d6 + 3');
  expect(screen.queryByText(/il danno lo applica il DM/)).not.toBeInTheDocument();

  emit(request, ownerCopy(request));
  expect(amountOf('Bro')).toHaveAccessibleDescription('');
  fireEvent.change(amountOf('Bro'), { target: { value: '0' } });
  fireEvent.click(within(damageForm('Bro')).getByRole('button', { name: 'Applica danno' }));
  expect(onApplyDamage).toHaveBeenLastCalledWith({ combatId: 'combat-req-a', targetPlacementId: 'map__bro', amount: 0, criticalScore: null });
  expect(await screen.findByText('Danno applicato · 0')).toBeInTheDocument();
});

test('same-name pawns have distinct Home receipt and confirmation labels', async () => {
  const first = defenseRequest('req-a', 'Guardia', { target: { name: 'Guardia', placementId: 'map__guardia-a' } });
  const second = defenseRequest('req-b', 'Guardia', { target: { name: 'Guardia', placementId: 'map__guardia-b' } });
  const onApplyDamage = jest.fn().mockResolvedValue({ amount: 9 });
  const { answer, show } = setup([first, second], { answers: [HIT, HIT], onApplyDamage });
  await answer(first, [second]);
  emit(first, ownerCopy(first));
  fireEvent.click(screen.getByRole('button', { name: 'Invia Difesa' }));
  show([]);

  expect(await screen.findByText('Guardia · Pedina 2 · Spada')).toBeVisible();
  expect(screen.getByText('Guardia · Pedina 1 · Spada')).toBeVisible();
  emit(second, ownerCopy(second));
  expect(damageForm('Guardia · Pedina 1')).toBeVisible();
  fireEvent.click(within(damageForm('Guardia · Pedina 2')).getByRole('button', { name: 'Applica danno' }));
  expect(await screen.findByText('Danno applicato · 9')).toBeVisible();
  expect(onApplyDamage).toHaveBeenCalledWith(expect.objectContaining({ targetPlacementId: 'map__guardia-b' }));
});

test('an older cached copy cannot reactivate damage after the server records it', async () => {
  const request = defenseRequest('req-a');
  const { answer } = setup([request]);
  await answer(request, []);
  emit(request, ownerCopy(request, { damageApplied: { amount: 6 } }));
  expect(screen.getByText('Danno applicato · 6')).toBeVisible();
  emit(request, ownerCopy(request), true);
  expect(screen.getByText('Danno applicato · 6')).toBeVisible();
  expect(damageForm('Bro')).not.toBeInTheDocument();
});

test('one application in flight per pawn, and an application elsewhere first ends the form for good', async () => {
  const request = defenseRequest('req-a');
  const reply = deferred();
  const onApplyDamage = jest.fn(() => reply.promise);
  const { answer } = setup([request], { onApplyDamage });
  await answer(request, []);
  emit(request, ownerCopy(request));

  fireEvent.click(within(damageForm('Bro')).getByRole('button', { name: 'Applica danno' }));
  expect(within(damageForm('Bro')).getByRole('button', { name: 'Applicazione…' })).toHaveAttribute('aria-disabled', 'true');
  fireEvent.submit(damageForm('Bro'));
  expect(onApplyDamage).toHaveBeenCalledTimes(1);

  // The DM applied first: the copy says so, and the late reply carries the amount the server kept.
  emit(request, ownerCopy(request, { damageApplied: { amount: 8 } }));
  expect(screen.getByText('Danno applicato · 8')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Applica/ })).not.toBeInTheDocument();
  await act(async () => reply.resolve({ amount: 8 }));
  expect(screen.getAllByText('Danno applicato · 8')).toHaveLength(1);
  expect(screen.queryByRole('form', { name: /Applica danno/ })).not.toBeInTheDocument();
});

test('an application by the DM reaches a receipt nobody touched, and is announced there', async () => {
  const request = defenseRequest('req-a');
  const { answer } = setup([request]);
  await answer(request, []);
  emit(request, ownerCopy(request));
  emit(request, ownerCopy(request, { damageApplied: { amount: 0 } }));
  expect(screen.getByText('Danno applicato · 0')).toBeInTheDocument();
  expect(screen.getByText('Danno applicato a Bro: 0.')).toHaveClass('gc-sr-only');
  expect(damageForm('Bro')).not.toBeInTheDocument();
});

test('a queue keeps the prompt focused and each receipt keeps its sent amount and error between the dialog and the corner', async () => {
  const [first, second, third, fourth] = ['req-a', 'req-b', 'req-c', 'req-d'].map((id, index) => defenseRequest(id, ['Bro', 'Lia', 'Kai', 'Ume'][index]));
  const reply = deferred();
  const onApplyDamage = jest.fn(() => reply.promise);
  const { answer, show } = setup([first, second, third], {
    answers: [HIT, { outcome: 'resisted', damage: null, effects: [] }, { outcome: 'resisted', damage: null, effects: [] }],
    onApplyDamage,
  });

  await answer(first, [second, third]);
  emit(first, ownerCopy(first));
  const dialog = screen.getByRole('dialog', { name: 'Difesa' });
  expect(within(dialog).getByRole('form', { name: 'Applica danno a Bro' })).toBeInTheDocument();
  await answer(second, [third]);
  // A receipt's form above the next prompt never takes its focus.
  expect(within(dialog).getByRole('spinbutton', { name: 'Difesa' })).toHaveFocus();
  expect(within(dialog).getByText('Nyx → Kai')).toBeInTheDocument();

  fireEvent.change(amountOf('Bro'), { target: { value: '10' } });
  fireEvent.click(within(damageForm('Bro')).getByRole('button', { name: 'Applica danno' }));
  expect(onApplyDamage).toHaveBeenCalledWith({ combatId: 'combat-req-a', targetPlacementId: 'map__bro', amount: 10, criticalScore: null });

  // The last answer empties the queue: the receipt moves to the corner still sending, still refusing a second send.
  await answer(third, []);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(amountOf('Bro')).toHaveValue('10');
  expect(amountOf('Bro')).toHaveAttribute('readonly');
  fireEvent.submit(damageForm('Bro'));
  expect(onApplyDamage).toHaveBeenCalledTimes(1);
  await act(async () => reply.reject(new Error('Conferma non ricevuta. Riprova: un danno già registrato non viene applicato due volte.')));
  expect(within(damageForm('Bro')).getByRole('alert')).toHaveTextContent('Conferma non ricevuta.');

  // A new request brings the receipt back above it, amount and error intact, and the listener never reopened.
  show([fourth]);
  const reopened = screen.getByRole('dialog', { name: 'Difesa' });
  expect(within(reopened).getByRole('form', { name: 'Applica danno a Bro' })).toBeInTheDocument();
  expect(amountOf('Bro')).toHaveValue('10');
  expect(within(damageForm('Bro')).getByRole('alert')).toHaveTextContent('Conferma non ricevuta.');
  expect(within(reopened).getByRole('spinbutton', { name: 'Difesa' })).toHaveFocus();
  expect(onWatchDamage.mock.calls.filter(([requestId]) => requestId === first.id)).toHaveLength(1);
  expect(watches[0].stop).not.toHaveBeenCalled();
});

test('a private listener stays with a deferred receipt until it settles or the account changes', async () => {
  const requests = ['req-a', 'req-b', 'req-c', 'req-d', 'req-e'].map(id => defenseRequest(id, 'Bro ' + id));
  const { answer, show, unmount } = setup(requests, { answers: requests.map(() => HIT) });
  for (let index = 0; index < requests.length; index += 1) await answer(requests[index], requests.slice(index + 1));
  expect(onWatchDamage.mock.calls.map(([requestId]) => requestId)).toEqual(['req-a', 'req-b', 'req-c', 'req-d', 'req-e']);
  expect(watches.every(watch => !watch.stop.mock.calls.length)).toBe(true);
  expect(screen.queryByText('Bro req-a · Spada')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Danni da confermare · 1' })).toBeVisible();
  emit(requests[0], ownerCopy(requests[0], { damageApplied: { amount: 9 } }));
  expect(watches[0].stop).toHaveBeenCalledTimes(1);

  const feed = screen.getAllByRole('status')[0];
  // Newest first in the corner's DOM: the second button closes the receipt of req-d.
  fireEvent.click(within(feed).getAllByRole('button', { name: 'Chiudi esito difesa' })[1]);
  expect(screen.getByRole('button', { name: 'Danni da confermare · 1' })).toBeVisible();
  expect(watches.filter(watch => !watch.stop.mock.calls.length).map(watch => watch.requestId)).toEqual(['req-b', 'req-c', 'req-d', 'req-e']);

  show([], { currentUserId: 'lia-user' });
  expect(watches.every(watch => watch.stop.mock.calls.length === 1)).toBe(true);
  unmount();
  expect(watches.every(watch => watch.stop.mock.calls.length === 1)).toBe(true);
});

test('a popup that goes away closes every listener it opened', async () => {
  const request = defenseRequest('req-a');
  const { answer, unmount } = setup([request]);
  await answer(request, []);
  unmount();
  expect(watches[0].stop).toHaveBeenCalledTimes(1);
});

test('a lost private listener says what to do and reopens on request', async () => {
  const request = defenseRequest('req-a');
  const { answer } = setup([request]);
  await answer(request, []);
  emit(request, ownerCopy(request));
  act(() => watches[0].error(new Error('Missing or insufficient permissions.')));
  expect(damageForm('Bro')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Danno da confermare non aggiornato. Riprova; se non torna, applicalo dal Registro della mappa.');

  fireEvent.click(screen.getByRole('button', { name: 'Ricarica il danno' }));
  expect(onWatchDamage).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Recupero il danno da confermare…')).toBeInTheDocument();
  emit(request, ownerCopy(request));
  expect(amountOf('Bro')).toHaveValue('9');
});

test('a consent whose reply was lost keeps the answer given, puts its retry in focus and resends it as it was', async () => {
  const request = defenseRequest('req-a', 'Bro', CONSENT);
  const onRespond = jest.fn()
    .mockRejectedValueOnce(Object.assign(new Error('Conferma non ricevuta.'), { unconfirmed: true }))
    .mockResolvedValueOnce({ outcome: 'declined', damage: null, effects: [] });
  const props = { currentUserId: uid, onRespond, onWatchDamage, onApplyDamage: jest.fn() };
  const { rerender } = render(<GrigliataDefensePopup {...props} requests={[request]} />);
  const decline = screen.getByRole('button', { name: 'Rifiuta' });
  decline.focus();
  fireEvent.click(decline);
  rerender(<GrigliataDefensePopup {...props} requests={[]} />);

  const retry = await screen.findByRole('button', { name: 'Riprova' });
  expect(retry).toHaveFocus();
  expect(screen.getByText('Risposta inviata: Rifiuta.')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Conferma non ricevuta.');
  expect(screen.queryByRole('button', { name: 'Accetta' })).not.toBeInTheDocument();
  fireEvent.click(retry);
  expect(onRespond).toHaveBeenCalledTimes(2);
  expect(onRespond).toHaveBeenLastCalledWith(request, { consent: false });
  expect(await screen.findByText('Effetto rifiutato')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('a host that reports failures through its own error prop gets no hold', async () => {
  const request = defenseRequest('req-a');
  const reply = deferred();
  const onRespond = jest.fn(() => reply.promise);
  const props = { currentUserId: uid, onRespond };
  const { rerender } = render(<GrigliataDefensePopup {...props} requests={[request]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Invia Difesa' }));
  await act(async () => reply.resolve(undefined));
  expect(onRespond).toHaveBeenCalledTimes(1);
  rerender(<GrigliataDefensePopup {...props} requests={[request]} error="Risposta non inviata." />);
  expect(screen.getByRole('alert')).toHaveTextContent('Risposta non inviata.');
  expect(screen.getByRole('button', { name: 'Invia Difesa' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Riprova' })).not.toBeInTheDocument();
  rerender(<GrigliataDefensePopup {...props} requests={[]} error="Risposta non inviata." />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Difesa ·/ })).not.toBeInTheDocument();
});

test('without the damage host the receipts read as before', async () => {
  const request = defenseRequest('req-a');
  const onRespond = jest.fn().mockResolvedValue(HIT);
  const { rerender } = render(<GrigliataDefensePopup currentUserId={uid} onRespond={onRespond} requests={[request]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Invia Difesa' }));
  rerender(<GrigliataDefensePopup currentUserId={uid} onRespond={onRespond} requests={[]} />);
  expect(await screen.findByText('9 danni proposti')).toBeInTheDocument();
  expect(screen.queryByRole('form', { name: /Applica danno/ })).not.toBeInTheDocument();
  expect(screen.queryByText('Recupero il danno da confermare…')).not.toBeInTheDocument();
});

test('cancellation of a held send frees the next defense and ignores a late answer', async () => {
  const first = defenseRequest('req-a');
  const sibling = defenseRequest('req-b', 'Kai', { combatId: first.combatId });
  const next = defenseRequest('req-c', 'Lia');
  const last = defenseRequest('req-d', 'Eva');
  const late = deferred();
  const ongoing = deferred();
  const { onRespond, show } = setup([first, sibling, next, last], { answers: [] });
  onRespond.mockReturnValueOnce(late.promise).mockReturnValueOnce(ongoing.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Invia Difesa' }));
  show([sibling, next, last]);
  emit(first, { ...first, status: 'cancelled' });

  expect(screen.getByText('Nyx → Lia')).toBeVisible();
  expect(screen.getByRole('spinbutton', { name: 'Difesa' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Invia Difesa' }));
  await act(async () => late.resolve(HIT));
  expect(screen.queryByText('Bro · Spada')).not.toBeInTheDocument();
  expect(screen.getByText('Invio della risposta…')).toBeInTheDocument();
  expect(onRespond).toHaveBeenCalledTimes(2);
  expect(onRespond).toHaveBeenLastCalledWith(next, { defense: 2 });

  show([{ ...first, round: 2 }, sibling, last]);
  await act(async () => ongoing.resolve({ outcome: 'resisted' }));
  expect(screen.getByText('Nyx → Eva')).toBeVisible();
});

test('cancellation removes visible and dismissed receipts of the same combat while keeping another damage draft', async () => {
  const first = defenseRequest('req-a');
  const sibling = defenseRequest('req-b', 'Kai', { combatId: first.combatId });
  const other = defenseRequest('req-c', 'Lia');
  const late = deferred();
  const onApplyDamage = jest.fn(() => late.promise);
  const { answer, show } = setup([first, sibling, other], {
    answers: [HIT, { outcome: 'hit', damagePending: true }, HIT], onApplyDamage,
  });
  await answer(first, [sibling, other]);
  emit(first, ownerCopy(first));
  await answer(sibling, [other]);
  emit(sibling, { ...sibling, status: 'done', damagePending: true });
  const dialog = screen.getByRole('dialog', { name: 'Difesa' });
  const [, closeSibling] = within(dialog).getAllByRole('button', { name: 'Chiudi esito difesa' });
  fireEvent.click(closeSibling);
  await answer(other, []);
  emit(other, ownerCopy(other));
  fireEvent.change(amountOf('Lia'), { target: { value: '12' } });
  fireEvent.click(within(damageForm('Bro')).getByRole('button', { name: 'Applica danno' }));

  const [watch] = live(sibling.id);
  emit(sibling, { ...sibling, status: 'cancelled' });
  expect(screen.queryByText('Bro · Spada')).not.toBeInTheDocument();
  expect(damageForm('Bro')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Danni da confermare/ })).not.toBeInTheDocument();
  expect(amountOf('Lia')).toHaveValue('12');

  await act(async () => late.resolve({ amount: 9 }));
  act(() => watch.next({ id: sibling.id, data: ownerCopy(sibling), fromCache: true }));
  show([first, sibling]);
  expect(screen.queryByText('Danno applicato · 9')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(amountOf('Lia')).toHaveValue('12');
});
