import {
  asFiniteNumber,
  asRecord,
  asTrimmedString,
  evaluateEquipmentFormula,
  isTwoHandedEquipmentItem,
  resolveLevelThreshold,
} from "./userDataV2";

export type CombatKind = "weapon" | "spell" | "tecnica";
export type CombatScope = "equipped" | "personal" | "common";
type TargetMode = "single" | "multiple" | "self" | "area" |
  "point" | "ground" | "manual";
export type CombatStatus = "waiting" | "retry" | "done";
// Only the event waits for damage: its targets are done once the defense is answered.
export type CombatEventStatus = CombatStatus | "awaitingDamage";
type CombatOutcome = "tie" | "hit" | "resisted" | "accepted" | "declined";
export type AnimaDie = number;
type Fields = Record<string, unknown>;

export const MAX_COMBAT_TARGETS = 12;
const HANDS = ["weaponMain", "weaponOff"];

export class CombatProblem extends Error {
  constructor(
    public readonly code: "invalid-argument" | "failed-precondition",
    message: string
  ) {
    super(message);
  }
}

export interface CombatProfile {
  level: number;
  die: AnimaDie | null;
  parametri: Fields;
}

export interface CombatResources {
  hp: number | null;
  mana: number | null;
  essenza: number | null;
}

export interface CombatArea {
  shape: "square" | "cone";
  sideSquares: number;
  anchor: "center" | "farthest";
}

export interface CombatCheck {
  channel: string;
  attackLabel: string;
  attackBonus: number;
  attackDie: boolean;
  defenseStats: string[];
  defenseDie: boolean;
  opposed: boolean;
  consent: boolean;
}

export interface CombatDamageBand {
  minFt: number;
  maxFt: number;
  expr: string;
  note: string;
}

export interface CombatAction extends CombatCheck {
  id: string;
  kind: CombatKind;
  scope: CombatScope;
  name: string;
  sourceItem: string;
  description: string;
  actionEconomy: string;
  canActOffTurn: boolean;
  mode: TargetMode;
  relation: "any" | "ally" | "selfOrAlly";
  rangeFt: number | null;
  minRangeFt: number;
  minTargets: number;
  maxTargets: number;
  targetRoles: string[] | null;
  roleRangesFt: (number | null)[] | null;
  area: CombatArea | null;
  allowSelf: boolean;
  allowDead: boolean;
  requireDead: boolean;
  baseCost: number;
  cost: number;
  variableCost: string | null;
  extraResource: {name: string; amount: number} | null;
  checks: CombatCheck[];
  die: AnimaDie | null;
  hands: number;
  melee: boolean;
  attackStat: number;
  attackModifiers: {label: string; value: number}[];
  damageExpr: string;
  damageBonus: number;
  damageBands: CombatDamageBand[];
  healExpr: string;
  healOnResist: boolean;
  criticalExpr: string;
  criticalBonus: number;
  manualEffect: string;
  turns: number;
  art: string;
  media: Fields | null;
  // Fingerprint of the definition the arsenal served (see readArsenal).
  version?: string;
  // Guided journals only: whether the critical formula has dice to throw.
  criticalHasDice?: boolean;
}

export interface CombatCell {
  col: number;
  row: number;
  sizeSquares?: number;
}

export interface CombatPawn extends CombatCell {
  placementId: string;
  tokenId: string;
  name: string;
  ownerUid: string;
  sizeSquares: number;
}

export interface CombatRoll {
  label: string;
  total: number;
  bonus: number;
  sides: number;
  rolls: number[];
}

export interface CombatTrial {
  round: number;
  attack: CombatRoll | null;
  defense: CombatRoll | null;
  outcome: CombatOutcome;
  damage: number | null;
  // A shared journal flags manual edits without copying the request's private defaults.
  defenseAdjusted?: boolean;
}

export interface CombatDamageDetails {
  raw: number;
  subtotal: number;
  reduction: number;
  hands: number;
}

export interface CombatCritical {
  score: number;
  multiplier: string;
  factor: number;
  effect: string;
  total: number;
  // Damage formula for the table when the critical dice cannot be rolled ("" otherwise);
  // total is then not the damage.
  tableRoll: string;
  roll: number | null;
  bonus: number;
  reduction: number;
  // Guided journals only, added by the handler: the faces of `roll`, kept through every correction.
  rolls?: CombatDie[];
}

// A die as the tray shows it; a subtracted die carries sign -1.
export interface CombatDie {
  sides: number;
  value: number;
  sign?: -1;
}

// Guided mode: a damage formula with dice that waits for the actor's throw. A weapon
// hit keeps the RD the defender answered.
export interface CombatPendingDamage {
  round: number;
  kind: "effect" | "weapon";
  label: string;
  expr: string;
  reduction?: number;
}

// The stored throw: faces never change, raw is the formula's sum, total the damage proposed.
export interface CombatDamageRoll {
  round: number;
  kind: CombatPendingDamage["kind"];
  label: string;
  expr: string;
  rolls: CombatDie[];
  raw: number;
  total: number;
}

export interface CombatTarget extends CombatPawn {
  status: CombatStatus;
  round: number;
  attack: CombatRoll | null;
  defense: CombatRoll | null;
  outcome: Exclude<CombatOutcome, "tie"> | "applied" | "manual" | null;
  trials: CombatTrial[];
  advantage: boolean;
  damage: number | null;
  damageDetails: CombatDamageDetails | null;
  critical: CombatCritical | null;
  // The amount the DM agreed and applied; balances stay with the resources.
  damageApplied?: {amount: number};
  pendingDamage?: CombatPendingDamage;
  damageRoll?: CombatDamageRoll;
}

export interface CombatDefense {
  label: string;
  value: number | null;
  reduction: number | null;
  die: AnimaDie | null;
  showDie: boolean;
  showReduction: boolean;
  consent: boolean;
}

export interface CombatEffect {
  kind: "damage" | "heal" | "manual";
  label: string;
  amount: number | null;
  expr: string;
  targetPlacementId: string | null;
}

const normalizedKey = (value: string): string => (
  value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
);

