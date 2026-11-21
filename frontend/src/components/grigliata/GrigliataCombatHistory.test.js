import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { GrigliataCombatHistory, GrigliataCombatStatus } from './GrigliataCombatHistory';

const orc = { placementId: 'map__orc', name: 'Orco' };
const goblin = { placementId: 'map__goblin', name: 'Goblin' };
const bro = { placementId: 'map__bro', name: 'bro', ownerUid: 'bro-user' };
const attack = { label: 'Mira', total: 12, bonus: 3, sides: 12, rolls: [9] };
const tie = {
  id: 'tie', actor: orc, action: { id: 'weaponMain', name: 'Spada', hands: 1 }, kind: 'weapon', status: 'retry',
  targets: [{ ...bro, attack, status: 'retry', round: 1 }],
};
const waiting = {
  id: 'waiting', actor: goblin, action: { id: 'weaponOff', name: 'Arco', hands: 2 }, kind: 'weapon', status: 'waiting',
  targets: [{ ...bro, attack, status: 'waiting', round: 1 }],
};
const done = {
  id: 'done', actor: orc, action: { id: 'cura', name: 'Cura' }, kind: 'spell', status: 'done',
  targets: [{ ...bro, status: 'done', outcome: 'applied' }], effects: [{ kind: 'heal', amount: 6 }],
};
// Each card opens with its title, so the cards in order must start with these.
const expectCards = (...titles) => {
  const cards = screen.queryAllByRole('region', { name: 'Stato dell’azione' });
  expect(cards).toHaveLength(titles.length);
  titles.forEach((title, index) => expect(cards[index]).toHaveTextContent(new RegExp('^' + title)));
};

test('an unanswered action keeps its reroll although the journal no longer lists it', () => {
  const onRetry = jest.fn();
  const { rerender } = render(<GrigliataCombatStatus actor={orc} pending={[tie]} events={[]} onRetry={onRetry} />);

  expectCards('Spada');
  fireEvent.click(screen.getByRole('button', { name: 'Rilancia contro bro' }));
  expect(onRetry).toHaveBeenCalledWith(tie, tie.targets[0]);
  rerender(<GrigliataCombatStatus actor={undefined} pending={[tie]} events={[]} onRetry={onRetry} />);
  expectCards('Spada');
  rerender(<GrigliataCombatStatus actor={goblin} pending={[tie]} events={[]} onRetry={onRetry} />);
  expectCards('Orco · Spada');
});

test('every pending action of the player stays, named by pawn, whichever pawn is selected', () => {
  const props = { pending: [waiting, tie], events: [], onRetry: jest.fn() };
  const { rerender } = render(<GrigliataCombatStatus {...props} actor={orc} />);

  expectCards('Goblin · Arco', 'Orco · Spada');
  rerender(<GrigliataCombatStatus {...props} actor={goblin} />);
  expect(screen.getByRole('button', { name: 'Rilancia contro bro' })).toBeInTheDocument();
  rerender(<GrigliataCombatStatus {...props} actor={undefined} />);
  expectCards('Goblin · Arco', 'Orco · Spada');
  expect(screen.getByRole('button', { name: 'Rilancia contro bro' })).toBeInTheDocument();
});

test('the selected pawn’s latest result follows the pending queue and never doubles an entry', () => {
  const { rerender } = render(<GrigliataCombatStatus actor={orc} pending={[tie]} events={[done, tie]} />);
  expectCards('Spada', 'Cura');

  rerender(<GrigliataCombatStatus actor={orc} pending={[tie]} events={[{ ...tie, status: 'done' }]} />);
  expectCards('Spada');
  rerender(<GrigliataCombatStatus actor={orc} pending={[]} events={[tie]} />);
  expectCards();
  rerender(<GrigliataCombatStatus actor={goblin} pending={[]} events={[done]} />);
  expectCards();
});

const at = ms => ({ toMillis: () => ms });

