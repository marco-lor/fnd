import type {DocumentSnapshot, Firestore, Transaction} from "firebase-admin/firestore";
import type {CombatPawn, CombatTarget} from "./grigliataCombatCore";
import {combatResourceVersion, readBarrierContinuity, readShieldActivation} from "./barrierContinuity";
import {asRecord, asTrimmedString, isValidFirestoreDocumentId} from "./userDataV2";

// A top-level collection with no client rule. Only the callable reads or writes receipts.
export const COMBAT_RECEIPTS = "grigliata_combat_receipts";

const COST_FIELDS = {hp: "hpCurrent", mana: "manaCurrent", essenza: "essenzaCurrent"} as const;
const RESOURCE_FIELDS = ["hpCurrent", "manaCurrent", "essenzaCurrent", "barrieraCurrent", "shieldCurrent"] as const;
type ResourceField = typeof RESOURCE_FIELDS[number];
type Amounts = Partial<Record<ResourceField, number>>;
type ResourceIdentity = {id: string; createdAt: string | null} & (
  {kind: "character"; resourcesCreatedAt: string | null} |
  {kind: "token"; ownerUid: string; tokenType: string}
);
type Debit = {identity: ResourceIdentity; amounts: Amounts; barrierMaximum: number | null};
type VersionedDebit = Debit & {
  writtenVersion: string | null;
  previousVersion: string | null;
  shieldActivation: string | null;
};
type Correction = {
  reason: "legacyCostUnknown" | "legacyDamageUnknown" | "entityUnavailable" | "balanceUnavailable" |
    "barrierUnavailable" | "barrierAmbiguous" | "barrierCapacity";
  subject: Pick<CombatPawn, "ownerUid" | "tokenId"> | ResourceIdentity;
  amounts?: Amounts;
  placementId?: string;
  agreedDamage?: number;
};
type Restorable = {snapshot: DocumentSnapshot; character: boolean; fallback: unknown};

const createdAt = (snapshot: DocumentSnapshot): string | null => snapshot.createTime?.valueOf() ?? null;
export const combatDamageReceiptPath = (combatId: string, placementId: string): string =>
  `${COMBAT_RECEIPTS}/${combatId}/damage/${placementId}`;

export const characterResourceIdentity = (owner: DocumentSnapshot, resources: DocumentSnapshot): ResourceIdentity => ({
  kind: "character", id: owner.id, createdAt: createdAt(owner), resourcesCreatedAt: createdAt(resources),
});

export const tokenResourceIdentity = (token: DocumentSnapshot): ResourceIdentity => ({
  kind: "token", id: token.id, createdAt: createdAt(token), ownerUid: asTrimmedString(token.get("ownerUid")),
  tokenType: asTrimmedString(token.get("tokenType")),
});

export const debitCombatResources = (
  identity: ResourceIdentity, charges: {field: ResourceField; before: number | null; amount: number}[],
  barrierMaximum: number | null = null
): {stats: Amounts; debit: Debit} => {
  const stats: Amounts = {};
  const amounts: Amounts = {};
  for (const {field, before, amount} of charges) {
    if (before === null || amount <= 0) continue;
    const after = before - amount;
    if (after === before) continue;
    stats[field] = after;
    amounts[field] = before - after;
  }
  return {stats, debit: {identity, amounts, barrierMaximum}};
};

const readFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== "number" && !(typeof value === "string" && value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};

export const combatBarrierMaximum = (character: boolean, stats: unknown, fallback?: unknown): number | null => {
  const current = asRecord(stats);
  if (!character) return readFiniteNumber(current.shieldTotal);
  const legacy = asRecord(fallback);
  return readFiniteNumber(current.barrieraTotal ?? current.barriera ?? legacy.barrieraTotal ?? legacy.barriera);
};

const recordedAmounts = (value: unknown): Amounts => {
  const data = asRecord(value);
  const amounts: Amounts = {};
  for (const field of RESOURCE_FIELDS) {
    const amount = data[field];
    if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) amounts[field] = amount;
  }
  return amounts;
};

const recordedDebit = (value: unknown): Debit | null => {
  const {identity: raw, amounts, barrierMaximum} = asRecord(value);
  const {kind, id, ownerUid, tokenType, createdAt: created, resourcesCreatedAt} = asRecord(raw);
  if (typeof id !== "string" || !isValidFirestoreDocumentId(id)) return null;
  const base = {id, createdAt: typeof created === "string" ? created : null};
  if (kind === "character") {
    const identity: ResourceIdentity = {...base, kind,
      resourcesCreatedAt: typeof resourcesCreatedAt === "string" ? resourcesCreatedAt : null};
    return {identity, amounts: recordedAmounts(amounts), barrierMaximum: readFiniteNumber(barrierMaximum)};
  }
  if (kind === "token" && typeof ownerUid === "string" && isValidFirestoreDocumentId(ownerUid) && typeof tokenType === "string") {
    return {identity: {...base, kind, ownerUid, tokenType}, amounts: recordedAmounts(amounts),
      barrierMaximum: readFiniteNumber(barrierMaximum)};
  }
  return null;
};