const readNumber = (value: unknown): number | null => {
  if (typeof value !== "number" && !(typeof value === "string" && value.trim())) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const paramValue = (value: unknown): number | null => {
  const node = asRecord(value);
  const total = readNumber(node.Tot ?? node.tot ?? node.value ?? value);
  if (total !== null) return total;
  const parts = [node.Base, node.Anima, node.Equip, node.Mod];
  return parts.some((part) => readNumber(part) !== null)
    ? parts.reduce<number>((sum, part) => sum + asFiniteNumber(part), 0)
    : null;
};

const locateStat = (group: unknown, key: string): unknown => {
  const data = asRecord(group);
  if (Object.prototype.hasOwnProperty.call(data, key)) return data[key];
  const normalized = normalizedKey(key);
  return Object.entries(data).find(([name]) => (
    normalizedKey(name) === normalized
  ))?.[1];
};

export const combatStat = (profile: CombatProfile, name: string): number | null => (
  paramValue(locateStat(profile.parametri.Combattimento, name)) ??
  paramValue(locateStat(profile.parametri.Base, name))
);

const rollStat = (profile: CombatProfile, stats: string[]): number | null => {
  const values = stats
    .map((name) => combatStat(profile, name))
    .filter((value): value is number => value !== null);
  return values.length ? Math.max(...values) : null;
};

const statLabel = (stats: string[], fallback: string): string =>
  stats.length > 1 ? `max(${stats.join(", ")})` : stats[0] || fallback;

export const combatDie = (value: unknown): AnimaDie | null => {
  const sides = readNumber(typeof value === "string" ? value.trim().replace(/^d/i, "") : value);
  return sides !== null && Number.isSafeInteger(sides) && sides >= 2 && sides <= 100 ? sides : null;
};

export const combatResources = (value: unknown): CombatResources => {
  const stats = asRecord(value);
  return {
    hp: readNumber(stats.hpCurrent ?? stats.hpTotal),
    mana: readNumber(stats.manaCurrent ?? stats.manaTotal),
    essenza: readNumber(stats.essenzaCurrent ?? stats.essenzaTotal ?? stats.essenza),
  };
};

// Characters keep the barrier as barrieraCurrent (legacy: barriera); tokens as shieldCurrent.
export const combatDamageBalances = (
  value: unknown, character: boolean
): {hp: number | null; barrier: number | null} => {
  const stats = asRecord(value);
  return {
    hp: combatResources(stats).hp,
    barrier: readNumber(character ? stats.barrieraCurrent ?? stats.barriera : stats.shieldCurrent),
  };
};

// The barrier absorbs first, then PF. Spend only positive balances: Home can
// record PF below zero manually, and applying damage must not raise that balance.
export const combatDamageSplit = (
  amount: number, balances: {hp: number | null; barrier: number | null}
): {hp: number; barrier: number} => {
  const barrier = Math.min(amount, Math.max(0, balances.barrier ?? 0));
  return {barrier, hp: Math.min(amount - barrier, Math.max(0, balances.hp ?? 0))};
};

const isDamageAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

// Damage lands only on a decided target that the action reached, with a number
// bound to it: never a pending or tied exchange, a resisted or declined one, a
// cure, an effect left to the table or damage dropped on the ground. The base is
// the target's own roll, else the last damage effect naming it (as the panel shows).
export const combatDamageBase = (
  target: Pick<CombatTarget, "placementId" | "status" | "outcome" | "damage">,
  effects: Pick<CombatEffect, "kind" | "amount" | "targetPlacementId">[]
): number | null => {
  if (target.status !== "done" ||
    !(target.outcome === "hit" || target.outcome === "applied" || target.outcome === "accepted")) {
    return null;
  }
  if (isDamageAmount(target.damage)) return target.damage;
  const bound = (Array.isArray(effects) ? effects : []).filter((item) => item?.kind === "damage" &&
    item.targetPlacementId === target.placementId && isDamageAmount(item.amount)).pop();
  return bound && isDamageAmount(bound.amount) ? bound.amount : null;
};

export const combatDamageEligible = (
  target: Pick<CombatTarget, "placementId" | "status" | "outcome" | "damage">,
  effects: Pick<CombatEffect, "kind" | "amount" | "targetPlacementId">[]
): boolean => combatDamageBase(target, effects) !== null;

// The least a target's owner may confirm: the proposal Home and the Registro show,
// that is the critical's total once the app could roll it, else the base. "table"
// when the critical is left to the table: that amount is the DM's to settle. Null
// with nothing concrete to apply. The DM may apply any amount.
export const combatOwnerDamageFloor = (
  target: Pick<CombatTarget, "placementId" | "status" | "outcome" | "damage" | "critical">,
  effects: Pick<CombatEffect, "kind" | "amount" | "targetPlacementId">[]
): number | "table" | null => {
  const base = combatDamageBase(target, effects);
  if (base === null) return null;
  const critical = asRecord(target.critical);
  if (critical.tableRoll) return "table";
  return isDamageAmount(critical.total) ? critical.total : base;
};

export const combatCost = (
  action: Pick<CombatAction, "cost" | "extraResource"> & {variableCost?: string | null},
  balances: CombatResources,
  approval: {confirmHp?: boolean; maxHpCost?: number; confirmExtra?: boolean; variableCost?: number}
): {mana: number; hp: number; essenza: number} => {
  if (balances.hp !== null && balances.hp <= 0) {
    throw new CombatProblem("failed-precondition", "L'attore è incapacitato.");
  }
  const cost = action.variableCost ? approval.variableCost : action.cost;
  if (cost === undefined || !Number.isSafeInteger(cost) || cost < 0 || cost > 9999) {
    throw new CombatProblem("invalid-argument", "Indica il costo concordato in PM.");
  }
  const mana = Math.min(cost, Math.max(0, balances.mana ?? 0));
  const hp = cost - mana;
  if (hp > Math.max(0, balances.hp ?? 0)) {
    throw new CombatProblem("failed-precondition", "PF insufficienti per coprire il costo.");
  }
  if (hp > 0 && !approval.confirmHp) {
    throw new CombatProblem("failed-precondition", "Conferma la spesa in PF.");
  }
  if (hp > 0 && (!Number.isFinite(approval.maxHpCost) || hp > (approval.maxHpCost ?? 0))) {
    throw new CombatProblem("failed-precondition", "Il costo in PF è cambiato. Controlla le risorse e riconferma.");
  }
  const essenza = action.extraResource?.name === "Essenza"
    ? action.extraResource.amount
    : 0;
  if (essenza > Math.max(0, balances.essenza ?? 0)) {
    throw new CombatProblem("failed-precondition", "Essenza insufficiente.");
  }
  if (action.extraResource && !approval.confirmExtra) {
    throw new CombatProblem("failed-precondition", "Conferma la risorsa richiesta.");
  }
  return {mana, hp, essenza};
};

export const combatDistance = (first: CombatCell, other: CombatCell): number => {
  const firstSize = first.sizeSquares ?? 1;
  const otherSize = other.sizeSquares ?? 1;
  const gap = (a: number, b: number): number =>
    Math.max(0, a - b - otherSize + 1, b - a - firstSize + 1);
  return 5 * Math.max(gap(first.col, other.col), gap(first.row, other.row));
};

export const combatInRange = (
  actor: CombatCell,
  target: CombatCell,
  action: CombatAction,
  rangeFt = action.rangeFt
): boolean => {
  let distance = combatDistance(actor, target);
  if (action.area?.anchor === "farthest") {
    const side = action.area.sideSquares;
    const shift = Math.floor((side - 1) / 2);
    const extents = [-shift, side - 1 - shift];
    distance = Math.max(...extents.flatMap((col) => extents.map((row) =>
      combatDistance(actor, {col: target.col + col, row: target.row + row})
    )));
  }
  return distance >= action.minRangeFt && (rangeFt === null || distance <= rangeFt);
};

// Who controls a pawn and which kind of token it is, as the board records them.
export interface CombatSide {
  ownerUid: string;
  tokenType: string;
}

// Pawns carry no team, so sides come from the token type: foes (the DM's
// bestiary) stand apart from characters and custom pawns. Within a side, a
// pawn's allies are the other pawns its account controls and, across accounts,
// every player character, the DM's own included. Another account's custom pawn
// is never an ally, even a player's summon: a player's board cannot tell it from
// a foe, so the picker and this check give the same answer and the refusal
// reveals nothing the board does not show. Foes of two DM accounts are not
// allies either.
export const combatAllies = (actor: CombatSide, target: CombatSide): boolean =>
  (actor.tokenType === "foe") === (target.tokenType === "foe") && (
    actor.ownerUid === target.ownerUid ||
    (actor.tokenType === "character" && target.tokenType === "character")
  );

// Whether the action's relation admits this target. A pawn is its own ally:
// whether an action may target its actor is `allowSelf`'s business.
export const combatRelationAllows = (
  action: Pick<CombatAction, "relation">, actor: CombatSide, target: CombatSide
): boolean => (
  (action.relation !== "ally" && action.relation !== "selfOrAlly") || combatAllies(actor, target)
);

// Range of an ordered target role; null means no limit.
export const combatRoleRange = (
  action: Pick<CombatAction, "rangeFt" | "roleRangesFt">, role: number
): number | null => (
  action.roleRangesFt ? action.roleRangesFt[role] ?? null : action.rangeFt
);

// A dice expression is a sum of dice and integer terms: "2d6 + 1d4", "3d8 - 2", "1".
const DICE_TERM = String.raw`(?:\d*d\d+|\d+)`;
const DICE_SUM = String.raw`${DICE_TERM}(?:\s*[+-]\s*${DICE_TERM})*`;
const WHOLE_DICE_SUM = new RegExp(`^${DICE_SUM}$`, "i");
const SIGNED_DICE_TERM = new RegExp(String.raw`[+-]?\s*${DICE_TERM}`, "gi");
const PROSE_DAMAGE = new RegExp(
  String.raw`(?:infligge|provoca|causa)\s+(?:fino a\s+)?(\d*d\d+(?:\s*[+-]\s*${DICE_TERM})*)\s+danni`, "i"
);

const dicePlan = (expression: string) => {
  if (!WHOLE_DICE_SUM.test(expression)) return null;
  const terms = (expression.match(SIGNED_DICE_TERM) ?? []).map((term) => {
    const [count, sides] = term.replace(/[+\-\s]/g, "").toLowerCase().split("d");
    return {
      sign: term.startsWith("-") ? -1 : 1,
      count: Number(count || 1),
      sides: sides === undefined ? null : Number(sides),
    };
  });
  return terms.length <= 8 && terms.every(({count, sides}) => count >= 1 && (sides === null
    ? count <= 9999
    : count <= 20 && sides >= 2 && sides <= 1000)) ? terms : null;
};

// The whole text must be an expression: a partial match would drop terms.
const diceExpression = (text: string): string => dicePlan(text) ? text : "";

// A card field may name the damage after the formula ("2d6 fuoco"). Text that
// could continue the formula ("2d6 + Forza", "2d6 x Forza", "1d8 per turno")
// is left to the table.
const LEADING_DICE_SUM = new RegExp(
  String.raw`^(${DICE_SUM})(?:\s+(?!(?:x|per)\s)\p{L}[^\d+\-*/×]*)?$`, "iu"
);
const fieldExpression = (text: string): string =>
  diceExpression(text.match(LEADING_DICE_SUM)?.[1] ?? "");

// Every die of the expression in formula order, and its sum. Constants are folded
// into the total, never listed.
export const rollCombatDice = (
  expression: string, roll: (sides: number) => number
): {rolls: CombatDie[]; total: number} | null => {
  const plan = dicePlan(expression);
  if (!plan) return null;
  const rolls: CombatDie[] = [];
  const total = plan.reduce((sum, {sign, count, sides}) => {
    if (sides === null) return sum + sign * count;
    const faces = Array.from({length: count}, () => roll(sides));
    rolls.push(...faces.map((value): CombatDie => sign < 0 ? {sides, value, sign: -1} : {sides, value}));
    return sum + sign * faces.reduce((subtotal, value) => subtotal + value, 0);
  }, 0);
  return {rolls, total};
};

export const rollCombatDamage = (
  expression: string, roll: (sides: number) => number
): number | null => rollCombatDice(expression, roll)?.total ?? null;

// Only an expression the app can roll and that holds at least one die waits for a throw.
export const combatHasDice = (expression: string): boolean =>
  dicePlan(expression)?.some(({sides}) => sides !== null) ?? false;

// Damage an action proposes against a target at this distance: the card's
// expression, or the band that covers the distance. Journal entries written
// before bands existed carry none.
export const combatDamageProposal = (
  action: {damageExpr: string; damageBands?: CombatDamageBand[]}, distanceFt: number
): Pick<CombatEffect, "kind" | "label" | "expr"> | null => {
  if (!action.damageBands?.length) {
    return action.damageExpr ? {kind: "damage", label: "Danno proposto", expr: action.damageExpr} : null;
  }
  const band = action.damageBands.find(({minFt, maxFt}) => distanceFt >= minFt && distanceFt <= maxFt);
  const reach = `${distanceFt} ft`;
  return band
    ? {kind: "damage", label: ["Danno proposto", reach, band.note].filter(Boolean).join(" · "), expr: band.expr}
    : {kind: "manual", label: `Fascia di danno da concordare al tavolo · ${reach}`, expr: ""};
};

const FURTIVO = "ATTACCO FURTIVO";
const IMPEDIMENTO = "IMPEDIMENTO";
const HALF_RD = "DIMEZZA RIDUZIONE DANNI";
const DISORIENTAMENTO = "DISORIENTAMENTO";
const IGNORE_RD = "IGNORA RIDUZIONE DANNI";
const standardCriticalEffects = ["–", FURTIVO, IMPEDIMENTO, HALF_RD, DISORIENTAMENTO, IGNORE_RD];

// Codex → Informazioni Generali → Tabella Critici, also embedded in
// docs/grigliata-armi/04-arsenale.html.
const criticalRows = [
  ...standardCriticalEffects.map((effect) => ({factor: 0, effect})),
  ...standardCriticalEffects.map((effect) => ({factor: 1, effect})),
  ...[IMPEDIMENTO, HALF_RD, DISORIENTAMENTO, IGNORE_RD, IGNORE_RD]
    .map((effect) => ({factor: 1, effect: `${FURTIVO} + ${effect}`})),
  ...standardCriticalEffects.slice(0, 5).map((effect) => ({factor: 2, effect})),
  ...[3, 4, 5].flatMap((factor) => standardCriticalEffects.map((effect) => ({factor, effect}))),
  {factor: 7, effect: IGNORE_RD},
];

export const combatWeaponDamage = (subtotal: number, reduction: number, hands: number): number =>
  Math.ceil(Math.max(0, subtotal - reduction) * (hands === 2 ? 1.5 : 1));

// A weapon hit: Attacco + the rolled dice + Bonus Danno, less RD, then the two-handed multiplier.
export const combatWeaponHit = (
  action: Pick<CombatAction, "attackStat" | "damageBonus" | "hands">, raw: number, reduction: number
): {damage: number; damageDetails: CombatDamageDetails} => {
  const damageDetails = {raw, subtotal: action.attackStat + raw + action.damageBonus, reduction, hands: action.hands};
  return {damage: combatWeaponDamage(damageDetails.subtotal, reduction, action.hands), damageDetails};
};

// Guided mode leaves a damage formula with dice to the actor's throw; null when the
// proposal resolves at once (a table effect, a constant, a formula the app cannot roll).
export const combatPendingDamage = (
  proposal: Pick<CombatEffect, "kind" | "label" | "expr"> | null, round: number, reduction: number | null = null
): CombatPendingDamage | null => {
  if (proposal?.kind !== "damage" || !combatHasDice(proposal.expr)) return null;
  const {label, expr} = proposal;
  return reduction === null ? {round, kind: "effect", label, expr} : {round, kind: "weapon", label, expr, reduction};
};

// The throw of a pending damage, with the amount the immediate path proposes for the same faces.
export const resolveCombatDamage = (
  pending: CombatPendingDamage,
  action: Pick<CombatAction, "attackStat" | "damageBonus" | "hands">,
  roll: (sides: number) => number
): {damageRoll: CombatDamageRoll; damageDetails: CombatDamageDetails | null} => {
  const {round, kind, label, expr} = pending;
  const {rolls, total: raw} = rollCombatDice(expr, roll) ?? {rolls: [], total: 0};
  const weapon = kind === "weapon" ? combatWeaponHit(action, raw, pending.reduction ?? 0) : null;
  return {
    damageRoll: {round, kind, label, expr, rolls, raw, total: weapon ? weapon.damage : raw},
    damageDetails: weapon?.damageDetails ?? null,
  };
};

// A thrown damage takes the place an immediate roll gives it: before the first cure of the
// same target (or of the ground), else last.
export const combatEffectsWithDamage = (effects: CombatEffect[], damage: CombatEffect): CombatEffect[] => {
  const at = effects.findIndex((item) => item.kind === "heal" && item.targetPlacementId === damage.targetPlacementId);
  return at < 0 ? [...effects, damage] : [...effects.slice(0, at), damage, ...effects.slice(at)];
};

// The critical and the faces of its dice, from one roll: the first confirmation rolls the
// formula whatever the row; a correction rolls nothing and keeps the roll and faces stored.
export const combatCriticalThrow = (
  score: number,
  base: CombatDamageDetails,
  action: Pick<CombatAction, "criticalExpr" | "criticalBonus">,
  previous: CombatCritical | null,
  roll: (sides: number) => number
): {critical: CombatCritical; rolls: CombatDie[]} => {
  const row = Number.isSafeInteger(score) ? criticalRows[score - 1] : undefined;
  if (!row) throw new CombatProblem("invalid-argument", "Il punteggio critico deve essere tra 1 e 41.");
  const thrown = previous ? null : rollCombatDice(action.criticalExpr, roll);
  const die = previous ? previous.roll : thrown?.total ?? null;
  const reduction = row.effect.includes(IGNORE_RD) ? 0 :
    row.effect.includes(HALF_RD) ? base.reduction / 2 : base.reduction;
  const bonus = action.criticalBonus;
  // An unrollable critical formula leaves the whole damage to the table, in the order
  // the app would apply it: before RD and before the two-handed multiplier.
  const tableRoll = row.factor && die === null && action.criticalExpr
    ? `max(0, ${base.subtotal + row.factor * bonus} + x${row.factor} (${action.criticalExpr}) − ${reduction} RD)` +
      (base.hands === 2 ? " × 1,5" : "") + ", arrotondato per eccesso"
    : "";
  return {critical: {
    score,
    multiplier: row.factor ? `x${row.factor}` : "–",
    factor: row.factor,
    effect: row.effect,
    tableRoll,
    total: combatWeaponDamage(base.subtotal + row.factor * ((die ?? 0) + bonus), reduction, base.hands),
    roll: die,
    bonus,
    reduction,
  }, rolls: previous ? previous.rolls ?? [] : thrown?.rolls ?? []};
};

// The critical alone, as a journal without faces stores it.
export const combatCritical = (...args: Parameters<typeof combatCriticalThrow>): CombatCritical =>
  combatCriticalThrow(...args).critical;

export const makeCombatRoll = (
  label: string, bonus: number, sides: AnimaDie | null,
  roll: (sides: number) => number, advantage = false
): CombatRoll => {
  const rolls = sides ? Array.from({length: advantage ? 2 : 1}, () => roll(sides)) : [];
  return {label, bonus, sides: sides ?? 0, rolls, total: bonus + Math.max(0, ...rolls)};
};

export const compareCombatRolls = (attack: number, defense: number): CombatOutcome => {
  if (attack === defense) return "tie";
  return attack > defense ? "hit" : "resisted";
};

// A re-roll first, then a defense, then a damage throw (of a target or of a targetless action).
export const combatStatus = (
  targets: {status: CombatStatus; pendingDamage?: unknown}[], pendingDamage: unknown = null
): CombatEventStatus => {
  if (targets.some(({status}) => status === "retry")) return "retry";
  if (targets.some(({status}) => status === "waiting")) return "waiting";
  return pendingDamage || targets.some((target) => target.pendingDamage) ? "awaitingDamage" : "done";
};

// The faces of a check roll, as the tray shows them.
export const combatRollFaces = (roll: Pick<CombatRoll, "sides" | "rolls"> | null | undefined): CombatDie[] => {
  if (!roll?.sides || !Array.isArray(roll.rolls)) return [];
  const {sides} = roll;
  return roll.rolls.map((value) => ({sides, value}));
};

// The attack a target faced in a round: its current one, else the one its trial keeps.
export const combatRoundAttack = (
  target: Pick<CombatTarget, "round" | "attack" | "trials">, round: number
): CombatRoll | null => (
  target.round === round ? target.attack : target.trials?.find((trial) => trial.round === round)?.attack ?? null
);

// The faces a launch rolled: each target's first attack in target order, else the targetless attack.
export const combatLaunchRolls = (
  targets: Pick<CombatTarget, "round" | "attack" | "trials">[], attack: CombatRoll | null | undefined
): CombatDie[] => (
  targets.length ? targets.flatMap((target) => combatRollFaces(combatRoundAttack(target, 1))) : combatRollFaces(attack)
);

// The DM can spot a manual adjustment in the journal; the original values stay on the request.
export const combatDefenseAdjusted = (
  defaults: Pick<CombatDefense, "value" | "reduction" | "die" | "showReduction" | "showDie">,
  used: {bonus: number; reduction: number | null; die: number | null}
): boolean => used.bonus !== defaults.value ||
  (defaults.showReduction && used.reduction !== defaults.reduction) ||
  (defaults.showDie && used.die !== combatDie(defaults.die));

export const getCombatDefense = (action: CombatCheck & {kind: CombatKind}, profile: CombatProfile): CombatDefense => ({
  label: statLabel(action.defenseStats, "Difesa"),
  value: rollStat(profile, action.defenseStats),
  reduction: action.kind === "weapon" ? combatStat(profile, "RiduzioneDanni") : null,
  die: action.defenseDie ? profile.die : null,
  showDie: action.defenseDie,
  showReduction: action.kind === "weapon",
  consent: action.consent,
});

const makeCheck = (
  profile: CombatProfile,
  values: {channel: string; attackStats: string[]; defenseStats: string[];
    attackDie?: boolean; defenseDie?: boolean; consent?: boolean}
): CombatCheck => ({
  channel: values.channel,
  attackLabel: values.attackDie === false && !values.attackStats.length
    ? "" : statLabel(values.attackStats, "Anima"),
  attackBonus: rollStat(profile, values.attackStats) ?? 0,
  attackDie: values.attackDie ?? (values.attackStats.length > 0 || values.defenseStats.length > 0),
  defenseStats: values.defenseStats,
  defenseDie: values.defenseDie ?? values.defenseStats.length > 0,
  opposed: values.defenseStats.length > 0 || values.consent === true,
  consent: values.consent === true,
});

const baseAction = (data: CombatCheck & Pick<CombatAction, "id" | "kind" | "scope" | "name" | "die">): CombatAction => ({
  ...data,
  sourceItem: "",
  description: "",
  mode: "single",
  relation: "any",
  rangeFt: null,
  minRangeFt: 0,
  minTargets: 1,
  maxTargets: 1,
  targetRoles: null,
  roleRangesFt: null,
  area: null,
  allowSelf: false,
  allowDead: false,
  requireDead: false,
  cost: 0,
  baseCost: 0,
  variableCost: null,
  extraResource: null,
  checks: [],
  hands: 0,
  melee: false,
  attackStat: 0,
  attackModifiers: [],
  damageExpr: "",
  damageBonus: 0,
  damageBands: [],
  healExpr: "",
  healOnResist: false,
  criticalExpr: "",
  criticalBonus: 0,
  manualEffect: "",
  actionEconomy: "Tattica",
  canActOffTurn: false,
  turns: 0,
  art: "",
  media: null,
});

const firstText = (...values: unknown[]): string =>
  values.map(asTrimmedString).find(Boolean)?.slice(0, 2400) ?? "";

const safeArtwork = (value: unknown): string => {
  const source = asTrimmedString(value);
  return /^https:\/\//i.test(source) && source.length <= 1400 ? source : "";
};

const artworkMedia = (entry: Fields): Fields | null => {
  const media = asRecord(entry.media ?? asRecord(entry.General).media);
  return Object.keys(media).length ? {media} : null;
};

const readRange = (value: unknown): number | null => {
  const text = asTrimmedString(value);
  if (/contatto|^mischia$/i.test(text)) return 5;
  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(ft|piedi|m(?:etr[io])?)?$/i);
  const feet = match ? Number(match[1].replace(",", ".")) *
    (/^m/i.test(match[2] ?? "") ? 3.28084 : 1) : readNumber(value);
  return feet !== null && feet > 0 && feet <= 10000 ? feet : null;
};

