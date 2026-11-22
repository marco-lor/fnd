import { combatDamageBand, combatRoleRange, picksGround } from './combatTargeting';

// Firestore Timestamp in ms; a server timestamp not committed yet reads null and counts as the newest.
export const combatTime = stamp => stamp?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;

export function attackDiceNotation(sides, count) {
  if (!sides) return 'Dado Anima';
  return count === 1 ? `d${sides}` : `${count}d${sides}`;
}

export function formatCombatRoll(roll) {
  if (!roll || roll.total == null) return '';
  if (!roll.rolls?.length) return String(roll.total);
  const prefix = roll.sides ? 'd' + roll.sides + ' · ' : '';
  const dice = roll.rolls.length > 1 ? 'max(' + roll.rolls.join(', ') + ')' : roll.rolls[0];
  return prefix + dice + (roll.bonus ? signedCombatModifier(roll.bonus) : '') + ' = ' + roll.total;
}

export function signedCombatModifier(value) {
  return value < 0 ? ' − ' + Math.abs(value) : ' + ' + value;
}

export function combatCheckLabel(stats = []) {
  return stats.length > 1 ? 'max(' + stats.join(', ') + ')' : stats[0] || 'Difesa';
}

export function formatCombatRange(action) {
  if (action.rangeText) return action.rangeText;
  if (!action.rangeFt) return '';
  const minimum = action.minRangeFt ? action.minRangeFt + '–' : '';
  return minimum + action.rangeFt + ' ft';
}

export const COMBAT_RANGE_UNSET = 'Non indicata sulla carta · da concordare al tavolo';
export const COMBAT_CONE_HINT = 'Scegli le pedine nel cono concordato al tavolo. Ogni proprietario risponde per la propria pedina.';

// Range in ft limiting the pick in progress (ordered roles use their own); null when nothing limits it.
export const combatStepRangeFt = (action, chosen = 0) => (
  action.targetRoles?.length && chosen >= action.targetRoles.length ? null : combatRoleRange(action, chosen)
);

export function combatStepRange(action, chosen = 0) {
  if (!action.targetRoles?.length) return formatCombatRange(action);
  const range = combatStepRangeFt(action, chosen);
  return range == null ? '' : range + ' ft';
}

// The ordered role being chosen, or that every role is filled; '' when the action has no roles.
export function combatRoleStep(action, chosen = 0) {
  const roles = action.targetRoles;
  if (!roles?.length) return '';
  return chosen < roles.length ? 'Scegli ' + roles[chosen].toLocaleLowerCase('it') : 'Tutti i ruoli scelti';
}

// One charge is "1 Carica"; every other resource name reads the same in the singular.
const resourceName = ({ name, amount }) => (name === 'Cariche' && amount === 1 ? 'Carica' : name);
export const combatExtraCost = resource => (resource?.amount > 0 ? resource.amount + ' ' + resourceName(resource) : '');

// What a logged action cost: PM/PF/Essenza as debited, plus what the table tracks (Cariche, Investimento).
export function combatSpentLabel(cost) {
  const extra = cost?.extra?.name === 'Essenza' ? '' : combatExtraCost(cost?.extra);
  return [cost?.mana && cost.mana + ' PM', cost?.hp && cost.hp + ' PF', cost?.essenza && cost.essenza + ' Essenza', extra]
    .filter(Boolean).join(' + ');
}

export function combatCostLabel(action) {
  const extra = combatExtraCost(action.extraResource);
  const mana = action.variableCost ? 'PM variabili' : (action.cost || !extra ? (action.cost ?? 0) + ' PM' : '');
  return [mana, extra].filter(Boolean).join(' + ');
}

// Essenza is debited by the app; other extra resources (Cariche, Investimento) are tracked at the table.
export function combatResourceConfirmLabel({ name, amount }) {
  const label = amount + ' ' + resourceName({ name, amount });
  return name === 'Essenza' ? 'Spendi ' + label : 'Usa ' + label + ' (da scalare al tavolo)';
}

export const combatBandSpan = ({ minFt, maxFt }) => (minFt === maxFt ? '' : minFt + '–') + maxFt + ' ft';

export function combatBandLabel(action, distanceFt) {
  const band = combatDamageBand(action, distanceFt);
  return 'a ' + distanceFt + ' ft · ' + (band ? [band.expr, band.note].filter(Boolean).join(' · ') : 'fascia da concordare al tavolo');
}

export function combatPointLabel(point) {
  return 'Casella ' + (point.col + 1) + ', ' + (point.row + 1);
}