test('the latest result is the action answered last, even when newer ones were launched before it', () => {
  const late = {
    id: 'late', actor: orc, action: { id: 'weaponMain', name: 'Spada', hands: 1 }, kind: 'weapon', status: 'done',
    targets: [{ ...bro, status: 'done', outcome: 'hit', damage: 7 }], createdAt: at(1), resolvedAt: at(30),
  };
  const quick = { ...done, createdAt: at(5), resolvedAt: at(6) };
  const { rerender } = render(<GrigliataCombatStatus actor={orc} pending={[]} events={[quick, late]} />);
  expectCards('Spada');
  expect(screen.getByRole('status')).toHaveTextContent('Colpo a segno · 7 danni proposti');

  // A server timestamp not committed yet reads null: the answer time falls back to the launch time.
  rerender(<GrigliataCombatStatus actor={orc} pending={[]} events={[quick, { ...late, resolvedAt: null }]} />);
  expectCards('Cura');
});

test('a table-resolved card shows its own instruction and the charges it used; older entries read as before', () => {
  const manual = { kind: 'manual', label: 'Effetto da confermare al tavolo', expr: '', amount: null, targetPlacementId: null };
  const rift = {
    id: 'rift', actor: orc, kind: 'spell', status: 'done', targets: [{ ...bro, status: 'done', outcome: 'applied' }],
    effects: [manual, { ...manual, label: 'Fascia di danno da concordare al tavolo · 40 ft', targetPlacementId: bro.placementId }],
    action: {
      id: 'item:weaponMain:fenditura', name: 'Fenditura Temporale', sourceItem: 'Clessidra',
      manualEffect: '+10 Mira / +10 Critico alla prossima azione tattica', extraResource: { name: 'Cariche', amount: 1 },
    },
    cost: { mana: 0, hp: 0, essenza: 0, extra: { name: 'Cariche', amount: 1 } },
  };
  const essence = {
    ...rift, id: 'essence', effects: [], action: { id: 'lama', name: 'Lama d’essenza', manualEffect: '' },
    cost: { mana: 4, hp: 0, essenza: 1, extra: { name: 'Essenza', amount: 1 } },
  };
  const legacy = { ...rift, id: 'legacy', effects: [manual], action: { id: 'vecchia', name: 'Vecchia carta' }, cost: { mana: 3, hp: 0 } };
  const { rerender } = render(<GrigliataCombatHistory events={[rift]} />);
  expect(screen.getByText('1 Carica')).toBeInTheDocument();
  expect(screen.getByText('+10 Mira / +10 Critico alla prossima azione tattica')).toHaveClass('gc-source');
  expect(screen.queryByText('Effetto da confermare al tavolo')).not.toBeInTheDocument();
  expect(screen.getByText('Fascia di danno da concordare al tavolo · 40 ft · bro')).toBeInTheDocument();

  rerender(<GrigliataCombatHistory events={[essence]} />);
  expect(screen.getByText('4 PM + 1 Essenza')).toBeInTheDocument();

  rerender(<GrigliataCombatHistory events={[legacy]} />);
  expect(screen.getByText('3 PM')).toBeInTheDocument();
  expect(screen.getByText('Effetto da confermare al tavolo')).toBeInTheDocument();
  expect(screen.getByText('Da applicare al tavolo')).toBeInTheDocument();
});

test('a critical that needs a table roll never reads as a final number; older criticals read as before', () => {
  const critical = { score: 30, multiplier: 'x2', effect: 'Sanguinamento', total: 9, roll: 4, bonus: 0, reduction: 1, tableRoll: 'max(0, 6 + x1 (2d6 + Forza) − 1 RD)' };
  const event = {
    id: 'crit', actor: orc, kind: 'weapon', status: 'done', action: { id: 'weaponMain', name: 'Spada', hands: 1 },
    targets: [{ ...bro, status: 'done', outcome: 'hit', damage: 7, critical }],
  };
  const { rerender } = render(<GrigliataCombatHistory events={[event]} />);
  expect(screen.getByText('Critico · da calcolare al tavolo', { selector: '.gc-log-caption span' })).toBeInTheDocument();
  expect(screen.getByText('max(0, 6 + x1 (2d6 + Forza) − 1 RD) · da calcolare al tavolo', { selector: 'dd' })).toBeInTheDocument();

  rerender(<GrigliataCombatStatus actor={orc} pending={[]} events={[event]} />);
  expect(screen.getByRole('status')).toHaveTextContent('Critico · da calcolare al tavolo');

  const { tableRoll, ...legacy } = critical;
  rerender(<GrigliataCombatHistory events={[{ ...event, targets: [{ ...event.targets[0], critical: legacy }] }]} />);
  expect(screen.getByText('Critico · 9 danni proposti', { selector: '.gc-log-caption span' })).toBeInTheDocument();
  expect(screen.getByText('9', { selector: 'dd' })).toBeInTheDocument();
  expect(screen.queryByText(/da tirare al tavolo/)).not.toBeInTheDocument();
});