const itemSpecial = (item: Fields, key: string, level: number): unknown => {
  const values = asRecord(item.Parametri).Special ?? asRecord(item.params).Special;
  const entry = locateStat(values, key);
  return asRecord(entry)[resolveLevelThreshold(level)] ?? entry;
};

const itemName = (item: Fields): string => firstText(
  asRecord(item.General).Nome, item.Nome, item.name
);

export const equippedCombatItem = (inventoryEntry: unknown): Fields => {
  const data = asRecord(inventoryEntry);
  return asRecord(data.currentSnapshot ?? data.acquisitionSnapshot ?? data.item ?? data);
};

// Spells an equipped item embeds under General.spells. A `true` entry only
// links a catalog spell by name: the pawn's own repertoire already lists the
// ones it can cast.
export const equippedItemSpells = (slots: Record<string, Fields>) => (
  Object.entries(slots).flatMap(([slot, item]) => (
    Object.entries(asRecord(asRecord(item.General).spells)).flatMap(([key, value]) => {
      const entry = asRecord(value);
      return Object.keys(entry).length
        ? [{id: `item:${slot}:${key}`, key, entry, sourceItem: itemName(item)}]
        : [];
    })
  ))
);

export const buildWeaponActions = (input: CombatProfile & {slots: Record<string, Fields>}) => {
  const {slots, level, parametri, die} = input;
  const weaponByHand = new Map(HANDS.map((slot) => [
    slot, diceExpression(firstText(itemSpecial(slots[slot] ?? {}, "Danno", level))),
  ]));
  const bonusFor = (key: string, hand: string): number => {
    const total = asRecord(locateStat(parametri.Special, key));
    return (paramValue(locateStat(parametri.Special, key)) ?? 0) -
      asFiniteNumber(total.Equip) +
      Object.entries(slots).reduce((sum, [slot, item]) => {
        if (slot !== hand && weaponByHand.get(slot)) return sum;
        return sum + evaluateEquipmentFormula(itemSpecial(item, key, level), parametri);
      }, 0);
  };
  const equipped = Object.fromEntries(HANDS.flatMap((slot) => {
    const item = slots[slot];
    if (!item || !itemName(item)) return [];
    const general = asRecord(item.General);
    const specific = asRecord(item.Specific);
    const description = firstText(general.Effetto, specific.Effetto, item.description, item.info);
    const hands = isTwoHandedEquipmentItem(item) ? 2 : 1;
    return [[slot, {
      name: itemName(item), hands, slot, description,
      art: safeArtwork(general.image_url ?? item.image_url ?? item.imageUrl),
      media: artworkMedia(item),
      armed: Boolean(weaponByHand.get(slot)) || /scudo/i.test(
        firstText(specific.Tipo, itemName(item))
      ) || /scudo/i.test(itemName(item)),
    }]];
  }));
  const actions = HANDS.flatMap((slot): CombatAction[] => {
    const item = slots[slot];
    const card = equipped[slot];
    const damageExpr = weaponByHand.get(slot);
    if (!item || !card || !damageExpr) return [];
    const general = asRecord(item.General);
    const specific = asRecord(item.Specific);
    const weaponType = firstText(specific.Tipo, item.Tipo, item.kind);
    const melee = /^mischia$/i.test(weaponType);
    const rangeText = card.description.match(/(?:gittata|portata)\s*(?:di|:)?\s*(\d+\s*(?:ft|piedi|m\b))/i)?.[1];
    const check = makeCheck(input, {channel: "Fisico", attackStats: ["Mira"], defenseStats: ["Difesa"]});
    const criticalText = firstText(itemSpecial(item, "Danno Critico", level));
    // Mira 1H or 2H follows the hands the weapon takes, Mira Ranged a "Distanza" weapon; they stack.
    const conditionalMira = [
      card.hands === 2 ? "Mira 2H" : "Mira 1H",
      ...(/^distanza$/i.test(weaponType) ? ["Mira Ranged"] : []),
    ].map((label) => ({label, value: bonusFor(label, slot)})).filter(({value}) => value);
    const action = baseAction({...check, id: slot, kind: "weapon", scope: "equipped", name: card.name, die});
    return [{
      ...action,
      attackBonus: conditionalMira.reduce((sum, {value}) => sum + value, check.attackBonus),
      attackModifiers: [{label: "Mira", value: check.attackBonus}, ...conditionalMira],
      attackStat: combatStat(input, "Attacco") ?? 0,
      description: card.description,
      damageExpr,
      damageBonus: bonusFor("Bonus Danno", slot),
      // An unsupported formula stays as text so the table can roll it.
      criticalExpr: fieldExpression(criticalText) || criticalText,
      criticalBonus: bonusFor("Bonus Danno Critico", slot),
      rangeFt: readRange(specific.Gittata ?? general.Gittata ?? rangeText) ?? (melee ? 5 : null),
      hands: card.hands,
      melee,
      art: card.art,
      media: card.media,
    }];
  });
  return {actions, equipped, armed: Object.values(equipped).some((item) => item.armed)};
};

