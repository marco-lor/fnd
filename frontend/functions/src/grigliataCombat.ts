import {randomInt} from "crypto";
import {getApp} from "firebase-admin/app";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import type {
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import {HttpsError, onCall} from "firebase-functions/v2/https";
import {assertActiveCaller} from "./callerAuthorization";
import {
  buildContentAction,
  buildWeaponActions,
  combatCost,
  combatCritical,
  combatDamageBalances,
  combatDamageBase,
  combatDamageEligible,
  combatDamageProposal,
  combatDamageSplit,
  combatDie,
  combatDistance,
  combatInRange,
  combatResources,
  combatRoleRange,
  combatStatus,
  combatWeaponDamage,
  compareCombatRolls,
  equippedCombatItem,
  equippedItemSpells,
  getCombatDefense,
  makeCombatRoll,
  rollCombatDamage,
  CombatAction,
  CombatCell,
  CombatDefense,
  CombatDamageDetails,
  CombatEffect,
  CombatPawn,
  CombatProblem,
  CombatProfile,
  CombatResources,
  CombatRoll,
  CombatTarget,
  CombatTrial,
  MAX_COMBAT_TARGETS,
} from "./grigliataCombatCore";
import {
  asFiniteNumber,
  asRecord,
  asTrimmedString,
  hashValue,
  isValidFirestoreDocumentId,
  operationReceiptId,
  USER_DATA_SCHEMA_VERSION,
  validateOperationId,
} from "./userDataV2";

const REGION = "europe-west1";
const ACTIONS = "grigliata_combat_actions";
const REQUESTS = "grigliata_combat_requests";
const PLACEMENTS = "grigliata_token_placements";
const TOKENS = "grigliata_tokens";
const COMMON_CONTENT = [
  {kind: "spell", collection: "spells", document: "spells_common"},
  {kind: "tecnica", collection: "tecniche", document: "tecniche_common"},
] as const;

type Fields = Record<string, unknown>;
type CharacterState = {
  profile: CombatProfile;
  resources: CombatResources;
  resourcesRef: DocumentReference;
  character: boolean;
  summary: Fields;
  inventory: Fields;
};
type BoardPawn = {pawn: CombatPawn; token: DocumentSnapshot; visible: boolean; dead: boolean};
type Context = {db: Firestore; transaction: Transaction; uid: string; manager: boolean};
type CombatEvent = {
  backgroundId: string;
  actorUid: string;
  actor: CombatPawn;
  kind?: unknown;
  action: CombatAction;
  targets: CombatTarget[];
  effects: CombatEffect[];
  // Players read the journal only when this is true; older events may lack it.
  shared?: unknown;
};

const fail = (code: ConstructorParameters<typeof HttpsError>[0], message: string): never => {
  throw new HttpsError(code, message);
};

const requiredUid = (value: unknown): string =>
  asTrimmedString(value) || fail("unauthenticated", "Accedi per usare la Grigliata.");

const docId = (value: unknown, name: string): string => {
  const id = asTrimmedString(value);
  if (!isValidFirestoreDocumentId(id) || id.length > 512) {
    return fail("invalid-argument", `${name} non valido.`);
  }
  return id;
};

const isCellNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= 100000;

const parsePoint = (value: unknown): CombatCell | null => {
  if (value === undefined || value === null) return null;
  const {col, row} = asRecord(value);
  if (!isCellNumber(col) || !isCellNumber(row)) {
    return fail("invalid-argument", "Le coordinate sulla mappa non sono valide.");
  }
  return {col, row};
};

const roll = (sides: number): number => randomInt(1, sides + 1);

const assertCombatProject = (): void => {
  const projectId = getApp().options.projectId ||
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (projectId !== "fatin-test" &&
    !(projectId === "demo-fnd-perf" && process.env.FUNCTIONS_EMULATOR === "true")) {
    fail("failed-precondition", "L'Arsenale è disponibile su Fatin Test.");
  }
};

const withCaller = async <T>(
  uid: string,
  command: (context: Context) => Promise<T>
): Promise<T> => {
  assertCombatProject();
  const db = getFirestore();
  try {
    return await db.runTransaction(async (transaction) => {
      const [caller, deletion] = await transaction.getAll(
        db.doc(`users/${uid}`), db.doc(`user_deletion_jobs/${uid}`)
      );
      assertActiveCaller(caller);
      if (deletion.exists || caller.get("disabled") === true) {
        fail("permission-denied", "L'account non è attivo.");
      }
      return command({db, transaction, uid, manager: caller.get("role") === "dm"});
    });
  } catch (error) {
    if (error instanceof CombatProblem) throw new HttpsError(error.code, error.message);
    throw error;
  }
};

const readActiveBoard = async (context: Context, backgroundId: string): Promise<DocumentSnapshot> => {
  const {db, transaction} = context;
  const [state, board] = await transaction.getAll(
    db.doc("grigliata_state/current"),
    db.doc(`grigliata_backgrounds/${backgroundId}`)
  );
  if (state.get("activeBackgroundId") !== backgroundId || !board.exists) {
    fail("failed-precondition", "La mappa selezionata non è più attiva.");
  }
  return board;
};

// Older character placements have no tokenId; the board reads them as the owner's token.
const placementTokenId = (data: Fields): string =>
  asTrimmedString(data.tokenId) || asTrimmedString(data.ownerUid);

const readPawns = async (
  {db, transaction, manager}: Context,
  backgroundId: string,
  placementIds: string[]
): Promise<BoardPawn[]> => {
  const placements = await transaction.getAll(...placementIds.map((id) => db.doc(`${PLACEMENTS}/${id}`)));
  const tokenRefs = new Map<string, DocumentReference>();
  placements.forEach((placement) => {
    const tokenId = placementTokenId(asRecord(placement.data()));
    // For players a hidden pawn is not on the map: it answers exactly like an absent one.
    if (!placement.exists || !isValidFirestoreDocumentId(tokenId) ||
      (!manager && placement.get("isVisibleToPlayers") === false) ||
      placement.get("backgroundId") !== backgroundId ||
      placement.id !== `${backgroundId}__${tokenId}`) {
      fail("failed-precondition", "Una pedina non è più piazzata sulla mappa.");
    }
    tokenRefs.set(tokenId, db.doc(`${TOKENS}/${tokenId}`));
  });
  const tokens = new Map((await transaction.getAll(...tokenRefs.values())).map(
    (token) => [token.id, token]
  ));
  return placements.map((placement) => {
    const tokenId = placementTokenId(asRecord(placement.data()));
    const token = tokens.get(tokenId);
    const ownerUid = asTrimmedString(token?.get("ownerUid"));
    if (!token?.exists || !isValidFirestoreDocumentId(ownerUid) ||
      ownerUid !== placement.get("ownerUid") || token.get("deletionState") === "pending" ||
      token.get("task06Deletion.status") === "pending") {
      return fail("failed-precondition", "La pedina non è più disponibile.");
    }
    const {col, row} = asRecord(placement.data());
    if (!isCellNumber(col) || !isCellNumber(row)) {
      return fail("failed-precondition", "La pedina non ha coordinate valide.");
    }
    return {
      pawn: {
        ownerUid,
        tokenId,
        placementId: placement.id,
        col,
        row,
        sizeSquares: Math.max(1, Math.min(20, Math.trunc(asFiniteNumber(placement.get("sizeSquares"), 1)))),
        name: (asTrimmedString(placement.get("label")) || asTrimmedString(token.get("label")) || "Pedina").slice(0, 160),
      },
      token,
      dead: placement.get("isDead") === true,
      visible: placement.get("isVisibleToPlayers") !== false,
    };
  });
};

const readCharacterState = async (
  {db, transaction}: Context,
  {pawn, token}: BoardPawn
): Promise<CharacterState> => {
  if (token.get("tokenType") !== "character") {
    const stats = asRecord(token.get("stats"));
    return {
      character: false,
      profile: {
        die: combatDie(token.get("dadoAnima")),
        parametri: asRecord(token.get("Parametri")),
        level: asFiniteNumber(stats.level, 1),
      },
      resources: combatResources(stats),
      resourcesRef: token.ref,
      summary: asRecord(token.data()),
      inventory: asRecord(token.get("equipped")),
    };
  }
  const root = `users/${pawn.ownerUid}`;
  const [owner, progression, resources, equipment, config] = await transaction.getAll(
    db.doc(root),
    db.doc(`${root}/state/progression`),
    db.doc(`${root}/state/resources`),
    db.doc(`${root}/state/equipment`),
    db.doc("utils/varie")
  );
  assertActiveCaller(owner);
  const summary = asRecord(owner.data());
  const stats = asRecord(summary.stats);
  const level = asFiniteNumber(asRecord(progression.get("stats")).level ?? stats.level, 1);
  const dice = config.get("dadiAnimaByLevel");
  const die = combatDie(Array.isArray(dice) ? dice[level] : asRecord(dice)[level]);
  return {
    character: true,
    profile: {
      level,
      die: die ?? (level >= 8 ? 20 : level >= 4 ? 12 : 10),
      parametri: asRecord(progression.get("Parametri") ?? summary.Parametri),
    },
    resources: combatResources({...stats, ...asRecord(resources.get("stats"))}),
    resourcesRef: resources.ref,
    summary,
    inventory: asRecord(equipment.get("slots") ?? equipment.get("equipped") ?? summary.equipped),
  };
};

const slotInventoryId = (entry: unknown): string => {
  const item = asRecord(entry);
  return asTrimmedString(
    typeof entry === "string" ? entry : asRecord(item._task05).inventoryId ??
      asRecord(item._instance).instanceId ?? item.inventoryId
  );
};

const readSlots = async (
  {db, transaction}: Context,
  pawn: CombatPawn,
  state: CharacterState
): Promise<Record<string, Fields>> => {
  const entries = Object.entries(state.inventory).filter(
    ([slot, entry]) => !/^beltC\d+$/.test(slot) && Boolean(entry)
  );
  const ids = [...new Set(entries.map(([, value]) => slotInventoryId(value))
    .filter((id) => isValidFirestoreDocumentId(id)))];
  const snapshots = state.character && ids.length ? await transaction.getAll(
    ...ids.map((id) => db.doc(`users/${pawn.ownerUid}/inventory/${id}`))
  ) : [];
  const items = new Map(snapshots.filter((item) => item.exists).map(
    (item) => [item.id, equippedCombatItem(item.data())]
  ));
  return Object.fromEntries(entries.flatMap(([slot, value]) => {
    const id = slotInventoryId(value);
    const item = id ? items.get(id) : undefined;
    if (item) return [[slot, item]];
    // A stale canonical ID must stay empty. Older embedded slots carry a snapshot.
    if (typeof value === "string") return [];
    const legacy = equippedCombatItem(value);
    return Object.keys(legacy).length ? [[slot, legacy]] : [];
  }));
};

const contentEntries = (value: unknown): [string, Fields][] => (
  Array.isArray(value)
    ? value.map((raw, index) => [asTrimmedString(asRecord(raw).id) || String(index), asRecord(raw)])
    : Object.entries(asRecord(value)).map(([key, raw]) => [key, asRecord(raw)])
);

const readArsenal = async (
  context: Context,
  boardPawn: BoardPawn,
  state: CharacterState
) => {
  const {db, transaction} = context;
  const {pawn} = boardPawn;
  const [slots, ...sources] = await Promise.all([
    readSlots(context, pawn, state),
    ...COMMON_CONTENT.map(async (source) => {
      const [common, personal, legacyCommon] = await Promise.all([
        transaction.get(db.doc(`utils/${source.document}`)),
        state.character ? transaction.get(db.collection(
          `users/${pawn.ownerUid}/${source.collection}`
        )) : null,
        transaction.get(db.doc("utils/utils")),
      ]);
      return {source, common, personal, legacyCommon};
    }),
  ] as const);
  const weapons = buildWeaponActions({...state.profile, slots});
  const read = (
    kind: "spell" | "tecnica", scope: CombatAction["scope"], id: string,
    entry: Fields, fallback: string, sourceItem = ""
  ): CombatAction[] => {
    if (!Object.keys(entry).length) return [];
    const name = (asTrimmedString(entry.displayName ?? entry.Nome ?? entry.name) || fallback).slice(0, 160);
    const action = name ? buildContentAction({
      id, kind, scope, sourceItem, entry, name, profile: state.profile,
      weapons: weapons.actions, hasSheath: Boolean(slots.foderoArma), slots, catalogKey: fallback,
    }) : null;
    return action ? [action] : [];
  };
  const content = sources.flatMap(({source, common, personal, legacyCommon}) => {
    const existing = personal?.docs.flatMap((item) =>
      read(source.kind, "personal", `personal:${item.id}`, asRecord(item.data()), "")
    ) ?? [];
    const canonicalNames = new Set(existing.map((action) => action.name));
    const legacy = contentEntries(state.summary[source.collection]).flatMap(([key, data]) =>
      read(source.kind, "personal", `personal:legacy:${key}`, data, key)
        .filter(({name}) => !canonicalNames.has(name))
    );
    const commonEntries = contentEntries(common.data() ?? legacyCommon.get(source.document))
      .flatMap(([key, item]) => read(source.kind, "common", `common:${key}`, item, key));
    return [...existing, ...legacy, ...commonEntries];
  });
  const granted = equippedItemSpells(slots).flatMap(({id, key, entry, sourceItem}) =>
    read("spell", "equipped", id, entry, key, sourceItem)
  );
  // The version lets a launch refuse a definition that changed after the panel showed it.
  // Item grants come first: they follow what is equipped now and are easy to lose in a long repertoire.
  const actions = [...weapons.actions, ...granted, ...content]
    .map((action) => ({...action, version: hashValue(publicAction(action)).slice(0, 16)}));
  return {actions, equipped: weapons.equipped};
};

const assertActor = ({uid, manager}: Context, actor: BoardPawn): void => {
  if (actor.pawn.ownerUid !== uid || (!actor.visible && !manager)) {
    fail("permission-denied", "Puoi agire soltanto con una pedina che controlli.");
  }
  if (actor.dead) fail("failed-precondition", "La pedina è incapacitata.");
};

export const getGrigliataCombatArsenal = onCall(
  {region: REGION},
  async (request) => {
    const uid = requiredUid(request.auth?.uid);
    const data = asRecord(request.data);
    const backgroundId = docId(data.backgroundId, "Mappa");
    const actorPlacementId = docId(data.actorPlacementId, "Pedina");
    return withCaller(uid, async (context) => {
      await readActiveBoard(context, backgroundId);
      const [placement] = await readPawns(context, backgroundId, [actorPlacementId]);
      assertActor(context, placement);
      const state = await readCharacterState(context, placement);
      return {
        actor: {...placement.pawn, ...state.resources},
        ...(await readArsenal(context, placement, state)),
      };
    });
  }
);

const defenseRequestId = (combatId: string, placementId: string): string =>
  hashValue([combatId, placementId]);

const publicAction = (action: CombatAction): CombatAction => ({...action, art: "", media: null});

const COMBAT_KINDS: ReadonlySet<unknown> = new Set(["weapon", "spell", "tecnica"]);
const OWNER_DAMAGE_FIELDS = ["ownerUid", "backgroundId", "combatId", "ownerDamageUpdatedAt", "ownerDamage"];
// A request with this status is no defense: it is damage that landed at once, shown
// in its owner's Home until the first application settles it as done.
const DAMAGE_PENDING = "damagePending";
type OwnerDamageSource = Pick<CombatEvent, "backgroundId" | "kind" | "action" | "effects" | "shared">;
type OwnerDamageRequest = {ref: DocumentReference; pending: boolean};

// The damage a target's owner may apply, on their private request: Home shows it
// for confirmation, and a journal the owner cannot read (not shared) is replaced
// by it in the log. It names no actor, no cell, no roll and no other target. Null
// when this target has no concrete damage to apply.
const ownerDamageFields = (
  combatId: string, event: OwnerDamageSource, target: CombatTarget
): Fields | null => {
  const damage = combatDamageBase(target, event.effects);
  const {ownerUid} = target;
  if (damage === null || typeof ownerUid !== "string" || !isValidFirestoreDocumentId(ownerUid)) return null;
  const action = asRecord(event.action);
  const applied = asRecord(target.damageApplied).amount;
  return {
    ownerUid,
    backgroundId: event.backgroundId,
    combatId,
    ownerDamageUpdatedAt: FieldValue.serverTimestamp(),
    ownerDamage: {
      kind: [event.kind, action.kind].find((kind) => COMBAT_KINDS.has(kind)) ?? null,
      action: {name: asTrimmedString(action.name), hands: asFiniteNumber(action.hands, 0)},
      target: {
        placementId: target.placementId,
        name: asTrimmedString(target.name),
        ownerUid,
        status: "done",
        round: asFiniteNumber(target.round, 1),
        outcome: target.outcome,
        damage,
        critical: target.critical ?? null,
        damageApplied: typeof applied === "number" && Number.isSafeInteger(applied) && applied >= 0
          ? {amount: applied} : null,
      },
    },
  };
};

// Where a later change of a target's damage reaches its owner, read once before the
// transaction writes: the request the action left for this target, else a new
// private one while the journal is not shared. A shared action without a request
// (from before confirmations existed) never gains one.
const ownerDamageRequest = async (
  {db, transaction}: Context, combatId: string, event: OwnerDamageSource, placementId: string
): Promise<OwnerDamageRequest | null> => {
  const ref = db.doc(`${REQUESTS}/${defenseRequestId(combatId, placementId)}`);
  const request = await transaction.get(ref);
  if (!request.exists && event.shared === true) return null;
  return {ref, pending: request.get("status") === DAMAGE_PENDING};
};

// Replaces the projection as a whole and leaves every other field of the request,
// such as a defense still waiting, as it is. Applied damage settles a pending
// confirmation; no other status is ever written here.
const projectOwnerDamage = (
  {transaction}: Context, request: OwnerDamageRequest | null,
  combatId: string, event: OwnerDamageSource, target: CombatTarget
): void => {
  const fields = request && ownerDamageFields(combatId, event, target);
  if (!request || !fields) return;
  const settled = request.pending && target.damageApplied ? {status: "done"} : {};
  transaction.set(request.ref, {...fields, ...settled}, {
    mergeFields: [...OWNER_DAMAGE_FIELDS, ...Object.keys(settled)],
  });
};

const readAffectedPawns = async (
  {db, transaction, manager}: Context,
  backgroundId: string,
  action: CombatAction,
  point: CombatCell | null,
  targets: CombatPawn[],
  fogEnabled: boolean
) => {
  if (action.area?.shape === "cone") return {affected: targets, visible: true};
  if (fogEnabled || !point || action.area?.shape !== "square") return {affected: [], visible: true};
  const sizeSquares = action.area.sideSquares;
  const shift = Math.floor((sizeSquares - 1) / 2);
  const area = {col: point.col - shift, row: point.row - shift, sizeSquares};
  const {docs} = await transaction.get(db.collection(PLACEMENTS).where("backgroundId", "==", backgroundId));
  const areaPawns = docs.flatMap((doc) => {
    const data = asRecord(doc.data());
    const {col, row, ownerUid, label, isVisibleToPlayers, isDead} = data;
    const tokenId = placementTokenId(data);
    if (!isCellNumber(col) || !isCellNumber(row) || !tokenId ||
      typeof ownerUid !== "string" || (isVisibleToPlayers === false && !manager) ||
      (isDead === true && !action.allowDead)) return [];
    const pawn = {
      col, row, tokenId, ownerUid, placementId: doc.id,
      name: (asTrimmedString(label) || "Pedina").slice(0, 160),
      sizeSquares: Math.max(1, Math.min(20, Math.trunc(asFiniteNumber(doc.get("sizeSquares"), 1)))),
    };
    return combatDistance(area, pawn) === 0 ? [{pawn, visible: isVisibleToPlayers !== false}] : [];
  }).slice(0, 100);
  return {affected: areaPawns.map(({pawn}) => pawn), visible: areaPawns.every(({visible}) => visible)};
};

const effect = (
  kind: CombatEffect["kind"],
  label: string,
  expr: string,
  targetPlacementId: string | null
): CombatEffect => ({
  kind,
  label,
  expr,
  amount: expr ? rollCombatDamage(expr, roll) : null,
  targetPlacementId,
});

const proposeDamage = (action: CombatAction, actor: CombatCell, target: CombatPawn): CombatEffect[] => {
  const proposal = combatDamageProposal(action, combatDistance(actor, target));
  return proposal ? [effect(proposal.kind, proposal.label, proposal.expr, target.placementId)] : [];
};

const attackRoll = (action: CombatAction, advantage: boolean): CombatRoll | null => {
  if (!action.attackLabel && !action.attackDie) return null;
  if (action.attackDie && !action.die) {
    return fail("failed-precondition", "Il Dado Anima dell'attore non è configurato.");
  }
  return makeCombatRoll(
    action.attackLabel || "Anima", action.attackBonus,
    action.attackDie ? action.die : null, roll, advantage
  );
};

// Characters' balances live in their canonical resources document, with its
// revision; other pawns keep them on the token.
const storeResources = (
  {uid, transaction}: Context,
  target: {resourcesRef: DocumentReference; character: boolean},
  stats: Record<string, number>
): void => {
  if (!Object.keys(stats).length) return;
  transaction.set(target.resourcesRef, {
    stats,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: uid,
    ...(target.character ? {
      schemaVersion: USER_DATA_SCHEMA_VERSION,
      revision: FieldValue.increment(1),
    } : {}),
  }, {merge: true});
};

const storeCost = (
  context: Context,
  state: CharacterState,
  cost: ReturnType<typeof combatCost>
): void => {
  const stats: Record<string, number> = {};
  (["hp", "mana", "essenza"] as const).forEach((key) => {
    if (cost[key] > 0) stats[`${key}Current`] = (state.resources[key] ?? 0) - cost[key];
  });
  storeResources(context, state, stats);
};

const launchCombat = async (context: Context, input: Fields) => {
  const {db, transaction, uid} = context;
  const backgroundId = docId(input.backgroundId, "Mappa");
  const actorPlacementId = docId(input.actorPlacementId, "Pedina");
  const operationId = validateOperationId(input.operationId);
  const actionId = asTrimmedString(input.actionId);
  const kind: unknown = input.kind;
  const channel = asTrimmedString(input.channel);
  const point = parsePoint(input.point);
  const actionVersion = input.actionVersion === undefined ? null : asTrimmedString(input.actionVersion);
  if (!operationId || !actionId || actionId.length > 220 || channel.length > 50 ||
    (actionVersion !== null && (!actionVersion || actionVersion.length > 64)) ||
    (kind !== "weapon" && kind !== "spell" && kind !== "tecnica") ||
    !Array.isArray(input.targetPlacementIds) || input.targetPlacementIds.length > MAX_COMBAT_TARGETS) {
    return fail("invalid-argument", "L'azione dichiarata non è valida.");
  }
  const ids = input.targetPlacementIds.map((value) => docId(value, "Bersaglio"));
  if (new Set(ids).size !== ids.length) {
    return fail("invalid-argument", "Scegli bersagli diversi.");
  }
  const approval = {
    confirmHp: input.confirmHp === true,
    maxHpCost: typeof input.maxHpCost === "number" ? input.maxHpCost : undefined,
    confirmExtra: input.confirmExtra === true,
    variableCost: typeof input.variableCost === "number" ? input.variableCost : undefined,
  };
  const combatId = operationReceiptId(uid, operationId);
  const actionRef = db.doc(`${ACTIONS}/${combatId}`);
  // Without a version the hash keeps its earlier shape, so a retry from an older client still matches.
  const requested = hashValue({
    backgroundId, actorPlacementId, actionId, kind, channel, point, ids, approval,
    ...(actionVersion !== null && {actionVersion}),
  });
  const existing = await transaction.get(actionRef);
  if (existing.exists) {
    if (existing.get("actorUid") !== uid || existing.get("requestHash") !== requested) {
      return fail("already-exists", "Questo identificativo appartiene a un'altra azione.");
    }
    return {combatId};
  }
  const board = await readActiveBoard(context, backgroundId);
  const [actor, ...otherPawns] = await readPawns(context, backgroundId, [
    actorPlacementId, ...ids.filter((id) => id !== actorPlacementId),
  ]);
  assertActor(context, actor);
  const actorState = await readCharacterState(context, actor);
  const {actions} = await readArsenal(context, actor, actorState);
  const definition = actions.find((option) => option.kind === kind && option.id === actionId);
  if (!definition) return fail("not-found", "L'azione non è nel repertorio della pedina.");
  if (actionVersion !== null && actionVersion !== definition.version) {
    return fail("failed-precondition", "L'azione è cambiata: controlla l'arsenale aggiornato.");
  }
  const check = channel && channel !== definition.channel
    ? definition.checks.find((option) => option.channel === channel)
    : null;
  if (channel && channel !== definition.channel && !check) {
    return fail("invalid-argument", "Il canale di prova non è disponibile.");
  }
  const action = publicAction({...definition, ...check});
  const activeTurnTokenId = asTrimmedString(asRecord(board.get("turnOrderActive")).tokenId);
  if (activeTurnTokenId && actor.pawn.tokenId !== activeTurnTokenId && !action.canActOffTurn) {
    return fail("failed-precondition", "Questa azione richiede il turno della pedina.");
  }
  const pawnsById = new Map([actor, ...otherPawns].map((entry) => [entry.pawn.placementId, entry]));
  const targetIds = action.mode === "self" && !ids.length ? [actorPlacementId] : ids;
  const targetPawns = targetIds.map((id) => pawnsById.get(id)).filter((pawn): pawn is BoardPawn => Boolean(pawn));
  const needsPoint = action.mode === "point" || action.mode === "ground" ||
    (action.mode === "area" && action.area?.shape !== "cone");
  if (targetPawns.length < action.minTargets || targetPawns.length > action.maxTargets ||
    needsPoint !== Boolean(point) ||
    (action.mode === "self" && (targetIds.length !== 1 || targetIds[0] !== actorPlacementId))) {
    return fail("invalid-argument", "Completa la selezione dei bersagli sulla mappa.");
  }
  if (point && !combatInRange(actor.pawn, point, action)) {
    return fail("failed-precondition", "Il punto scelto è fuori gittata.");
  }
  const cost = combatCost(action, actorState.resources, approval);
  const effects: CombatEffect[] = [];
  const attacks: {target: CombatTarget; defense: CombatDefense | null}[] = [];
  for (const [index, targetPawn] of targetPawns.entries()) {
    const targetId = targetPawn.pawn.placementId;
    const primaryRole = !action.targetRoles || index === 0;
    if (targetId === actorPlacementId && (!action.allowSelf || (action.targetRoles && primaryRole))) {
      return fail("invalid-argument", "Questa azione richiede un'altra pedina.");
    }
    // A fallen target is one the board marks as such, exactly what the picker shows.
    if ((targetPawn.dead && !action.allowDead) || (action.requireDead && !targetPawn.dead)) {
      return fail("failed-precondition", action.requireDead
        ? "L'azione richiede un bersaglio caduto."
        : "L'azione richiede un bersaglio attivo.");
    }
    if (!combatInRange(actor.pawn, targetPawn.pawn, action, combatRoleRange(action, index))) {
      return fail("failed-precondition", `${targetPawn.pawn.name} è fuori gittata.`);
    }
    const targetState = targetId === actorPlacementId ? actorState
      : await readCharacterState(context, targetPawn);
    const opposed = action.opposed && primaryRole &&
      !(action.consent && targetId === actorPlacementId);
    let advantage = false;
    if (action.melee && targetState.character) {
      const targetSlots = await readSlots(context, targetPawn.pawn, targetState);
      advantage = !buildWeaponActions({...targetState.profile, slots: targetSlots}).armed;
    }
    const attack = primaryRole ? attackRoll(action, advantage) : null;
    const target: CombatTarget = {
      ...targetPawn.pawn, attack, defense: null, trials: [], advantage,
      status: opposed ? "waiting" : "done", round: 1, damage: null, damageDetails: null, critical: null,
      outcome: opposed || !primaryRole ? null : action.consent ? "accepted" : action.mode === "manual" ? "manual" : "applied",
    };
    if (!opposed && !action.targetRoles) {
      effects.push(...proposeDamage(action, actor.pawn, targetPawn.pawn));
      if (action.healExpr) effects.push(effect("heal", "Cura proposta", action.healExpr, targetId));
    }
    attacks.push({
      target,
      defense: opposed ? getCombatDefense({...action, kind: action.hands > 0 ? "weapon" : kind}, targetState.profile) : null,
    });
  }
  if (!attacks.length) {
    if (action.damageExpr) effects.push(effect("damage", "Danno proposto", action.damageExpr, null));
    if (action.healExpr) effects.push(effect("heal", "Cura proposta", action.healExpr, null));
  }
  const pairedRecipient = action.targetRoles && attacks[1]?.target;
  if (pairedRecipient && action.healExpr && attacks[0]?.target.outcome) {
    effects.push(effect("heal", "Cura proposta", action.healExpr, pairedRecipient.placementId));
    pairedRecipient.outcome = "applied";
  }
  if (action.manualEffect || action.mode === "manual" || (action.extraResource && !cost.essenza)) {
    effects.push(effect("manual", "Effetto da confermare al tavolo", "", null));
  }
  const attack = attacks[0]?.target.attack ?? (attacks.length ? null : attackRoll(action, false));
  const targets = attacks.map(({target}) => target);
  const status = combatStatus(targets);
  const areaTargets = await readAffectedPawns(
    context, backgroundId, action, point, targetPawns.map(({pawn}) => pawn),
    board.get("fogOfWarEnabled") !== false
  );
  const actorSummary = {...actor.pawn, ...actorState.resources};
  const now = FieldValue.serverTimestamp();
  const shared = actor.visible && areaTargets.visible && targetPawns.every((pawn) => pawn.visible);
  storeCost(context, actorState, cost);
  transaction.create(actionRef, {
    schemaVersion: 1, backgroundId, actorUid: uid, actor: actor.pawn, kind, action, point, targets, status,
    attack, cost: {...cost, extra: action.extraResource}, effects, requestHash: requested,
    affected: areaTargets.affected,
    shared,
    createdAt: now, updatedAt: now,
    resolvedAt: status === "done" ? now : null,
  });
  for (const {target, defense} of attacks) {
    const requestRef = db.doc(`${REQUESTS}/${defenseRequestId(combatId, target.placementId)}`);
    if (!defense) {
      // Concrete damage that lands at once waits for its owner's confirmation in Home, shared or not.
      const fields = ownerDamageFields(combatId, {backgroundId, kind, action, effects, shared}, target);
      if (fields) transaction.create(requestRef, {...fields, status: DAMAGE_PENDING, createdAt: now});
      continue;
    }
    transaction.create(requestRef, {
      schemaVersion: 1, combatId, backgroundId, ownerUid: target.ownerUid,
      // The defender gets names only, never a token or a position: a hidden attacker stays
      // unnamed, and a hidden target's cell stays with the DM.
      actor: {name: actor.visible ? actor.pawn.name : "Attaccante nascosto"},
      target: {placementId: target.placementId, name: target.name},
      action, attack: target.attack, round: target.round, status: target.status, defense,
      createdAt: now, updatedAt: now,
    });
  }
  return {combatId, resources: {
    hp: actorSummary.hp === null ? null : actorSummary.hp - cost.hp,
    mana: actorSummary.mana === null ? null : actorSummary.mana - cost.mana,
    essenza: actorSummary.essenza === null ? null : actorSummary.essenza - cost.essenza,
  }};
};

const readDefenseNumber = (
  value: unknown,
  fallback: number | null,
  min: number,
  label: string
): number => {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) ||
    candidate < min || candidate > 999) {
    return fail("invalid-argument", `Indica un valore valido per ${label}.`);
  }
  return candidate;
};