test('a rolled spell keeps its card text and table instruction next to the damage; a weapon never logs its item text', () => {
  const barriera = {
    id: 'barriera', actor: orc, kind: 'spell', status: 'done', targets: [{ ...bro, status: 'done', outcome: 'hit', damage: 17 }],
    effects: [{ kind: 'damage', label: 'Danno', expr: '3d10', amount: 17, targetPlacementId: bro.placementId }],
    action: { id: 'barriera', name: 'Barriera Cosmica', damageExpr: '3d10', manualEffect: '', description: 'Impedisce il prossimo movimento.' },
  };
  const tecnica = { ...barriera, id: 'presa', kind: 'tecnica', action: { ...barriera.action, manualEffect: 'Il bersaglio è afferrato.' } };
  const sword = { ...barriera, id: 'spada', kind: 'weapon', action: { id: 'weaponMain', name: 'Spada', hands: 1, manualEffect: '', description: 'Forgiata nel Nord.' } };
  const { rerender } = render(<GrigliataCombatHistory events={[barriera]} />);
  expect(screen.getByText('3d10 → 17')).toBeInTheDocument();
  expect(screen.getByText('Impedisce il prossimo movimento.')).toHaveClass('gc-source');

  // A table instruction and the card's own condition are both kept, once each.
  rerender(<GrigliataCombatHistory events={[tecnica]} />);
  expect(screen.getByText(/Il bersaglio è afferrato\.\s+Impedisce il prossimo movimento\./)).toHaveClass('gc-source');
  rerender(<GrigliataCombatHistory events={[{ ...tecnica, action: { ...tecnica.action, description: 'Il bersaglio è afferrato.' } }]} />);
  expect(screen.getByText('Il bersaglio è afferrato.')).toHaveClass('gc-source');

  rerender(<GrigliataCombatHistory events={[sword]} />);
  expect(screen.queryByText('Forgiata nel Nord.')).not.toBeInTheDocument();
});

const blade = { id: 'weaponMain', name: 'Spada', hands: 1 };
const lia = { placementId: 'map__lia', name: 'Lia', ownerUid: 'lia-user' };
const struck = extra => ({ ...bro, status: 'done', outcome: 'hit', round: 1, damage: 7, ...extra });
const volley = (targets, extra) => ({
  id: 'volley', actor: orc, actorUid: 'orc-user', kind: 'weapon', status: 'done', action: blade, targets, ...extra,
});
const openLog = (caption = 'Spada') => {
  fireEvent.click(screen.getByText('Registro'));
  fireEvent.click(screen.getByText(caption, { selector: '.gc-log-caption strong' }));
};
const damageForm = name => screen.getByRole('form', { name: 'Applica danno a ' + name });
const damageField = name => within(damageForm(name)).getByLabelText('Danno finale');
const applyButton = name => within(damageForm(name)).getByRole('button', { name: /^(Applica danno|Applicazione…)$/ });