// The card includes a physical attack with the wielded weapon.
interface WeaponAttackRule {
  attackBonus?: number;
  meleeOnly?: boolean;
  // The common technique is the weapon attack itself: it is hidden without a
  // weapon, and a personal card with the same name keeps its own rules.
  commonCard?: boolean;
}

interface CombatContentRules {
  mode?: TargetMode;
  relation?: CombatAction["relation"];
  rangeFt?: number;
  minRangeFt?: number;
  targetCount?: number;
  // Ordered targets; a role without its own range uses the action's.
  targetRoles?: {label: string; rangeFt?: number}[];
  area?: CombatArea;
  allowDead?: boolean;
  requireDead?: boolean;
  allowSelf?: boolean;
  actionEconomy?: string;
  extraResource?: CombatAction["extraResource"];
  // The card's Costo is paid in this table-tracked resource instead of PM.
  costResource?: string;
  variableCost?: string;
  damageExpr?: string;
  damageBands?: CombatDamageBand[];
  healExpr?: string;
  healOnResist?: boolean;
  targetConsent?: boolean;
  canActOffTurn?: boolean;
  attackStats?: string[];
  defenseStats?: string[];
  weaponAttack?: WeaponAttackRule;
}

const PHYSICAL_ATTACK = {attackStats: ["Mira"], defenseStats: ["Difesa"]};
const UNARMED_DAMAGE = "Danno fisico da concordare al tavolo.";

