import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { GrigliataCombatPanel } from './GrigliataCombatPanel';
import { GrigliataDefensePopup } from './GrigliataDefensePopup';

jest.mock('../common/MediaImage', () => () => null);

const actor = { placementId: 'nyx', tokenId: 'token-nyx', name: 'Nyx', ownerUid: 'nyx-user', hp: 14, mana: 2, essenza: 4 };
const target = { placementId: 'bro', tokenId: 'token-bro', name: 'bro', ownerUid: 'bro-user', col: 4, row: 5 };
const secondTarget = { ...target, placementId: 'bro-copy', col: 6 };
const sword = {
  id: 'weaponMain', kind: 'weapon', name: 'Spada', mode: 'single', hands: 1,
  attackLabel: 'Mira', attackBonus: 3, attackDie: true, die: 12, attackStat: 5,
  defenseStats: ['Difesa'], defenseDie: true, opposed: true, damageExpr: '2d4',
};
const spell = {
  id: 'fulmine', channel: 'Consenso', kind: 'spell', name: 'Fulmine', mode: 'multiple', minTargets: 2,
  maxTargets: 2, baseCost: 7, cost: 4, rangeFt: 30, actionEconomy: 'Tattica',
  targetRoles: ['Vittima', 'Destinatario'], extraResource: { name: 'Essenza', amount: 1 },
  checks: [
    { channel: 'TPC', attackLabel: 'Anima', attackBonus: 3, attackDie: true, defenseStats: ['Disciplina'], defenseDie: true, opposed: true },
    { channel: 'Consenso', consent: true, opposed: true },
  ],
};
const placementIds = [target.placementId, secondTarget.placementId];

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
});