test('the DM gets one damage form per landed target, prefilled with the proposal, and may apply any whole number including 0', () => {
  const onApplyDamage = jest.fn();
  const event = volley([struck(), { ...lia, status: 'done', outcome: 'resisted', round: 1, damage: null }, { ...goblin, status: 'waiting', round: 1 }]);
  const { rerender } = render(<GrigliataCombatHistory events={[event]} onApplyDamage={onApplyDamage} />);
  openLog();

  expect(screen.getAllByRole('form', { name: /^Applica danno a / })).toHaveLength(1);
  const field = damageField('bro');
  expect(field).toHaveValue('7');
  expect(field).toBeRequired();
  expect(field).toHaveAttribute('inputmode', 'numeric');
  fireEvent.change(field, { target: { value: '0' } });
  fireEvent.click(applyButton('bro'));
  expect(onApplyDamage).toHaveBeenCalledTimes(1);
  expect(onApplyDamage).toHaveBeenCalledWith(event, event.targets[0], 0);
  // The amount sent stays in the field.
  expect(field).toHaveValue('0');

  // Without the command (the narration overlay, the player preview) there is no form.
  rerender(<GrigliataCombatHistory events={[event]} />);
  expect(screen.queryByRole('form', { name: /Applica danno/ })).not.toBeInTheDocument();
});

test('a spell offers the damage it names for each pawn; healing and an area suggestion bound to no pawn offer nothing', () => {
  const event = {
    id: 'drain', actor: orc, kind: 'spell', status: 'done', action: { id: 'drain', name: 'Prosciuga' },
    targets: [{ ...bro, status: 'done', outcome: 'accepted' }, { ...lia, status: 'done', outcome: 'applied' }],
    effects: [
      { kind: 'damage', label: 'Danno proposto', expr: '2d6', amount: 8, targetPlacementId: bro.placementId },
      { kind: 'heal', label: 'Cura proposta', expr: '1d6', amount: 4, targetPlacementId: lia.placementId },
      { kind: 'damage', label: 'Danno proposto', expr: '1d6', amount: 3, targetPlacementId: null },
    ],
  };
  render(<GrigliataCombatHistory events={[event]} onApplyDamage={jest.fn()} />);
  openLog('Prosciuga');
  expect(screen.getAllByRole('form', { name: /^Applica danno a / })).toHaveLength(1);
  expect(damageField('bro')).toHaveValue('8');
});

test('a critical still to roll at the table leaves the field blank beside its formula; an empty or invalid amount is refused in place', () => {
  const onApplyDamage = jest.fn();
  const tableRoll = 'max(0, 6 + x1 (2d6 + Forza) − 1 RD)';
  const critical = { score: 30, multiplier: 'x2', effect: 'Sanguinamento', total: 9, roll: 4, bonus: 0, reduction: 1, tableRoll };
  render(<GrigliataCombatHistory events={[volley([struck({ critical })])]} onApplyDamage={onApplyDamage} />);
  openLog();

  const field = damageField('bro');
  expect(field).toHaveValue('');
  expect(field).toHaveAccessibleDescription(tableRoll);
  fireEvent.click(applyButton('bro'));
  expect(onApplyDamage).not.toHaveBeenCalled();
  expect(within(damageForm('bro')).getByRole('alert')).toHaveTextContent('Indica il danno finale: un numero intero da 0 in su.');
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(field).toHaveFocus();

  fireEvent.change(field, { target: { value: '-3' } });
  expect(field).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(field, { target: { value: '1.5' } });
  fireEvent.click(applyButton('bro'));
  expect(onApplyDamage).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: '12' } });
  expect(field).not.toHaveAttribute('aria-invalid');
  expect(within(damageForm('bro')).queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(applyButton('bro'));
  expect(onApplyDamage).toHaveBeenCalledWith(expect.objectContaining({ id: 'volley' }), expect.objectContaining({ critical }), 12);
});