// These entries have targeting rules on the card that the legacy schema
// cannot represent. The live document still supplies availability and cost.
const LEGACY_COMBAT_RULES: Record<string, CombatContentRules> = {
  impedimento: {attackStats: ["Forza"], defenseStats: ["Forza"]},
  ostruzione: {actionEconomy: "Movimento", canActOffTurn: true, attackStats: ["Forza"], defenseStats: ["Forza"]},
  parata: {mode: "self", actionEconomy: "Movimento"},
  protezione: {relation: "ally", rangeFt: 13.12, actionEconomy: "Comunicazione", canActOffTurn: true},
  coordinazione: {relation: "ally", actionEconomy: "Comunicazione"},
  attaccofurtivo: {actionEconomy: "Movimento"},
  copertura: {mode: "self", actionEconomy: "Movimento"},
  frapposizione: {relation: "ally", rangeFt: 13.12, actionEconomy: "Comunicazione", canActOffTurn: true},
  cambiosetarmi: {mode: "self"},
  attacco: {...PHYSICAL_ATTACK, weaponAttack: {commonCard: true}},
  carica: {actionEconomy: "Movimento"},
  usoconsumabileincintura: {relation: "selfOrAlly", actionEconomy: "Consumabile"},
  attaccodopportunita: {...PHYSICAL_ATTACK, actionEconomy: "Movimento", canActOffTurn: true,
    weaponAttack: {meleeOnly: true, commonCard: true}},
  movimento: {mode: "point", rangeFt: 29.53, actionEconomy: "Movimento"},
  dardocosmico: {damageExpr: "2d10"},
  singolarita: {damageBands: [
    {minFt: 0, maxFt: 5, expr: "4d10", note: ""},
    {minFt: 10, maxFt: 10, expr: "3d10", note: ""},
    {minFt: 20, maxFt: 20, expr: "2d10", note: ""},
    {minFt: 30, maxFt: 30, expr: "1d10", note: "Attacco Furtivo"},
    {minFt: 40, maxFt: 50, expr: "1", note: "Attacco Furtivo"},
  ]},
  barrieracosmicaoffensiva: {damageExpr: "3d10"},
  barrieracosmicabenefica: {relation: "selfOrAlly", targetConsent: true},
  runadelloblio: {rangeFt: 5, extraResource: {name: "Essenza", amount: 7}},
  trasformazione: {mode: "self", actionEconomy: "Consumabile"},
  frustamagica: {mode: "point"},
  inversionecellulare: {healExpr: "2d10"},
  triboli: {mode: "area", area: {shape: "square", sideSquares: 4, anchor: "farthest"}},
  runadellaresurrezione: {rangeFt: 5, requireDead: true, extraResource: {name: "Essenza", amount: 10}},
  evocazionepermanente: {mode: "manual"},
  pugnaledighiaccio: {mode: "self"},
  miccettascasso: {minRangeFt: 20, damageExpr: "2d10"},
  bombascasso: {mode: "area", minRangeFt: 25, damageExpr: "3d10",
    area: {shape: "square", sideSquares: 3, anchor: "center"}},
  teleratsporto: {mode: "point"},
  evitaredifarelafinedeltopo: {mode: "self", actionEconomy: "Movimento"},
  sentenza: {damageExpr: "1d10"},
  investimento: {...PHYSICAL_ATTACK, rangeFt: 32.81, weaponAttack: {meleeOnly: true}},
  acquisizioneostile: {mode: "point", extraResource: {name: "Investimento", amount: 1}},
  partedelleone: {...PHYSICAL_ATTACK, mode: "multiple", targetCount: 2, allowSelf: true,
    targetRoles: [{label: "Bersaglio dell’attacco"}, {label: "Te o un alleato da curare", rangeFt: 30}],
    healExpr: "1d10", healOnResist: true, extraResource: {name: "Investimento", amount: 2},
    weaponAttack: {attackBonus: 10}},
  tagliodeicosti: {...PHYSICAL_ATTACK, extraResource: {name: "Investimento", amount: 1}, weaponAttack: {}},
  speculazione: {...PHYSICAL_ATTACK, extraResource: {name: "Investimento", amount: 1}, weaponAttack: {}},
  runadelcaos: {mode: "manual", extraResource: {name: "Essenza", amount: 3}},
  armasegreta: {variableCost: "(X − Fortuna)d8 PM"},
  fiammata: {mode: "multiple", damageExpr: "3d12", area: {shape: "cone", sideSquares: 6, anchor: "center"}},
  // Granted by equipped items (Catena del Predatore, Destino).
  afferra: {attackStats: ["Forza"], defenseStats: ["Forza"]},
  resurrezione: {requireDead: true, costResource: "Cariche"},
  stasipersonale: {mode: "self", actionEconomy: "Reazione", costResource: "Cariche"},
  stasiprotettiva: {relation: "ally", rangeFt: 32.81, actionEconomy: "Reazione", costResource: "Cariche"},
  fendituratemporale: {mode: "self", costResource: "Cariche"},
};