const unavailable = (entity: DocumentSnapshot): boolean => !entity.exists ||
  entity.get("deletionState") === "pending" || entity.get("task06Deletion.status") === "pending";

const readAccount = async (db: Firestore, transaction: Transaction, ownerUid: string) => {
  const [owner, resources, deletion] = await transaction.getAll(
    db.doc(`users/${ownerUid}`), db.doc(`users/${ownerUid}/state/resources`), db.doc(`user_deletion_jobs/${ownerUid}`)
  );
  return {owner, resources, deletion};
};

const readRestorable = async (
  db: Firestore, transaction: Transaction, identity: ResourceIdentity
): Promise<Restorable | null> => {
  if (identity.kind === "character") {
    const {owner, resources, deletion} = await readAccount(db, transaction, identity.id);
    if (unavailable(owner) || deletion.exists || !resources.exists ||
      (identity.createdAt !== null && identity.createdAt !== createdAt(owner)) ||
      (identity.resourcesCreatedAt !== null && identity.resourcesCreatedAt !== createdAt(resources))) return null;
    return {snapshot: resources, character: true, fallback: owner.get("stats")};
  }
  const token = await transaction.get(db.doc(`grigliata_tokens/${identity.id}`));
  if (unavailable(token) || token.get("ownerUid") !== identity.ownerUid ||
    asTrimmedString(token.get("tokenType")) !== identity.tokenType ||
    (identity.createdAt !== null && identity.createdAt !== createdAt(token))) return null;
  const templateId = token.get("customTemplateId");
  if (identity.tokenType === "custom" && token.get("customTokenRole") === "instance" &&
    isValidFirestoreDocumentId(templateId) && unavailable(await transaction.get(db.doc(`grigliata_tokens/${templateId}`)))) {
    return null;
  }
  return {snapshot: token, character: false, fallback: null};
};

const legacyCostDebit = async (
  db: Firestore, transaction: Transaction, event: DocumentSnapshot, corrections: Correction[]
): Promise<Debit | null> => {
  const actor = asRecord(event.get("actor"));
  const {ownerUid, tokenId} = actor;
  const subject = {ownerUid: asTrimmedString(ownerUid), tokenId: asTrimmedString(tokenId)};
  const cost = asRecord(event.get("cost"));
  const amounts: Amounts = {};
  let unknownCost = false;
  for (const [key, field] of Object.entries(COST_FIELDS)) {
    const amount = cost[key];
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) unknownCost = true;
    else if (amount > 0) amounts[field] = amount;
  }
  if (unknownCost) corrections.push({subject, reason: "legacyCostUnknown"});
  if (!Object.keys(amounts).length) return null;

  const reportMissing = (): null => {
    corrections.push({subject, amounts, reason: "entityUnavailable"});
    return null;
  };
  if (typeof ownerUid !== "string" || !isValidFirestoreDocumentId(ownerUid) || !isValidFirestoreDocumentId(tokenId)) return reportMissing();
  const token = await transaction.get(db.doc(`grigliata_tokens/${tokenId}`));
  const eventTime = createdAt(event);
  const replacedAfterLaunch = (snapshot: DocumentSnapshot): boolean => {
    const snapshotTime = createdAt(snapshot);
    return eventTime !== null && snapshotTime !== null && snapshotTime > eventTime;
  };
  if (unavailable(token) || token.get("ownerUid") !== ownerUid || replacedAfterLaunch(token)) return reportMissing();
  if (token.get("tokenType") !== "character") {
    return {identity: tokenResourceIdentity(token), amounts, barrierMaximum: null};
  }
  const {owner, resources} = await readAccount(db, transaction, ownerUid);
  if (!owner.exists || !resources.exists || replacedAfterLaunch(owner) || replacedAfterLaunch(resources)) return reportMissing();
  return {identity: characterResourceIdentity(owner, resources), amounts, barrierMaximum: null};
};