test('an application in flight is sent once and holds the critical still; a refusal stays by the form for a retry', () => {
  const onApplyDamage = jest.fn();
  let state = {};
  const event = volley([struck()]);
  const view = () => (
    <GrigliataCombatHistory
      events={[event]} currentUserId="orc-user" onCritical={jest.fn()} onApplyDamage={onApplyDamage} damageState={() => state}
    />
  );
  const { rerender } = render(view());
  openLog();
  fireEvent.change(damageField('bro'), { target: { value: '9' } });
  fireEvent.click(applyButton('bro'));
  expect(onApplyDamage).toHaveBeenCalledTimes(1);

  state = { busy: true };
  rerender(view());
  expect(applyButton('bro')).toHaveTextContent('Applicazione…');
  expect(applyButton('bro')).toHaveAttribute('aria-disabled', 'true');
  expect(damageForm('bro')).toHaveAttribute('aria-busy', 'true');
  expect(damageField('bro')).toHaveAttribute('readonly');
  fireEvent.click(applyButton('bro'));
  fireEvent.submit(damageForm('bro'));
  expect(onApplyDamage).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Critico da tabella'));
  expect(screen.getByRole('button', { name: 'Calcola il critico' })).toBeDisabled();

  state = { error: 'Il critico è cambiato: controlla il danno.' };
  rerender(view());
  expect(within(damageForm('bro')).getByRole('alert')).toHaveTextContent('Il critico è cambiato: controlla il danno.');
  expect(damageField('bro')).toHaveValue('9');
  expect(damageField('bro')).toHaveAccessibleDescription('Il critico è cambiato: controlla il danno.');
  expect(applyButton('bro')).toHaveTextContent('Applica danno');
  fireEvent.click(applyButton('bro'));
  expect(onApplyDamage).toHaveBeenCalledTimes(2);
  expect(onApplyDamage).toHaveBeenLastCalledWith(event, event.targets[0], 9);
});

test('applied damage, 0 included, replaces the form and the critical controls for every viewer, and takes the DM’s focus', () => {
  let state = {};
  const event = volley([struck()]);
  const recorded = volley([struck({ damageApplied: { amount: 0 } })]);
  const view = (events, extra) => (
    <GrigliataCombatHistory events={events} currentUserId="orc-user" onCritical={jest.fn()} damageState={() => state} {...extra} />
  );
  const { rerender } = render(view([event], { onApplyDamage: jest.fn() }));
  openLog();
  expect(screen.getByText('Critico da tabella')).toBeInTheDocument();
  damageField('bro').focus();
  fireEvent.click(applyButton('bro'));

  // The reply arrives before the snapshot: the form gives way and focus follows the confirmation.
  state = { applied: { amount: 5 } };
  rerender(view([event], { onApplyDamage: jest.fn() }));
  expect(screen.queryByRole('form', { name: /Applica danno/ })).not.toBeInTheDocument();
  expect(screen.queryByText('Critico da tabella')).not.toBeInTheDocument();
  expect(screen.getByText('Danno applicato · 5')).toHaveFocus();

  // The recorded amount wins, 0 included, for the DM and for the players alike.
  rerender(view([recorded], { onApplyDamage: jest.fn() }));
  expect(screen.getByText('Danno applicato · 0')).toBeVisible();
  state = {};
  rerender(view([recorded]));
  expect(screen.getByText('Danno applicato · 0')).toBeVisible();
  expect(screen.queryByText('Critico da tabella')).not.toBeInTheDocument();
});

test('a DM working elsewhere hears the application instead of losing their place', () => {
  let state = {};
  const event = volley([struck()]);
  const view = () => (
    <>
      <button type="button">Altro</button>
      <GrigliataCombatHistory events={[event]} onApplyDamage={jest.fn()} damageState={() => state} />
    </>
  );
  const { rerender } = render(view());
  openLog();
  fireEvent.click(applyButton('bro'));
  screen.getByRole('button', { name: 'Altro' }).focus();
  state = { applied: { amount: 7 } };
  rerender(view());
  expect(screen.getByRole('button', { name: 'Altro' })).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('Danno applicato a bro: 7.');
});