const modes: ReadonlySet<unknown> = new Set([
  "single", "multiple", "self", "area", "point", "ground", "manual",
]);

const isTargetMode = (value: unknown): value is TargetMode => modes.has(value);

const statNames = (value: unknown): string[] => {
  const raw = Array.isArray(value) ? value : [value];
  return [...new Set(raw.map(asTrimmedString).filter((name) => (
    /^[\p{L}][\p{L} ]{1,39}$/u.test(name) &&
    !["nessuno", "nessuna", "none", "no", "nonapplicabile", "vuoto"].includes(normalizedKey(name))
  )))].slice(0, 3);
};

const checkedChannel = (
  profile: CombatProfile, value: unknown, channel: string
): CombatCheck | null => {
  const entry = asRecord(value);
  const attackStats = statNames(entry.attackStats ?? [entry.Param1, entry.Param2]);
  const defenseStats = statNames(entry.defenseStats ?? entry.ParamTarget);
  if (!attackStats.length && !defenseStats.length && entry.attackDie !== true && entry.consent !== true) {
    return null;
  }
  return makeCheck(profile, {
    channel,
    attackStats,
    defenseStats,
    attackDie: typeof entry.attackDie === "boolean" ? entry.attackDie : undefined,
    defenseDie: typeof entry.defenseDie === "boolean" ? entry.defenseDie : undefined,
    consent: entry.consent === true,
  });
};