// One answered round: the trial, plus the damage a hit proposes to this target.
const newDefenseTrial = (
  {action, actor}: CombatEvent,
  target: CombatTarget,
  defaults: CombatDefense,
  input: Fields
): {trial: CombatTrial; damageDetails: CombatDamageDetails | null; proposed: CombatEffect[]} => {
  const {round, attack} = target;
  // An effect that lands without weapon damage proposes the card's own.
  const landed = (outcome: "hit" | "accepted", defense: CombatRoll | null) => {
    const proposed = proposeDamage(action, actor, target);
    const damage = proposed.find(({kind}) => kind === "damage")?.amount ?? null;
    return {trial: {round, attack, defense, outcome, damage}, damageDetails: null, proposed};
  };
  if (defaults.consent) {
    if (typeof input.consent !== "boolean") {
      return fail("invalid-argument", "Indica se accetti l'azione.");
    }
    return input.consent ? landed("accepted", null) : {
      trial: {round, attack, defense: null, outcome: "declined", damage: null},
      damageDetails: null,
      proposed: [],
    };
  }
  const value = readDefenseNumber(input.defense, defaults.value, -99, defaults.label);
  const reduction = defaults.showReduction
    ? readDefenseNumber(input.reduction, defaults.reduction, 0, "Riduzione Danni")
    : 0;
  const die = defaults.showDie ? combatDie(input.die ?? defaults.die) : null;
  if (defaults.showDie && !die) return fail("invalid-argument", "Scegli un Dado Anima valido.");
  const defense = makeCombatRoll(defaults.label, value, die, roll);
  const outcome = attack ? compareCombatRolls(attack.total, defense.total) : "hit";
  if (outcome !== "hit") {
    return {trial: {round, attack, defense, outcome, damage: null}, damageDetails: null, proposed: []};
  }
  if (!defaults.showReduction) return landed("hit", defense);
  const raw = rollCombatDamage(action.damageExpr, roll) ?? 0;
  const damageDetails = {raw, subtotal: action.attackStat + raw + action.damageBonus, reduction, hands: action.hands};
  const damage = combatWeaponDamage(damageDetails.subtotal, reduction, action.hands);
  return {trial: {round, attack, defense, outcome, damage}, damageDetails, proposed: [{
    kind: "damage", label: "Danno base", amount: damage,
    expr: action.damageExpr, targetPlacementId: target.placementId,
  }]};
};