test('shows equipped weapons and submits a selected multi-target spell with explicit resource confirmation', () => {
  const onLaunch = jest.fn();
  const onBeginTargeting = jest.fn();
  function Panel() {
    const [selection, setSelection] = useState({ actionId: 'weaponMain', targetIds: [target.placementId] });
    return (
      <GrigliataCombatPanel
        actor={actor}
        actions={[sword, spell]}
        equipped={{ weaponMain: { name: 'Spada', hands: 1 }, weaponOff: { name: 'Scudo piccolo', hands: 1 } }}
        targets={[target, secondTarget]}
        selection={selection}
        onSelectAction={(action) => setSelection({ actionId: action.id, targetIds: [] })}
        onBeginTargeting={(action) => {
          onBeginTargeting(action);
          setSelection({ actionId: action.id, targetIds: placementIds });
        }}
        onLaunch={onLaunch}
      />
    );
  }

  render(<Panel />);
  expect(screen.getByText('Scudo piccolo')).toBeInTheDocument();
  expect(screen.getByText('d12 + 3')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Spell' }));
  expect(screen.getByRole('button', { name: /Fulmine/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Lancia spell' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Scegli bersagli sulla mappa/ }));
  expect(onBeginTargeting).toHaveBeenCalledWith(spell);
  expect(screen.getByText(/Vittima · bro/)).toBeInTheDocument();
  expect(screen.getByText(/Destinatario · bro/)).toBeInTheDocument();
  const launch = screen.getByRole('button', { name: 'Lancia spell' });
  expect(launch).toBeDisabled();
  expect(screen.getByLabelText('Prova')).toHaveValue('Consenso');
  fireEvent.change(screen.getByLabelText('Prova'), { target: { value: 'TPC' } });
  fireEvent.click(screen.getByLabelText('Spendi 2 PF'));
  fireEvent.click(screen.getByLabelText('Spendi 1 Essenza'));
  fireEvent.click(launch);
  expect(onLaunch).toHaveBeenCalledWith(spell, expect.objectContaining({
    targetPlacementIds: placementIds, confirmHp: true, maxHpCost: 2, confirmExtra: true, channel: 'TPC',
  }));
});

test('uses the selected map cell for area actions and the actor for personal actions', () => {
  const onLaunch = jest.fn();
  const area = { id: 'area', kind: 'spell', name: 'Tempesta', cost: 0, mode: 'area', area: { shape: 'square', sideSquares: 3 } };
  const personal = { id: 'personal', kind: 'tecnica', name: 'Parata', cost: 0, mode: 'self' };
  const { rerender } = render(
    <GrigliataCombatPanel actor={actor} actions={[area]} selection={{ actionId: area.id, targetIds: [], point: { col: 2, row: 3 } }} onLaunch={onLaunch} />
  );

  expect(screen.getByText('Casella 3, 4')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Lancia spell' }));
  expect(onLaunch).toHaveBeenLastCalledWith(area, expect.objectContaining({ targetPlacementIds: [], point: { col: 2, row: 3 } }));

  rerender(<GrigliataCombatPanel actor={actor} actions={[personal]} selection={{ actionId: personal.id }} onLaunch={onLaunch} />);
  fireEvent.click(screen.getByRole('button', { name: 'Usa tecnica' }));
  expect(onLaunch).toHaveBeenLastCalledWith(personal, expect.objectContaining({ targetPlacementIds: [actor.placementId] }));
});

test('the chosen check leads to the map only when it uses an attack die', () => {
  const onPrepareLaunch = jest.fn();
  const onLaunch = jest.fn();
  render(<GrigliataCombatPanel
    actor={{ ...actor, mana: 4 }} actions={[{ ...spell, die: 12, extraResource: null }]}
    selection={{ actionId: spell.id, targetIds: placementIds }}
    targets={[target, secondTarget]} onLaunch={onLaunch} onPrepareLaunch={onPrepareLaunch}
  />);
  fireEvent.click(screen.getByRole('button', { name: 'Lancia spell' }));
  expect(onLaunch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ channel: 'Consenso' }));
  expect(onPrepareLaunch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Prova'), { target: { value: 'TPC' } });
  fireEvent.click(screen.getByRole('button', { name: 'Vai al tiro sulla mappa' }));
  expect(onPrepareLaunch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ channel: 'TPC' }));
  expect(onLaunch).toHaveBeenCalledTimes(1);
});

test('a hit offers the attacker its damage throw while another target awaits defense', () => {
  const onRollDamage = jest.fn();
  const hit = { ...target, status: 'done', outcome: 'hit', round: 2, pendingDamage: { round: 2, expr: '2d4' } };
  const event = { id: 'mixed', actor, action: sword, kind: 'weapon', status: 'waiting',
    targets: [hit, { ...secondTarget, name: 'Nebbia', status: 'waiting', round: 1 }] };
  const { rerender } = render(<GrigliataCombatPanel actor={actor} pending={[event]} onRollDamage={onRollDamage} />);
  expect(screen.getByText('Tocca al proprietario')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Danno contro bro · vai al tiro sulla mappa' }));
  expect(onRollDamage).toHaveBeenCalledWith(event, hit);
  rerender(<GrigliataCombatPanel actor={actor} pending={[event]} onRollDamage={onRollDamage}
    isRollRecorded={(action, pawn) => action === event && pawn === hit} />);
  expect(screen.queryByRole('button', { name: /Danno contro bro/ })).not.toBeInTheDocument();
  expect(screen.getByText('Tiro registrato')).toBeVisible();
});

test('shows per-target rolls and offers a retry from the pending list, never from the journal alone', () => {
  const onRetry = jest.fn();
  const attack = { label: 'Mira', total: 12, bonus: 3, sides: 12, rolls: [9] };
  const defense = { label: 'Difesa', total: 12, bonus: 2, sides: 12, rolls: [10] };
  const waiting = { ...target, attack, defense, status: 'retry', round: 1, trials: [{ round: 1, attack, defense, outcome: 'tie' }] };
  const event = { id: 'action-1', actor, action: sword, kind: 'weapon', targets: [waiting], status: 'retry', cost: { mana: 0, hp: 0 } };
  const { rerender } = render(<GrigliataCombatPanel actor={actor} events={[event]} pending={[event]} onRetry={onRetry} />);

  fireEvent.click(screen.getByRole('button', { name: /Rilancia.*bro/ }));
  expect(onRetry).toHaveBeenCalledWith(event, waiting);
  fireEvent.click(screen.getByText('Registro'));
  fireEvent.click(screen.getByText('Parità · rilancio', { selector: '.gc-log-caption span' }));
  expect(screen.getByText('Prova 1')).toBeVisible();
  expect(screen.getByText('d12 · 9 + 3 = 12')).toBeVisible();
  rerender(<GrigliataCombatPanel actor={actor} events={[event]} onRetry={onRetry} />);
  expect(screen.queryByRole('button', { name: /Rilancia.*bro/ })).not.toBeInTheDocument();
});

const defenseRequest = {
  id: 'action-1-bro',
  combatId: 'action-1',
  ownerUid: target.ownerUid,
  actor,
  target,
  action: sword,
  attack: { label: 'Mira', total: 12, bonus: 3, sides: 12, rolls: [9] },
  round: 1,
  status: 'waiting',
  defense: { label: 'Difesa', value: 2, die: 12, reduction: 1, showDie: true, showReduction: true },
};

test('automatically opens the authenticated owner’s request, allows postponing, and sends defense with the exact request', async () => {
  const onRespond = jest.fn();
  const { rerender } = render(
    <GrigliataDefensePopup currentUserId="other-user" requests={[defenseRequest]} onRespond={onRespond} />
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  rerender(<GrigliataDefensePopup currentUserId={target.ownerUid} requests={[defenseRequest]} onRespond={onRespond} />);

  let dialog = screen.getByRole('dialog', { name: 'Difesa' });
  expect(within(dialog).getByText('d12 · 9 + 3 = 12')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Più tardi' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Difesa · 1/ }));
  dialog = screen.getByRole('dialog', { name: 'Difesa' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Tira Difesa' }));
  expect(onRespond).toHaveBeenCalledWith(defenseRequest, { defense: 2, die: 12, reduction: 1 });
  // Nothing came back and the request still waits: its prompt is answerable again.
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Tira Difesa' })).toBeEnabled());
});

test('queues each defender separately and opens a new round after a tie', async () => {
  const consent = {
    ...defenseRequest, id: 'action-1-copy', target: secondTarget,
    defense: { consent: true, label: 'Consenso' },
  };
  const onRespond = jest.fn();
  const props = { currentUserId: target.ownerUid, onRespond };
  const { rerender } = render(<GrigliataDefensePopup {...props} requests={[defenseRequest, consent]} />);

  rerender(<GrigliataDefensePopup {...props} requests={[consent, defenseRequest]} />);
  expect(screen.getByRole('button', { name: 'Tira Difesa' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Più tardi' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rifiuta' }));
  expect(onRespond).toHaveBeenLastCalledWith(consent, { consent: false });
  rerender(<GrigliataDefensePopup {...props} requests={[{ ...defenseRequest, status: 'retry' }]} />);
  // The answer keeps its prompt only while it is on its way.
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  rerender(<GrigliataDefensePopup {...props} requests={[{ ...defenseRequest, round: 2 }]} />);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('a consent prompt shows what is being accepted; an opposed prompt and older requests read as before', () => {
  const benedizione = {
    id: 'benedizione', kind: 'spell', name: 'Benedizione', damageExpr: '1d8', healExpr: '1d4', manualEffect: '',
    description: 'Il bersaglio recupera vigore e il suo prossimo colpo infligge danni sacri.',
  };
  const consent = { ...defenseRequest, id: 'blessing-bro', action: benedizione, attack: null, defense: { consent: true, label: 'Consenso' } };
  const props = { currentUserId: target.ownerUid, onRespond: jest.fn() };
  const { rerender } = render(<GrigliataDefensePopup {...props} requests={[consent]} />);
  const dialog = () => screen.getByRole('dialog', { name: 'Difesa' });
  expect(within(dialog()).getByText('Danno 1d8 · Cura 1d4')).toBeInTheDocument();
  expect(within(dialog()).getByText(benedizione.description)).toHaveClass('gc-source');
  expect(within(dialog()).getByRole('button', { name: 'Accetta' })).toBeInTheDocument();

  rerender(<GrigliataDefensePopup {...props} requests={[{ ...consent, action: { name: 'Rito', manualEffect: '+2 Difesa fino al tuo turno' } }]} />);
  expect(within(dialog()).getByText('+2 Difesa fino al tuo turno')).toHaveClass('gc-source');
  expect(within(dialog()).queryByText(/Danno|Cura/)).not.toBeInTheDocument();

  rerender(<GrigliataDefensePopup {...props} requests={[{ ...consent, action: { name: 'Vecchia carta' } }]} />);
  expect(within(dialog()).queryByText('+2 Difesa fino al tuo turno')).not.toBeInTheDocument();
  expect(within(dialog()).queryByText(/Danno|Cura/)).not.toBeInTheDocument();
  expect(within(dialog()).getByText('Vuoi accettare l’effetto per questa pedina?')).toBeInTheDocument();

  rerender(<GrigliataDefensePopup {...props} requests={[{ ...defenseRequest, action: benedizione }]} />);
  expect(within(dialog()).getByRole('button', { name: 'Tira Difesa' })).toBeInTheDocument();
  expect(within(dialog()).queryByText('Danno 1d8 · Cura 1d4')).not.toBeInTheDocument();
  expect(within(dialog()).queryByText(benedizione.description)).not.toBeInTheDocument();
});

test('requires the confirmed PF cost to match the current mana balance and variable cost', () => {
  const onLaunch = jest.fn();
  const action = { id: 'arma-segreta', kind: 'tecnica', name: 'Arma segreta', mode: 'manual', variableCost: 'Costo concordato' };
  const props = { actions: [action], selection: { actionId: action.id }, onLaunch };
  const { rerender } = render(<GrigliataCombatPanel {...props} actor={actor} />);
  fireEvent.change(screen.getByLabelText(/Mana da spendere/), { target: { value: '4' } });
  fireEvent.click(screen.getByLabelText('Spendi 2 PF'));
  rerender(<GrigliataCombatPanel {...props} actor={{ ...actor, mana: 1 }} />);
  expect(screen.getByLabelText('Spendi 3 PF')).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Usa tecnica' })).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Spendi 3 PF'));
  fireEvent.change(screen.getByLabelText(/Mana da spendere/), { target: { value: '3' } });
  expect(screen.getByLabelText('Spendi 2 PF')).not.toBeChecked();
  fireEvent.click(screen.getByLabelText('Spendi 2 PF'));
  fireEvent.click(screen.getByRole('button', { name: 'Usa tecnica' }));
  expect(onLaunch).toHaveBeenCalledWith(action, expect.objectContaining({ variableCost: 3, confirmHp: true, maxHpCost: 2 }));
});

test.each([undefined, null, -2])('requires full PF confirmation when the pawn has %s PM', mana => {
  const onLaunch = jest.fn();
  const action = { id: 'sforzo', kind: 'tecnica', name: 'Sforzo', mode: 'manual', cost: 4 };
  render(<GrigliataCombatPanel actor={{ ...actor, mana }} actions={[action]} selection={{ actionId: action.id }} onLaunch={onLaunch} />);

  const submit = screen.getByRole('button', { name: 'Usa tecnica' });
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Spendi 4 PF'));
  fireEvent.click(submit);
  expect(onLaunch).toHaveBeenCalledWith(action, expect.objectContaining({ confirmHp: true, maxHpCost: 4 }));
});

test('allows a reaction outside the actor’s turn and keeps tactical actions disabled', () => {
  const onLaunch = jest.fn();
  const reaction = { id: 'opportunita', kind: 'tecnica', name: 'Attacco d’opportunità', mode: 'single', actionEconomy: 'Reazione' };
  const turn = { name: 'bro', canAct: false };
  const props = { actor, turn, targets: [target], onLaunch };
  const selection = { targetIds: [target.placementId] };
  const { rerender } = render(
    <GrigliataCombatPanel {...props} actions={[sword]} selection={{ ...selection, actionId: sword.id }} />
  );
  expect(screen.getByRole('button', { name: 'Attacca' })).toBeDisabled();
  expect(screen.getByText('Turno di bro')).toBeInTheDocument();

  rerender(<GrigliataCombatPanel {...props} actions={[reaction]} selection={{ ...selection, actionId: reaction.id }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Usa tecnica' }));
  expect(onLaunch).toHaveBeenCalledWith(reaction, expect.objectContaining({ targetPlacementIds: [target.placementId] }));
});

test('uses a foe die and confirms the result to the owner even after the request is cleared', async () => {
  const request = { ...defenseRequest, defense: { ...defenseRequest.defense, die: 6 } };
  const onRespond = jest.fn().mockResolvedValue({ outcome: 'resisted', damage: null });
  const props = { currentUserId: target.ownerUid, onRespond };
  const { rerender } = render(<GrigliataDefensePopup {...props} requests={[request]} />);

  expect(screen.getByLabelText('Dado Anima')).toHaveValue(6);
  fireEvent.click(screen.getByRole('button', { name: 'Tira Difesa' }));
  expect(onRespond).toHaveBeenCalledWith(request, expect.objectContaining({ die: 6 }));
  rerender(<GrigliataDefensePopup {...props} requests={[]} />);
  expect(await screen.findByText('Colpo evitato')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Chiudi esito difesa' }));
  expect(screen.queryByText('Colpo evitato')).not.toBeInTheDocument();
});

test('records a confirmed critical for the attacker and shows its result to other viewers', () => {
  const onCritical = jest.fn();
  const hit = { ...target, outcome: 'hit', status: 'done', round: 1, damage: 7 };
  const event = { id: 'critical', actor, actorUid: actor.ownerUid, kind: 'weapon', action: sword, targets: [hit], status: 'done' };
  const { rerender } = render(<GrigliataCombatPanel actor={actor} currentUserId={actor.ownerUid} events={[event]} onCritical={onCritical} />);
  fireEvent.click(screen.getByText('Registro'));
  fireEvent.click(screen.getByText('Colpo a segno · 7 danni proposti', { selector: '.gc-log-caption span' }));
  fireEvent.click(screen.getByText('Critico da tabella'));
  const score = screen.getByLabelText('Punteggio concordato nel Codex');
  const submit = screen.getByRole('button', { name: 'Calcola il critico' });
  fireEvent.change(score, { target: { value: '42' } });
  expect(submit).toBeDisabled();
  fireEvent.change(score, { target: { value: '13' } });
  fireEvent.click(submit);
  expect(onCritical).toHaveBeenCalledWith(event, hit, 13);

  const result = { score: 13, multiplier: 'x1', effect: 'Attacco furtivo + Impedimento', total: 10, roll: 3, bonus: 0, reduction: 1 };
  const committed = { ...event, targets: [{ ...hit, critical: result }] };
  rerender(<GrigliataCombatPanel currentUserId={target.ownerUid} events={[committed]} onCritical={onCritical} />);
  expect(screen.queryByLabelText('Punteggio concordato nel Codex')).not.toBeInTheDocument();
  expect(screen.getByText('13 · x1')).toBeVisible();
  expect(screen.getByText('Attacco furtivo + Impedimento')).toBeVisible();
});

test('shows a physical technique hit and separates its weapon dice from final damage', () => {
  const hit = {
    ...target,
    outcome: 'hit',
    status: 'done',
    damage: 14,
    damageDetails: { raw: 8, subtotal: 11, reduction: 2, hands: 2 },
  };
  const event = {
    id: 'physical-technique',
    actor,
    kind: 'tecnica',
    action: { id: 'attack', name: 'Attacco', hands: 2, damageExpr: '3d4' },
    status: 'done',
    targets: [hit],
    effects: [
      { kind: 'manual', label: 'Effetto da confermare al tavolo', amount: null },
      { kind: 'damage', label: 'Danno base', expr: '3d4', amount: 14, targetPlacementId: hit.placementId },
    ],
  };
  const { rerender } = render(<GrigliataCombatPanel events={[event]} />);
  fireEvent.click(screen.getByText('Registro'));
  fireEvent.click(screen.getByText('Colpo a segno · 14 danni proposti'));
  expect(screen.getByText('3d4 → 8')).toBeVisible();
  expect(screen.getByText('max(0, 11 − 2 RD) × 1,5 = 14 (arrotondato per eccesso)')).toBeVisible();

  rerender(<GrigliataCombatPanel events={[{ ...event, targets: [{ ...hit, damageDetails: null }] }]} />);
  expect(screen.getByText('14')).toBeVisible();
  expect(screen.queryByText('3d4 → 14')).not.toBeInTheDocument();
});


test('names the ordered role being chosen with its own range, then says when every role is filled', () => {
  const leone = {
    id: 'parte-del-leone', kind: 'tecnica', name: 'Parte del Leone', mode: 'multiple', minTargets: 2, maxTargets: 2,
    rangeFt: 5, targetRoles: ['Bersaglio dell’attacco', 'Te o un alleato da curare'], roleRangesFt: [5, 30],
  };
  const props = { actor, actions: [leone], targets: [target, secondTarget], onBeginTargeting: jest.fn() };
  const { rerender } = render(<GrigliataCombatPanel {...props} selection={{ actionId: leone.id, targetIds: [] }} />);
  expect(screen.getByText('Scegli bersaglio dell’attacco · 5 ft')).toBeInTheDocument();
  rerender(<GrigliataCombatPanel {...props} selection={{ actionId: leone.id, targetIds: [target.placementId] }} />);
  expect(screen.getByText('Scegli te o un alleato da curare · 30 ft')).toBeInTheDocument();
  rerender(<GrigliataCombatPanel {...props} selection={{ actionId: leone.id, targetIds: placementIds }} />);
  expect(screen.getByText('Tutti i ruoli scelti')).toBeInTheDocument();
  expect(screen.getByText(/Te o un alleato da curare · bro/)).toBeInTheDocument();
});

test('shows an item-granted spell’s source, charge-only cost, unspecified range and the distance band per target', () => {
  const singolarita = {
    id: 'item:weaponMain:singolarita', kind: 'spell', scope: 'equipped', name: 'Singolarità', mode: 'single',
    sourceItem: 'Bacchetta del vuoto', cost: 0, baseCost: 0, extraResource: { name: 'Cariche', amount: 3 },
    damageBands: [
      { minFt: 0, maxFt: 10, expr: '3d10', note: 'Attacco Furtivo' },
      { minFt: 15, maxFt: 30, expr: '2d10 + 1d4', note: '' },
    ],
  };
  const free = { id: 'luce', kind: 'spell', name: 'Luce', mode: 'self', cost: 0 };
  const near = { ...target, distanceFt: 20 };
  const props = { actor, actions: [singolarita, free], targets: [near], onLaunch: jest.fn() };
  const { rerender } = render(
    <GrigliataCombatPanel {...props} selection={{ actionId: singolarita.id, actionKind: 'spell', targetIds: [near.placementId] }} />
  );
  const card = screen.getByRole('button', { name: /Singolarità/ });
  expect(within(card).getByText('3 Cariche')).toBeInTheDocument();
  expect(within(card).getByText('Bacchetta del vuoto')).toBeInTheDocument();
  expect(within(screen.getByRole('button', { name: /Luce/ })).getByText('0 PM')).toBeInTheDocument();
  expect(screen.getByText('Concesso da')).toBeInTheDocument();
  expect(screen.getByText('Danno a 0–10 ft')).toBeInTheDocument();
  expect(screen.getByText('3d10')).toBeInTheDocument();
  expect(screen.getByText(/· Attacco Furtivo/)).toBeInTheDocument();
  expect(screen.getByText('Danno a 15–30 ft')).toBeInTheDocument();
  expect(screen.getByText('2d10 + 1d4')).toBeInTheDocument();
  expect(screen.getByText('Non indicata sulla carta · da concordare al tavolo')).toBeInTheDocument();
  expect(screen.getByText('bro · a 20 ft · 2d10 + 1d4')).toBeInTheDocument();
  expect(screen.getAllByText('3 Cariche')).toHaveLength(2);
  fireEvent.click(screen.getByLabelText('Usa 3 Cariche (da scalare al tavolo)'));
  fireEvent.click(screen.getByRole('button', { name: 'Lancia spell' }));
  expect(props.onLaunch).toHaveBeenCalledWith(singolarita, expect.objectContaining({ confirmExtra: true }));

  rerender(
    <GrigliataCombatPanel {...props} targets={[{ ...near, distanceFt: 40 }]} selection={{ actionId: singolarita.id, actionKind: 'spell', targetIds: [near.placementId] }} />
  );
  expect(screen.getByText('bro · a 40 ft · fascia da concordare al tavolo')).toBeInTheDocument();
});

test('a cone action says that membership is agreed at the table', () => {
  const fiammata = { id: 'fiammata', kind: 'spell', name: 'Fiammata', cost: 2, mode: 'area', rangeFt: 15, area: { shape: 'cone' } };
  render(<GrigliataCombatPanel actor={actor} actions={[fiammata]} selection={{ actionId: fiammata.id, targetIds: [] }} onBeginTargeting={jest.fn()} />);
  expect(screen.getByText(/Scegli le pedine nel cono concordato al tavolo/)).toBeInTheDocument();
  expect(screen.queryByText(/Non indicata sulla carta/)).not.toBeInTheDocument();
});

test('the defender receipt states the outcome from the defender’s side with both rolls and the proposed damage', async () => {
  const spellRequest = {
    ...defenseRequest, defense: { label: 'Disciplina', value: 0 },
    action: { ...spell, name: 'Fulmine', description: 'Impedisce il prossimo movimento.' },
  };
  const onRespond = jest.fn().mockResolvedValue({
    outcome: 'hit', damage: 17, effects: [{ kind: 'damage', amount: 17, targetPlacementId: target.placementId }],
    attack: { label: 'Anima', total: 23, bonus: 3, sides: 20, rolls: [20] },
    defense: { label: 'Disciplina', total: 1, bonus: 0, sides: 20, rolls: [1] },
  });
  render(<GrigliataDefensePopup currentUserId={target.ownerUid} requests={[spellRequest]} onRespond={onRespond} />);
  fireEvent.click(screen.getByRole('button', { name: 'Invia Disciplina' }));
  expect(await screen.findByText('Non hai resistito')).toBeVisible();
  const card = within(screen.getByRole('dialog')).getByRole('status');
  expect(within(card).getByText('bro · Fulmine')).toBeInTheDocument();
  expect(within(card).getByText('d20 · 20 + 3 = 23')).toBeInTheDocument();
  expect(within(card).getByText(/Anima\s+contro la tua Disciplina/)).toBeInTheDocument();
  expect(within(card).getByText('d20 · 1 = 1')).toBeInTheDocument();
  expect(within(card).getByText('17 danni proposti')).toBeInTheDocument();
  expect(within(card).queryByText(/Prova superata/)).not.toBeInTheDocument();
  expect(within(card).getByText('Impedisce il prossimo movimento.')).toHaveClass('gc-source');
});

test('answering a queue keeps every outcome in view: above the next prompt, then together once the queue is empty', async () => {
  const second = { ...defenseRequest, id: 'action-2-bro', combatId: 'action-2', target: secondTarget };
  const onRespond = jest.fn()
    .mockResolvedValueOnce({ outcome: 'resisted', damage: null })
    .mockResolvedValueOnce({ outcome: 'hit', damage: 9 });
  const props = { currentUserId: target.ownerUid, onRespond };
  const { rerender } = render(<GrigliataDefensePopup {...props} requests={[defenseRequest, second]} />);

  fireEvent.click(screen.getByRole('button', { name: 'Tira Difesa' }));
  rerender(<GrigliataDefensePopup {...props} requests={[second]} />);
  const dialog = screen.getByRole('dialog', { name: 'Difesa' });
  expect(await within(dialog).findByText('Colpo evitato')).toBeVisible();
  expect(within(dialog).getByRole('status')).toHaveTextContent('Colpo evitato');
  expect(within(dialog).getByRole('spinbutton', { name: 'Difesa' })).toHaveFocus();

  fireEvent.click(within(dialog).getByRole('button', { name: 'Tira Difesa' }));
  expect(onRespond).toHaveBeenLastCalledWith(second, expect.objectContaining({ defense: 2 }));
  rerender(<GrigliataDefensePopup {...props} requests={[]} />);
  expect(await screen.findByText('Colpito')).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const feed = screen.getByRole('status');
  expect(within(feed).getByText('Colpo evitato')).toBeVisible();
  expect(within(feed).getByText('9 danni proposti')).toBeVisible();
  // The corner stack lists the newest first in the DOM (shown at the bottom), so the older outcome is second.
  fireEvent.click(within(feed).getAllByRole('button', { name: 'Chiudi esito difesa' })[1]);
  expect(screen.queryByText('Colpo evitato')).not.toBeInTheDocument();
  expect(screen.getByText('Colpito')).toBeVisible();
});

test('while the arsenal reloads the launch waits for it, then works again', () => {
  const onLaunch = jest.fn();
  const props = { actor, targets: [target], onLaunch, actions: [sword], selection: { actionId: sword.id, targetIds: [target.placementId] } };
  const { rerender } = render(<GrigliataCombatPanel {...props} arsenalSync="reloading" />);
  const button = screen.getByRole('button', { name: 'Aggiornamento…' });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(onLaunch).not.toHaveBeenCalled();

  // After a failed reload the arsenal is shown but not launchable; the error offers the reload.
  rerender(<GrigliataCombatPanel {...props} arsenalSync="failed" />);
  expect(screen.getByRole('button', { name: 'Attacca' })).toBeDisabled();

  rerender(<GrigliataCombatPanel {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Attacca' }));
  expect(onLaunch).toHaveBeenCalledTimes(1);
});