// Build every refund from the current document before the transaction starts writing.
export const planCombatRefund = async (
  db: Firestore, transaction: Transaction, event: DocumentSnapshot, receipt: DocumentSnapshot,
  targets: Pick<CombatTarget, "placementId" | "ownerUid" | "tokenId" | "damageApplied">[]
) => {
  const corrections: Correction[] = [];
  const debits: VersionedDebit[] = [];
  const cost = recordedDebit(receipt.get("cost")) ?? await legacyCostDebit(db, transaction, event, corrections);
  if (cost) debits.push({...cost, previousVersion: null, writtenVersion: null, shieldActivation: null});
  const damage = targets.length ? await transaction.getAll(...targets.map(({placementId}) =>
    db.doc(combatDamageReceiptPath(event.id, placementId)))) : [];
  for (const [index, target] of targets.entries()) {
    const damageReceipt = damage[index];
    const debit = recordedDebit(damageReceipt.data());
    if (debit) {
      const previous = damageReceipt.get("previousResourceVersion");
      debits.push({
        ...debit, writtenVersion: createdAt(damageReceipt), previousVersion: typeof previous === "string" ? previous : null,
        shieldActivation: readShieldActivation(damageReceipt.get("shieldActivation")),
      });
      continue;
    }
    const amount = asRecord(target.damageApplied).amount;
    if (amount !== 0) {
      const {placementId, ownerUid, tokenId} = target;
      corrections.push({reason: "legacyDamageUnknown", subject: {ownerUid, tokenId}, placementId,
        ...(typeof amount === "number" && Number.isFinite(amount) && {agreedDamage: amount})});
    }
  }

  // An actor can also be a target. A character can have more than one placement.
  const groups = new Map<string, {destination: Restorable; debits: VersionedDebit[]}>();
  for (const debit of debits) {
    const {identity, amounts} = debit;
    if (!Object.keys(amounts).length) continue;
    const destination = await readRestorable(db, transaction, identity);
    if (!destination) {
      corrections.push({subject: identity, amounts, reason: "entityUnavailable"});
      continue;
    }
    const key = destination.snapshot.ref.path;
    const group = groups.get(key) ?? {destination, debits: []};
    group.debits.push(debit);
    groups.set(key, group);
  }

  const writes = [];
  const refunds = [];
  for (const {destination, debits: entries} of groups.values()) {
    const {snapshot, character, fallback} = destination;
    const current = asRecord(snapshot.get("stats"));
    const maximum = combatBarrierMaximum(character, current, fallback);
    const {identity} = entries[0];
    const stats: Amounts = {};
    const refunded: Amounts = {};
    const continuity = await readBarrierContinuity(db, transaction, snapshot);
    const version = combatResourceVersion(snapshot);
    const since = continuity?.since ?? version;
    // Legacy receipts can also link consecutive damage writes from this action
    // when the first verified version is itself one of those writes.
    const byVersion = new Map(entries.map((entry) => [entry.writtenVersion, entry]));
    const earlierProven = new Set<VersionedDebit>();
    for (let previous = since; previous;) {
      const entry = byVersion.get(previous);
      if (!entry || earlierProven.has(entry)) break;
      earlierProven.add(entry);
      previous = entry.previousVersion;
    }
    const shieldActivation = readShieldActivation(snapshot.get("combatShieldActivation"));
    const proven = (entry: VersionedDebit): boolean => entry.shieldActivation !== null ?
      entry.shieldActivation === shieldActivation : earlierProven.has(entry) ||
        (since !== null && version !== null && entry.writtenVersion !== null &&
          entry.writtenVersion >= since && entry.writtenVersion <= version);
    for (const field of RESOURCE_FIELDS) {
      let amount = entries.reduce((sum, entry) => sum + (entry.amounts[field] ?? 0), 0);
      if (amount <= 0) continue;
      const balance = readFiniteNumber(current[field]);
      const barrier = field === "barrieraCurrent" || field === "shieldCurrent";
      if (barrier && (balance === null || (maximum !== null && maximum <= 0) ||
        (maximum === null && entries.some((entry) => entry.amounts[field] && entry.barrierMaximum !== null)))) {
        corrections.push({subject: identity, amounts: {[field]: amount}, reason: "barrierUnavailable"});
        continue;
      }
      if (barrier) {
        const unverified = entries.reduce((sum, entry) => sum + (proven(entry) ? 0 : entry.amounts[field] ?? 0), 0);
        if (unverified > 0) {
          corrections.push({subject: identity, amounts: {[field]: unverified}, reason: "barrierAmbiguous"});
          amount -= unverified;
          if (amount <= 0) continue;
        }
      }
      if (balance === null || !Number.isFinite(balance + amount)) {
        corrections.push({subject: identity, amounts: {[field]: amount}, reason: "balanceUnavailable"});
        continue;
      }
      const restored = barrier && maximum !== null ? Math.max(balance, Math.min(maximum, balance + amount)) : balance + amount;
      if (restored > balance) {
        stats[field] = restored;
        refunded[field] = restored - balance;
      }
      if (barrier && maximum !== null && balance + amount > maximum) {
        corrections.push({subject: identity, amounts: {[field]: amount - (refunded[field] ?? 0)}, reason: "barrierCapacity"});
      }
    }
    if (Object.keys(stats).length) {
      writes.push({resourceSnapshot: snapshot, character, stats, continuity});
      refunds.push({identity, amounts: refunded});
    }
  }
  return {writes, refunds, corrections};
};