// What the defender gets back: rebuilt from the stored trial and journal, so a
// retried answer returns the same payload as the first one.
const defenseReply = (
  combatId: string, placementId: string, trial: CombatTrial, effects: CombatEffect[]
) => ({
  combatId,
  round: trial.round,
  outcome: trial.outcome,
  damage: trial.damage,
  attack: trial.attack,
  defense: trial.defense,
  effects: trial.outcome === "tie" ? []
    : effects.filter((item) => item.targetPlacementId === placementId),
});

const targetCombat = async (context: Context, input: Fields, command: "defend" | "retry") => {
  const {db, transaction, uid} = context;
  const combatId = docId(input.combatId, "Combattimento");
  const placementId = docId(input.targetPlacementId, "Bersaglio");
  const round = input.round;
  if (typeof round !== "number" || !Number.isSafeInteger(round) || round < 1) {
    return fail("invalid-argument", "Il numero della prova non è valido.");
  }
  const eventRef = db.doc(`${ACTIONS}/${combatId}`);
  const requestRef = db.doc(`${REQUESTS}/${defenseRequestId(combatId, placementId)}`);
  const [eventSnapshot, request] = await transaction.getAll(eventRef, requestRef);
  const authorizedUid: unknown = request.get("ownerUid");
  const canAct = command === "defend" ? authorizedUid === uid : eventSnapshot.get("actorUid") === uid;
  // Damage-only copies are not defenses. Private requests are absent for anyone outside the command's scope.
  if (!eventSnapshot.exists || !request.exists || !request.get("defense") ||
    (!canAct && eventSnapshot.get("shared") !== true)) {
    return fail("not-found", "Richiesta di combattimento non disponibile.");
  }
  if (!canAct) {
    return fail("permission-denied", command === "defend"
      ? "Può rispondere solo chi controlla il bersaglio."
      : "Può rilanciare solo chi controlla l'attore.");
  }
  const event = eventSnapshot.data() as CombatEvent;
  const target = event.targets.find((item) => item.placementId === placementId);
  if (!target || target.ownerUid !== authorizedUid) {
    return fail("failed-precondition", "Il bersaglio non corrisponde alla richiesta.");
  }
  const previousTrial = target.trials.find((item) => item.round === round);
  if (command === "defend" && previousTrial) {
    return defenseReply(combatId, placementId, previousTrial, event.effects);
  }
  if (command === "retry" && target.round > round && previousTrial?.outcome === "tie") {
    return {combatId};
  }
  const expectedState = command === "defend" ? "waiting" : "retry";
  if (target.round !== round || target.status !== expectedState ||
    request.get("round") !== round || request.get("status") !== expectedState) {
    return fail("failed-precondition", "La prova è già cambiata. Apri lo stato aggiornato.");
  }
  const now = FieldValue.serverTimestamp();
  const next: CombatTarget = {...target};
  const effects = [...event.effects];
  let reply: CombatTrial | null = null;
  let healed: string | null = null;
  if (command === "retry") {
    next.round += 1;
    next.status = "waiting";
    next.attack = attackRoll(event.action, target.advantage);
    next.defense = null;
  } else {
    const defaults = request.get("defense") as CombatDefense;
    const {trial, damageDetails, proposed} = newDefenseTrial(event, target, defaults, input);
    reply = trial;
    next.trials = [...target.trials.slice(-49), trial];
    next.defense = trial.defense;
    next.status = trial.outcome === "tie" ? "retry" : "done";
    next.outcome = trial.outcome === "tie" ? null : trial.outcome;
    next.damage = trial.damage;
    next.damageDetails = damageDetails;
    effects.push(...proposed);
    const healsAfterResistance = trial.outcome === "resisted" && event.action.healOnResist;
    if (event.action.healExpr && (trial.outcome === "hit" || trial.outcome === "accepted" || healsAfterResistance)) {
      const recipientId = event.action.targetRoles ? event.targets[1]?.placementId : placementId;
      if (recipientId) {
        effects.push(effect("heal", "Cura proposta", event.action.healExpr, recipientId));
        if (recipientId !== placementId) healed = recipientId;
      }
    }
  }
  const targets = event.targets.map((item) => {
    if (item.placementId === placementId) return next;
    return item.placementId === healed ? {...item, outcome: "applied" as const} : item;
  });
  const status = combatStatus(targets);
  transaction.update(eventRef, {
    targets, status, effects, attack: targets[0]?.attack ?? null,
    updatedAt: now, resolvedAt: status === "done" ? now : null,
  });
  transaction.update(requestRef, {
    attack: next.attack,
    round: next.round,
    status: next.status,
    updatedAt: now,
    // An answer that lands concrete damage settles together with the damage its owner may apply.
    ...ownerDamageFields(combatId, {...event, effects}, next),
  });
  return reply ? defenseReply(combatId, placementId, reply, effects) : {combatId};
};