test('a critical that changes under the form updates an untouched amount and flags a typed one', () => {
  const onApplyDamage = jest.fn();
  const view = critical => <GrigliataCombatHistory events={[volley([struck({ critical })])]} onApplyDamage={onApplyDamage} />;
  const { rerender } = render(view(null));
  openLog();
  expect(damageField('bro')).toHaveValue('7');

  rerender(view({ score: 13, multiplier: 'x1', effect: '–', total: 15, roll: 3, bonus: 0, reduction: 1, tableRoll: '' }));
  expect(damageField('bro')).toHaveValue('15');
  fireEvent.change(damageField('bro'), { target: { value: '11' } });
  rerender(view({ score: 14, multiplier: 'x1', effect: 'Disorientamento', total: 15, roll: 3, bonus: 0, reduction: 1, tableRoll: '' }));
  expect(damageField('bro')).toHaveAccessibleDescription(/Danno proposto aggiornato: 15\./);
  expect(applyButton('bro')).toHaveAttribute('aria-disabled', 'true');
  fireEvent.submit(damageForm('bro'));
  expect(onApplyDamage).not.toHaveBeenCalled();
  rerender(view({ score: 20, multiplier: 'x2', effect: '–', total: 18, roll: 4, bonus: 0, reduction: 1, tableRoll: '' }));
  expect(damageField('bro')).toHaveValue('11');
  expect(damageField('bro')).toHaveAccessibleDescription(/Danno proposto aggiornato: 18\./);

  rerender(view({ score: 30, multiplier: 'x2', effect: '–', total: 9, roll: 4, bonus: 0, reduction: 1, tableRoll: '2d6 + 4' }));
  expect(damageField('bro')).toHaveValue('11');
  expect(screen.getByText('Il critico va ora calcolato al tavolo.')).toBeInTheDocument();
  const reset = screen.getByRole('button', { name: 'Usa la proposta' });
  reset.focus();
  fireEvent.click(reset);
  expect(damageField('bro')).toHaveFocus();
  expect(damageField('bro')).toHaveValue('');
  expect(damageField('bro')).toHaveAccessibleDescription('2d6 + 4');
});

test('within one action only the targets the viewer answers for get a form; the others keep just their receipt and no hint', () => {
  const onApplyDamage = jest.fn();
  const canApplyDamage = jest.fn((event, target) => target.ownerUid === 'lia-user');
  const event = volley([struck({ damageApplied: { amount: 4 } }), { ...lia, status: 'done', outcome: 'hit', round: 1, damage: 6 }, struck({ ...goblin, ownerUid: 'gob-user' })]);
  render(
    <GrigliataCombatHistory
      events={[event]} onApplyDamage={onApplyDamage} canApplyDamage={canApplyDamage} damageState={() => ({ unavailable: false })}
    />
  );
  openLog();
  expect(screen.getAllByRole('form', { name: /^Applica danno a / })).toEqual([damageForm('Lia')]);
  expect(screen.getByText('Danno applicato · 4')).toBeInTheDocument();
  expect(screen.queryByText('Bersaglio non più sulla mappa.')).not.toBeInTheDocument();
  expect(canApplyDamage).toHaveBeenCalledWith(event, event.targets[2]);
  fireEvent.click(applyButton('Lia'));
  expect(onApplyDamage).toHaveBeenCalledWith(event, event.targets[1], 6);
});

test('a private summary names no attacker, says what it shows and leaves the critical to the attacker', () => {
  const event = {
    id: 'ambush', ownerPrivate: true, status: 'done', kind: 'weapon', actor: { name: 'Attaccante nascosto' },
    action: { name: 'Pugnale', hands: 1 },
    targets: [{ ...lia, status: 'done', outcome: 'hit', round: 1, damage: 6, critical: { score: 13, multiplier: 'x1', total: 9 } }],
  };
  const onApplyDamage = jest.fn();
  render(<GrigliataCombatHistory events={[event]} currentUserId="lia-user" onCritical={jest.fn()} onApplyDamage={onApplyDamage} />);
  openLog('Pugnale');
  expect(screen.getByText(/^Attaccante nascosto/, { selector: '.gc-log-caption small' })).toHaveTextContent('Attaccante nascostoLia');
  expect(screen.getByText('Critico · 9 danni proposti')).toBeInTheDocument();
  expect(screen.getByText('Riepilogo privato: solo l’esito sulle tue pedine.')).toBeInTheDocument();
  expect(screen.queryByText('Critico da tabella')).not.toBeInTheDocument();
  expect(damageField('Lia')).toHaveValue('9');
  fireEvent.click(applyButton('Lia'));
  expect(onApplyDamage).toHaveBeenCalledWith(event, event.targets[0], 9);
});