export function getCombatLaunchBlock({
  actor, action, point, targetCount, picking, turn, variableCost, hpCost, confirmHp, confirmExtra,
}) {
  const canActOffTurn = action.canActOffTurn ?? action.actionEconomy === 'Reazione';
  if (turn?.canAct === false && !canActOffTurn) return turn.reason || 'Attendi il tuo turno.';
  if (actor.hp != null && actor.hp <= 0) return 'Il personaggio è incapacitato.';
  if (picking) return 'Completa la selezione sulla mappa.';
  if (picksGround(action) && !point) return 'Scegli una casella sulla mappa.';
  if (!picksGround(action) && action.mode !== 'self') {
    const minimum = action.minTargets ?? (action.mode === 'manual' ? 0 : 1);
    if (targetCount < minimum) {
      return minimum > 1 ? 'Scegli almeno ' + minimum + ' bersagli.' : 'Scegli un bersaglio.';
    }
    if (action.maxTargets != null && targetCount > action.maxTargets) {
      return 'Scegli al massimo ' + action.maxTargets + ' bersagli.';
    }
  }
  if (action.variableCost && (variableCost === '' || !Number.isInteger(Number(variableCost)) || Number(variableCost) < 0)) {
    return 'Inserisci il costo concordato in PM.';
  }
  if (hpCost > (actor.hp ?? 0)) return 'PF insufficienti per coprire il costo.';
  if (hpCost > 0 && !confirmHp) return 'Conferma la spesa in PF.';
  if (action.extraResource) {
    if (action.extraResource.name === 'Essenza' && actor.essenza != null && actor.essenza < action.extraResource.amount) {
      return 'Essenza insufficiente.';
    }
    if (!confirmExtra) return 'Conferma la risorsa richiesta.';
  }
  return '';
}

export function combatTargetName(target, targets) {
  const peers = targets.filter(other => other.name === target.name && other.placementId !== target.placementId);
  if (!peers.length) return target.name;
  const distinctCell = Number.isInteger(target.col) && Number.isInteger(target.row) &&
    !peers.some(other => other.col === target.col && other.row === target.row);
  if (distinctCell) return target.name + ' · ' + (target.col + 1) + ', ' + (target.row + 1);
  const ids = [target, ...peers].map(pawn => pawn.placementId).sort();
  return target.name + ' · Pedina ' + (ids.indexOf(target.placementId) + 1);
}

export const COMBAT_KIND_LABEL = {
  weapon: 'Armi',
  spell: 'Spell',
  tecnica: 'Tecniche',
};

export const COMBAT_OUTCOME_LABEL = {
  hit: 'Prova superata',
  resisted: 'Bersaglio resiste',
  tie: 'Parità · rilancio',
  applied: 'Effetto risolto',
  accepted: 'Consenso dato',
  declined: 'Consenso rifiutato',
  manual: 'Effetto al tavolo',
};

export function combatOutcomeLabel(outcome, kind, hands = 0) {
  if (kind === 'weapon' || hands > 0) {
    if (outcome === 'hit') return 'Colpo a segno';
    if (outcome === 'resisted') return 'Colpo evitato';
  }
  return COMBAT_OUTCOME_LABEL[outcome] || '';
}

// Defender's point of view: "superata"/"resiste" never leave doubt about who succeeded.
const DEFENDER_OUTCOME_LABEL = {
  hit: 'Non hai resistito',
  resisted: 'Hai resistito',
  tie: 'Parità · l’attaccante può rilanciare',
  accepted: 'Effetto accettato',
  declined: 'Effetto rifiutato',
};

export function combatDefenderOutcomeLabel(outcome, kind, hands = 0) {
  if (kind === 'weapon' || hands > 0) {
    if (outcome === 'hit') return 'Colpito';
    if (outcome === 'resisted') return 'Colpo evitato';
  }
  return DEFENDER_OUTCOME_LABEL[outcome] || COMBAT_OUTCOME_LABEL[outcome] || '';
}

export function combatProposalLabel(damage, effects = []) {
  const heal = effects.filter(({ kind, amount }) => kind === 'heal' && typeof amount === 'number')
    .reduce((total, { amount }) => total + amount, 0);
  const table = effects.filter(({ kind, label }) => kind === 'manual' && label).map(({ label }) => label);
  return [damage != null && damage + ' danni proposti', heal > 0 && heal + ' PF di cura proposti', ...table].filter(Boolean).join(' · ');
}


const isDamageAmount = value => Number.isSafeInteger(value) && value >= 0;
const LANDED_OUTCOMES = ['hit', 'applied', 'accepted'];
export const UNRESOLVED_COMBAT_STATUSES = ['waiting', 'retry', 'awaitingDamage', 'awaitingConfirmation'];
export const COMBAT_CONFIRMATION_STATUS = 'In attesa della conferma del danno';