const confirmCritical = async (context: Context, input: Fields) => {
  const {db, transaction, uid} = context;
  const combatId = docId(input.combatId, "Combattimento");
  const placementId = docId(input.targetPlacementId, "Bersaglio");
  const score = input.score;
  if (typeof score !== "number" || !Number.isSafeInteger(score) || score < 1 || score > 41) {
    return fail("invalid-argument", "Il punteggio critico deve essere tra 1 e 41.");
  }
  const eventRef = db.doc(`${ACTIONS}/${combatId}`);
  const snapshot = await transaction.get(eventRef);
  const ownsAction = snapshot.get("actorUid") === uid;
  if (!snapshot.exists || (!ownsAction && snapshot.get("shared") !== true)) {
    return fail("not-found", "Combattimento non disponibile.");
  }
  if (!ownsAction) {
    return fail("permission-denied", "Può confermare il critico solo chi controlla l'attore.");
  }
  const event = snapshot.data() as CombatEvent;
  const target = event.targets.find((value) => value.placementId === placementId);
  if (target?.outcome !== "hit" || !target.damageDetails || event.action.hands < 1) {
    return fail("failed-precondition", "Il critico richiede un colpo d'arma riuscito.");
  }
  if (target.critical?.score === score) return {combatId, critical: target.critical};
  if (target.damageApplied) {
    return fail("failed-precondition", "Il danno è già stato applicato: il critico non si può più cambiare.");
  }
  const critical = combatCritical(score, target.damageDetails, event.action, target.critical, roll);
  const request = await ownerDamageRequest(context, combatId, event, placementId);
  const next = {...target, critical};
  transaction.update(eventRef, {
    targets: event.targets.map((value) => value.placementId === placementId ? next : value),
    updatedAt: FieldValue.serverTimestamp(),
  });
  projectOwnerDamage(context, request, combatId, event, next);
  return {combatId, critical};
};