// Foe spells keep a description and a separate Effetti line; both reach the table.
const describeContent = (item: Fields): string => [...new Set([
  firstText(item.Descrizione, item.description),
  firstText(item.effetti, item.Effetto),
  firstText(item["Effetti Positivi"]),
  firstText(item["Effetti Negativi"]),
])].filter(Boolean).join("\n").slice(0, 2400);

// PM an equipped item takes off the cards it names under General.ridCostoTecSingola or
// ridCostoSpellSingola (older items keep the map at the root, as the Bazaar editors read it).
// A key names the card by its title or its catalog key. One item lowers a card once,
// however many of its keys name it, and distinct items stack as their Parametri do.
const equippedCostReduction = (
  slots: Record<string, Fields>, kind: Exclude<CombatKind, "weapon">, references: unknown[]
): number => {
  const field = kind === "spell" ? "ridCostoSpellSingola" : "ridCostoTecSingola";
  const names = new Set(references.map((value) => normalizedKey(asTrimmedString(value))).filter(Boolean));
  return [...new Set(Object.values(slots))].reduce((sum, item) => {
    const values = Object.entries(asRecord(asRecord(item.General)[field] ?? item[field]))
      .filter(([key]) => names.has(normalizedKey(key)))
      .map(([, value]) => readNumber(value))
      .filter((value): value is number => value !== null)
      .map(Math.trunc);
    return values.length ? sum + Math.max(...values) : sum;
  }, 0);
};

const actionText = (value: unknown): string => {
  const match = asTrimmedString(value).match(/tattic[ao]|movimento|consumabile|comunicazione|reazione/i);
  if (!match) return "";
  const word = match[0].toLowerCase();
  return word === "tattico" ? "Tattica" : word[0].toUpperCase() + word.slice(1);
};