// The damage the DM may apply to one target of a logged action, the same rule the server enforces: an answered target
// that was hit, affected or consented, with a whole damage from 0 up tied to that very pawn (its own roll, or a damage
// effect naming it). Healing, area suggestions bound to no pawn and unanswered or resisted targets propose nothing.
// A completed critical proposes its total; one the table must still roll proposes no number and shows its formula.
export function combatDamageProposal(event, target) {
  if (event?.status === 'cancelled' || target?.status !== 'done' || !LANDED_OUTCOMES.includes(target.outcome)) return null;
  const effect = (event?.effects || []).filter(item => (
    item?.kind === 'damage' && item.targetPlacementId === target.placementId && isDamageAmount(item.amount)
  )).pop();
  const base = isDamageAmount(target.damage) ? target.damage : effect?.amount;
  if (base == null) return null;
  const { critical } = target;
  if (critical?.tableRoll) return { amount: null, formula: critical.tableRoll };
  return { amount: critical && isDamageAmount(critical.total) ? critical.total : base, formula: '' };
}

// What a target's owner may confirm, by the rule the server enforces: at least the proposal (the critical's total once
// the app could roll it, else the base), and nothing when the critical is rolled at the table, whose damage the DM
// applies. Null for the DM, who sets any whole number from 0 up, and when nothing is proposed.
export function combatDamageFloor(proposal, isManager) {
  if (isManager || !proposal) return null;
  return proposal.amount == null ? { table: true } : { minimum: proposal.amount };
}

// The damage the server recorded for this target; `{ amount: 0 }` is an application too.
export const combatAppliedDamage = target => (
  target?.damageApplied && typeof target.damageApplied === 'object' ? target.damageApplied : null
);

export function combatCanCancel(event, isApplied = combatAppliedDamage) {
  if (!event.id || event.ownerPrivate) return false;
  if (UNRESOLVED_COMBAT_STATUSES.includes(event.status)) return true;
  // Older events already said `done` while a target still had damage to apply.
  return event.status === 'done' && (event.targets || []).some(target => (
    !isApplied(target) && combatDamageProposal(event, target) !== null
  ));
}

const CORRECTION_REASONS = {
  legacyCostUnknown: 'Spesa originaria da ricostruire.',
  legacyDamageUnknown: 'Ripartizione del danno tra PF, barriera o scudo da verificare.',
  entityUnavailable: 'Pedina o risorse non più disponibili.',
  balanceUnavailable: 'Saldo della risorsa non disponibile.',
  barrierUnavailable: 'Barriera o scudo non disponibile.',
  barrierAmbiguous: 'Verifica se nel frattempo la barriera o lo scudo sono cambiati.',
  barrierCapacity: 'Il ripristino supera la capienza attuale.',
};
const CORRECTION_RESOURCES = {
  hpCurrent: 'PF', manaCurrent: 'PM', essenzaCurrent: 'Essenza', barrieraCurrent: 'punti barriera', shieldCurrent: 'punti scudo',
};

export function describeCombatCorrection(event, { reason, subject = {}, placementId, amounts = {}, agreedDamage }) {
  const pawns = [event.actor, ...(event.targets || [])].filter(Boolean);
  const tokenId = subject.tokenId || subject.id;
  const pawn = (placementId && pawns.find(item => item.placementId === placementId))
    || (tokenId && pawns.find(item => item.tokenId === tokenId))
    || (subject.kind === 'character' && pawns.find(item => item.ownerUid === subject.id));
  return {
    name: pawn?.name || 'Pedina della scena',
    reason: CORRECTION_REASONS[reason] || 'Risorse da verificare.',
    amounts: Object.entries(CORRECTION_RESOURCES).flatMap(([field, label]) => (
      Number.isFinite(amounts[field]) ? [amounts[field] + ' ' + label] : []
    )).join(' · '),
    agreedDamage: isDamageAmount(agreedDamage) ? 'Danno concordato · ' + agreedDamage : '',
  };
}

// A typed final damage: digits only, a whole number from 0 up; null when it is anything else.
export function parseCombatDamage(text) {
  const value = String(text ?? '').trim();
  if (!/^\d+$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? amount : null;
}

// What the table must apply beyond the numbers: the card's table instruction and, for spells and techniques, its own
// text (a weapon's item text is not an instruction). Each once, one per line.
export function combatCardText(action, kind) {
  const text = value => (typeof value === 'string' ? value : '');
  return [...new Set([text(action?.manualEffect), kind === 'weapon' ? '' : text(action?.description)])]
    .filter(Boolean).join('\n');
}