const ABSENT_PAWN = "Una pedina non è più piazzata sulla mappa.";

// A player reaches the pawn of a target the journal records as theirs even while
// it is hidden: the lookup sees hidden placements only here, for this one recorded
// placement, and whatever is not that very token of theirs now answers like an
// absent pawn.
const readOwnDamagePawn = async (
  context: Context, backgroundId: string, recorded: CombatTarget
): Promise<BoardPawn> => {
  try {
    const [found] = await readPawns({...context, manager: true}, backgroundId, [recorded.placementId]);
    if (found.pawn.tokenId === recorded.tokenId && found.pawn.ownerUid === context.uid &&
      recorded.ownerUid === context.uid) return found;
  } catch (error) {
    if (!(error instanceof HttpsError) || error.code !== "failed-precondition") throw error;
  }
  return fail("failed-precondition", ABSENT_PAWN);
};

// Fresh balances of the pawn now on the target's placement. A character's live
// in its owner's account, which must still be active. The caller is already
// authorized for this recorded target.
const readDamageTarget = async (context: Context, backgroundId: string, recorded: CombatTarget) => {
  const {db, transaction} = context;
  await readActiveBoard(context, backgroundId);
  const {pawn, token} = context.manager
    ? (await readPawns(context, backgroundId, [recorded.placementId]))[0]
    : await readOwnDamagePawn(context, backgroundId, recorded);
  if (pawn.tokenId !== recorded.tokenId || pawn.ownerUid !== recorded.ownerUid) {
    return fail("failed-precondition", "Il bersaglio è cambiato: controlla la mappa.");
  }
  if (token.get("tokenType") !== "character") {
    const templateId = token.get("customTemplateId");
    if (token.get("tokenType") === "custom" && token.get("customTokenRole") === "instance" &&
      isValidFirestoreDocumentId(templateId)) {
      // The deletion workflow marks the template before it reaches its instances.
      const template = await transaction.get(db.doc(`${TOKENS}/${templateId}`));
      if (template.get("task06Deletion.status") === "pending") {
        return fail("failed-precondition", "La pedina non è più disponibile.");
      }
    }
    return {
      character: false,
      resourcesRef: token.ref,
      balances: combatDamageBalances(token.get("stats"), false),
      barrierField: "shieldCurrent",
    };
  }
  const [owner, deletion, resources] = await transaction.getAll(
    db.doc(`users/${pawn.ownerUid}`),
    db.doc(`user_deletion_jobs/${pawn.ownerUid}`),
    db.doc(`users/${pawn.ownerUid}/state/resources`)
  );
  if (!owner.exists || owner.get("deletionState") === "pending" || deletion.exists) {
    return fail("failed-precondition", "L'account del bersaglio non è più attivo.");
  }
  const legacyStats = asRecord(owner.get("stats"));
  const canonicalStats = asRecord(resources.get("stats"));
  return {
    character: true,
    resourcesRef: resources.ref,
    balances: combatDamageBalances({
      ...legacyStats,
      ...canonicalStats,
      // Resolve the alias in the authoritative document before consulting the profile.
      barrieraCurrent: canonicalStats.barrieraCurrent ?? canonicalStats.barriera ??
        legacyStats.barrieraCurrent ?? legacyStats.barriera,
    }, true),
    barrierField: "barrieraCurrent",
  };
};