// Null when the card cannot be used right now (a weapon technique without a weapon).
export const buildContentAction = (input: {
  id: string;
  kind: Exclude<CombatKind, "weapon">;
  scope: CombatScope;
  name: string;
  entry: Fields;
  profile: CombatProfile;
  weapons?: CombatAction[];
  sourceItem?: string;
  hasSheath?: boolean;
  // What the pawn has equipped now, and the key its catalog lists the card under.
  slots?: Record<string, Fields>;
  catalogKey?: string;
}): CombatAction | null => {
  const {id, kind, scope, name, entry, profile} = input;
  const key = normalizedKey(name);
  const legacy = LEGACY_COMBAT_RULES[key] ?? {};
  const weaponRule = legacy.weaponAttack && (scope === "common" || !legacy.weaponAttack.commonCard)
    ? legacy.weaponAttack : null;
  const weapon = weaponRule && input.weapons?.find((candidate) => !weaponRule.meleeOnly || candidate.melee);
  if (weaponRule?.commonCard && !weapon) return null;
  const metadata = asRecord(entry.combat ?? entry.Combattimento);
  const rawTarget = metadata.mode ?? metadata.target ?? entry.Bersaglio;
  const mode = isTargetMode(rawTarget) ? rawTarget : legacy.mode ?? (
    /^(?:se stess[oa]|su di te|incantatore|proprio personaggio)$/i.test(asTrimmedString(rawTarget))
      ? "self" : "single"
  );
  const specificRange = readRange(metadata.rangeFt ?? entry.Gittata ?? entry.range);
  // The card's own reach wins; a weapon attack without one uses the weapon's.
  const rangeFt = readRange(metadata.rangeFt) ?? legacy.rangeFt ?? specificRange ?? weapon?.rangeFt ?? null;
  const relation = metadata.relation === "ally" || metadata.relation === "selfOrAlly"
    ? metadata.relation : legacy.relation ?? "any";
  const roles: CombatContentRules["targetRoles"] | null = Array.isArray(metadata.targetRoles)
    ? metadata.targetRoles.map(asTrimmedString).filter(Boolean).slice(0, MAX_COMBAT_TARGETS)
      .map((label, index) => ({label, rangeFt: legacy.targetRoles?.[index]?.rangeFt}))
    : legacy.targetRoles ?? null;
  const targetCount = readNumber(metadata.targetCount) ?? legacy.targetCount ?? null;
  const targetNumber = (value: unknown, fallback: number): number =>
    Math.min(MAX_COMBAT_TARGETS, Math.max(0, Math.trunc(readNumber(value) ?? fallback)));
  const areaData = asRecord(metadata.area);
  const shape = areaData.shape ?? metadata.shape;
  const sideSquares = Math.min(12, Math.max(1, Math.trunc(
    readNumber(areaData.sideSquares ?? metadata.sideSquares) ?? 1
  )));
  const anchor = areaData.anchor ?? metadata.rangeAnchor;
  const area: CombatArea | null = shape === "square" || shape === "cone"
    ? {shape, sideSquares, anchor: anchor === "farthest" ? "farthest" : "center"}
    : legacy.area ?? null;
  const minDefault = ["manual", "point", "ground", "area"].includes(mode) && area?.shape !== "cone"
    ? 0 : 1;
  const maxDefault = mode === "multiple" || area?.shape === "cone" ? MAX_COMBAT_TARGETS : minDefault;
  const costText = entry.Costo ?? entry.cost;
  const essenzaMatch = firstText(costText).match(/(\d+)\s*(?:punti? (?:di )?)?essenza/i);
  // Charges belong to the granting item: a learned card with the same name pays its Costo in PM.
  const costResource = essenzaMatch ? "Essenza" : input.sourceItem ? legacy.costResource : undefined;
  const costAmount = Math.min(9999, Math.max(0, Math.trunc(Number(
    essenzaMatch?.[1] ?? readNumber(costText) ?? firstText(costText).match(/\d+/)?.[0] ?? 0
  ))));
  const extra = asRecord(metadata.extraResource ?? legacy.extraResource);
  const extraName = firstText(extra.name);
  const extraAmount = readNumber(extra.amount);
  const extraResource = extraName && extraAmount !== null && Number.isSafeInteger(extraAmount) && extraAmount > 0
    ? {name: extraName, amount: Math.min(9999, extraAmount)}
    : costResource && costAmount > 0 ? {name: costResource, amount: costAmount} : null;
  // A card paid in Essenza or charges never also costs PM.
  const baseCost = costResource ? 0 : Math.min(9999, Math.max(0, Math.trunc(
    readNumber(metadata.baseCost) ?? costAmount
  )));
  const reduction = Math.trunc(paramValue(locateStat(
    profile.parametri.Special, kind === "spell" ? "ridCostoSpell" : "ridCostoTec"
  )) ?? 0) + equippedCostReduction(input.slots ?? {}, kind, [
    name, input.catalogKey, entry.displayName, entry.Nome, entry.name,
  ]);
  const consent = metadata.targetConsent === true || legacy.targetConsent === true;
  const legacyCheck = checkedChannel(profile, {
    attackStats: metadata.attackStats ?? legacy.attackStats,
    defenseStats: metadata.defenseStats ?? legacy.defenseStats,
    attackDie: metadata.attackDie,
    defenseDie: metadata.defenseDie,
  }, kind === "spell" ? "TPC" : "Fisico");
  const configuredChecks = Array.isArray(metadata.checks)
    ? metadata.checks.map((candidate) => checkedChannel(
      profile, candidate, firstText(asRecord(candidate).channel).slice(0, 50)
    ))
    : [
      checkedChannel(profile, entry.TPC, "TPC"),
      checkedChannel(profile, entry["TPC Fisico"], "Fisico"),
      checkedChannel(profile, entry["TPC Mentale"], "Mentale"),
    ];
  const storedChecks = configuredChecks.filter((check): check is CombatCheck =>
    Boolean(check?.channel)
  ).slice(0, 8);
  const checks = [
    // The legacy schema cannot name every defender stat: a stored check on the
    // rule's stat without a defender takes the rule's opposition.
    ...(storedChecks.length ? storedChecks.map((stored) => (
      legacyCheck?.opposed && !stored.opposed && stored.attackLabel === legacyCheck.attackLabel
        ? {...legacyCheck, channel: stored.channel} : stored
    )) : legacyCheck ? [legacyCheck] : []),
    ...(consent ? [makeCheck(profile, {
      channel: "Consenso", attackStats: [], defenseStats: [], attackDie: false, consent: true,
    })] : []),
  ].map((candidate) => weapon && candidate.attackLabel === "Mira"
    ? {...candidate, attackBonus: weapon.attackBonus} : candidate);
  const check = checks.find((candidate) => candidate.consent) ??
    checks.find((candidate) => candidate.opposed) ?? checks[0] ??
    makeCheck(profile, {channel: "", attackStats: [], defenseStats: [], attackDie: false});
  // A structured field is the whole expression or a table roll, never a prefix of it. The card's
  // own field wins over the named rule, which only fills in cards that have none.
  const cardDamage = firstText(metadata.damageExpr, entry.Danno, entry.danni, legacy.damageExpr);
  const cardHeal = firstText(metadata.healExpr, entry.Cura, legacy.healExpr);
  const ownDamage = cardDamage ? fieldExpression(cardDamage)
    : diceExpression(firstText(entry["Effetti Negativi"]).match(PROSE_DAMAGE)?.[1] ?? "");
  const healExpr = fieldExpression(cardHeal);
  const damageBands = legacy.damageBands ?? [];
  // A field that says more than its formula ("2d6 danni per turno") keeps its words for the table.
  const fieldNote = (label: string, text: string, expr: string): string =>
    !text ? "" : !expr ? `${label} da tirare al tavolo: ${text}` : text !== expr ? `${label}: ${text}` : "";
  const tableRolls = [
    fieldNote("Danno", cardDamage, ownDamage),
    fieldNote("Cura", cardHeal, healExpr),
  ].filter(Boolean).join("\n");
  const attackStat = combatStat(profile, "Attacco") ?? 0;
  const description = [
    describeContent(entry),
    ...(weaponRule ? [
      weapon ? `Arma impugnata · ${weapon.name}` : UNARMED_DAMAGE,
      weaponRule.attackBonus ? `Attacco ${attackStat} + ${weaponRule.attackBonus}` : "",
    ] : []),
  ].filter(Boolean).join("\n");
  const actionEconomy = key === "cambiosetarmi"
    ? (input.hasSheath ? "Consumabile" : "Tattica")
    : actionText(metadata.actionEconomy ?? entry.Azione ?? entry.azione) || legacy.actionEconomy || "Tattica";
  return {
    ...baseAction({...check, id, kind, scope, name, die: profile.die}),
    sourceItem: input.sourceItem ?? "",
    description,
    mode,
    relation,
    rangeFt,
    minRangeFt: Math.max(0, readNumber(metadata.minRangeFt) ?? legacy.minRangeFt ?? 0),
    minTargets: targetNumber(metadata.minTargets, targetCount ?? minDefault),
    maxTargets: targetNumber(metadata.maxTargets, targetCount ?? maxDefault),
    targetRoles: roles?.map(({label}) => label) ?? null,
    roleRangesFt: roles?.map((role) => role.rangeFt ?? rangeFt) ?? null,
    area,
    allowSelf: metadata.allowSelf === true || legacy.allowSelf === true ||
      mode === "self" || relation === "selfOrAlly",
    allowDead: metadata.allowDead === true || legacy.allowDead === true ||
      metadata.targetState === "dead" || legacy.requireDead === true,
    requireDead: metadata.targetState === "dead" || legacy.requireDead === true,
    baseCost,
    cost: baseCost > 0 ? Math.min(9999, Math.max(1, baseCost - reduction)) : 0,
    extraResource,
    variableCost: firstText(metadata.variableCost, legacy.variableCost) || null,
    checks,
    damageExpr: weaponRule ? weapon?.damageExpr ?? "" : ownDamage,
    damageBands,
    healExpr,
    healOnResist: legacy.healOnResist === true,
    actionEconomy,
    canActOffTurn: actionEconomy === "Reazione" ||
      (scope === "common" && (legacy.canActOffTurn === true || metadata.canActOffTurn === true)),
    // What the app does not roll stays with the table: the card's own effect,
    // an expression it cannot evaluate, the damage of an unarmed attack.
    manualEffect: firstText(metadata.manualEffect) || tableRolls || (
      description && !ownDamage && !healExpr && !damageBands.length ? description
        : weaponRule && !weapon ? UNARMED_DAMAGE : ""
    ),
    turns: Math.max(0, Math.trunc(readNumber(entry.Turni) ?? 0)),
    art: scope === "common" ? safeArtwork(entry.image_url ?? entry.imageUrl) : "",
    media: artworkMedia(entry),
    ...(weaponRule && {attackStat: attackStat + (weaponRule.attackBonus ?? 0)}),
    ...(weapon && {
      attackModifiers: weapon.attackModifiers,
      damageBonus: weapon.damageBonus,
      criticalExpr: weapon.criticalExpr,
      criticalBonus: weapon.criticalBonus,
      hands: weapon.hands,
      melee: weapon.melee,
    }),
  };
};