// The DM applies damage to any target; a player only to a pawn the journal records as theirs.
const applyDamage = async (context: Context, input: Fields) => {
  const {db, transaction, manager, uid} = context;
  const combatId = docId(input.combatId, "Combattimento");
  const placementId = docId(input.targetPlacementId, "Bersaglio");
  const {amount, criticalScore} = input;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0) {
    return fail("invalid-argument", "Indica un danno intero non negativo.");
  }
  if (criticalScore !== null && (typeof criticalScore !== "number" ||
    !Number.isSafeInteger(criticalScore) || criticalScore < 1 || criticalScore > 41)) {
    return fail("invalid-argument", "Indica il critico mostrato, o nessuno.");
  }
  const eventRef = db.doc(`${ACTIONS}/${combatId}`);
  const snapshot = await transaction.get(eventRef);
  const event = snapshot.exists ? snapshot.data() as CombatEvent : null;
  const targets = event && Array.isArray(event.targets) ? event.targets : [];
  const target = targets.find((value) => asRecord(value).placementId === placementId);
  // Before any receipt or rule: a missing journal, a missing target and someone else's
  // pawn answer a player alike, so an unshared journal stays unseen.
  if (!manager && (!target || target.ownerUid !== uid)) {
    return fail("permission-denied", "Puoi applicare il danno solo a una pedina che controlli.");
  }
  if (!event) return fail("not-found", "Combattimento non disponibile.");
  if (!target) return fail("failed-precondition", "Il bersaglio non fa parte di questa azione.");
  // The first application is the receipt: a retry never touches resources again.
  if (target.damageApplied) return {combatId, damageApplied: target.damageApplied};
  if (!combatDamageEligible(target, event.effects)) {
    return fail("failed-precondition", "Il bersaglio non ha un danno concreto da applicare.");
  }
  if ((target.critical?.score ?? null) !== criticalScore) {
    return fail("failed-precondition", "Il critico è cambiato: controlla il danno aggiornato.");
  }
  const current = await readDamageTarget(context, event.backgroundId, target);
  const request = await ownerDamageRequest(context, combatId, event, placementId);
  const split = combatDamageSplit(amount, current.balances);
  const stats: Record<string, number> = {};
  if (split.barrier > 0) stats[current.barrierField] = (current.balances.barrier ?? 0) - split.barrier;
  if (split.hp > 0) stats.hpCurrent = (current.balances.hp ?? 0) - split.hp;
  storeResources(context, current, stats);
  const damageApplied = {amount};
  const next = {...target, damageApplied};
  transaction.update(eventRef, {
    targets: targets.map((value) => value === target ? next : value),
    updatedAt: FieldValue.serverTimestamp(),
  });
  projectOwnerDamage(context, request, combatId, event, next);
  return {combatId, damageApplied};
};

export const mutateGrigliataCombat = onCall(
  {region: REGION},
  async (request) => {
    const uid = requiredUid(request.auth?.uid);
    const input = asRecord(request.data);
    return withCaller(uid, (context) => {
      const command = input.command;
      switch (command) {
      case "launch":
        return launchCombat(context, input);
      case "defend":
      case "retry":
        return targetCombat(context, input, command);
      case "critical":
        return confirmCritical(context, input);
      case "applyDamage":
        return applyDamage(context, input);
      default:
        return fail("invalid-argument", "Comando di combattimento sconosciuto.");
      }
    });
  }
);
