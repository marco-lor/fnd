import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, labelFirestoreTarget, limit, onSnapshot, orderBy, query, where } from '../../performance/firestore';
import { db } from '../firebaseConfig';
import { getCallable } from '../../data/functions/callableRegistry';
import { runWithDurableOperationIntent } from '../../data/functions/backendOperationIntentStore';
import { buildPlacementDocId } from './boardUtils';
import { combatTime } from './combatPresentation';
import { canTargetToken, combatArea, combatDistance, picksGround, picksMultiple, withinCombatRange } from './combatTargeting';

const EMPTY = [];
const UNRESOLVED = ['waiting', 'retry'];
const initialSelection = { actionId: '', actionKind: '', targetIds: [], point: null, picking: false };
const records = (snap) => snap.docs.map(entry => ({ ...entry.data(), id: entry.id }));
const byCreation = (a, b) => combatTime(a.createdAt) - combatTime(b.createdAt) || a.id.localeCompare(b.id);
const errorText = (error) => error?.message || 'Connessione interrotta. Riprova.';
const errorCode = (error) => error?.code?.split('/').pop();
const definitive = (error) => ['invalid-argument', 'permission-denied', 'failed-precondition', 'not-found', 'out-of-range', 'unauthenticated'].includes(errorCode(error));
// A lost or broken reply leaves the outcome unknown, and its raw text ("internal") says nothing: a retry is safe because
// the server keeps the first application and answers any later one with it.
const UNCONFIRMED = ['internal', 'unavailable', 'deadline-exceeded', 'unknown'];
const damageErrorText = (error) => (UNCONFIRMED.includes(errorCode(error))
  ? 'Conferma non ricevuta. Riprova: un danno già registrato non viene applicato due volte.'
  : errorText(error));
const HIDDEN_ATTACKER = { name: 'Attaccante nascosto' };
const byTargetName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'it') || a.placementId.localeCompare(b.placementId);

// The owner's private copies of opposed outcomes, newest first, as journal entries: one per action with only the
// owner's own pawns, keyed by the real action id the damage command needs. Only the fields the journal and the damage
// form read are kept; the attacker is never named.
function ownerDamageEvents(docs, uid) {
  const byCombat = new Map();
  for (const doc of docs) {
    const { combatId, ownerDamage } = doc;
    const target = ownerDamage?.target;
    if (typeof combatId !== 'string' || !combatId || typeof target?.placementId !== 'string' || target.ownerUid !== uid) continue;
    if (!byCombat.has(combatId)) {
      // The first copy is the newest. The launch time, when the copy carries it, keeps the entry in place among full
      // records once its damage is applied.
      const stamp = doc.createdAt?.toMillis ? doc.createdAt : doc.ownerDamageUpdatedAt;
      byCombat.set(combatId, {
        id: combatId, ownerPrivate: true, status: 'done', kind: ownerDamage.kind, actor: HIDDEN_ATTACKER,
        action: { name: ownerDamage.action?.name, hands: ownerDamage.action?.hands },
        createdAt: stamp, updatedAt: doc.ownerDamageUpdatedAt, targets: [],
      });
    }
    const { targets } = byCombat.get(combatId);
    if (targets.some(item => item.placementId === target.placementId)) continue;
    const { placementId, name, ownerUid, status, round, outcome, damage, critical, damageApplied } = target;
    targets.push({ placementId, name, ownerUid, status, round, outcome, damage, critical, damageApplied, updatedAt: doc.ownerDamageUpdatedAt });
  }
  return [...byCombat.values()].map(event => ({ ...event, targets: event.targets.sort(byTargetName) }));
}

function mergeOwnerDamage(full, projected) {
  const updatedAt = combatTime(full.updatedAt ?? full.createdAt);
  const targets = (full.targets || EMPTY).map(target => {
    const owned = projected.targets.find(candidate => candidate.placementId === target.placementId && candidate.ownerUid === target.ownerUid);
    if (!owned) return target;
    const damageApplied = target.damageApplied ?? owned.damageApplied;
    if (combatTime(owned.updatedAt) > updatedAt) {
      const { status, round, outcome, damage, critical } = owned;
      return { ...target, status, round, outcome, damage, critical, damageApplied };
    }
    return damageApplied && !target.damageApplied ? { ...target, damageApplied } : target;
  });
  return { ...full, targets };
}

// Returns the feed and a retry that reopens every listener: Firestore ends a listener for good on its first error.
function useCombatFeed(uid, backgroundId, isManager, open) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([uid, backgroundId, isManager, open, attempt]);
  const [feed, setFeed] = useState({});
  useEffect(() => {
    if (!uid || !backgroundId || !open) return undefined;
    let active = true;
    const bySource = {};
    const errors = {};
    const publish = () => {
      // Other people's actions stay bounded by the scene window; the caller's own are never displaced by them.
      // One copy per action: the newest write, whichever listener delivered it (a tie keeps the later source).
      const unique = new Map();
      for (const e of [...(bySource.scene || EMPTY), ...(bySource.owned || EMPTY), ...(bySource.pending || EMPTY)]) {
        if (!unique.has(e.id) || combatTime(e.updatedAt) >= combatTime(unique.get(e.id).updatedAt)) unique.set(e.id, e);
      }
      // The full journal provides the display context. A fresher owner copy can advance that target's outcome
      // without hiding the rest of the journal, and a completed receipt survives an older snapshot.
      for (const projected of ownerDamageEvents(bySource.ownerDamage || EMPTY, uid)) {
        const full = unique.get(projected.id);
        unique.set(projected.id, full ? mergeOwnerDamage(full, projected) : projected);
      }
      // A card lasts while the newest copy still awaits an answer: a stale pending snapshot never hides a result.
      const pending = (bySource.pending || EMPTY).map(e => unique.get(e.id)).filter(e => UNRESOLVED.includes(e.status)).sort(byCreation);
      setFeed({ key, events: [...unique.values()].sort((a, b) => byCreation(b, a)), pending, error: Object.values(errors)[0] });
    };
    const actions = (...filters) => query(collection(db, 'grigliata_combat_actions'), where('backgroundId', '==', backgroundId), ...filters);
    const subscribe = (source, label, target) => onSnapshot(labelFirestoreTarget(target,label),
      snap => {
        if (!active) return;
        bySource[source] = records(snap);
        delete errors[source];
        publish();
      },
      err => {
        if (!active) return;
        errors[source] = errorText(err);
        delete bySource[source];
        publish();
      });
    const own = where('actorUid', '==', uid);
    const newest = [orderBy('createdAt', 'desc'), limit(40)];
    const unsubs = [
      isManager
        ? subscribe('scene','grigliata.combat-actions.manager.subscribe.v1',actions(...newest))
        : subscribe('scene','grigliata.combat-actions.public.subscribe.v1',actions(where('shared','==',true),...newest)),
      // Last changed, not last launched: an own action just answered, rerolled or given a critical is always in this
      // window, however many launches followed it, so its result never vanishes when it leaves the pending listener.
      subscribe('owned','grigliata.combat-actions.actor.subscribe.v1',actions(own,orderBy('updatedAt','desc'),limit(40))),
      // Never windowed: an action that still awaits an answer keeps its card however many actions follow it.
      subscribe('pending','grigliata.combat-actions.actor-pending.subscribe.v1',actions(own,where('status','in',UNRESOLVED))),
    ];
    // A player also reads the redacted outcome on each of their pawns of the actions they cannot read in full; the DM
    // reads the whole scene.
    if (!isManager) {
      unsubs.push(subscribe('ownerDamage','grigliata.combat-requests.owner-damage.subscribe.v1',query(
        collection(db, 'grigliata_combat_requests'), where('ownerUid', '==', uid), where('backgroundId', '==', backgroundId),
        orderBy('ownerDamageUpdatedAt', 'desc'), limit(40))));
    }
    return () => { active = false; unsubs.forEach(unsub => unsub()); };
  }, [key, uid, backgroundId, isManager, open]);
  return [feed.key === key ? feed : {}, () => setAttempt(n => n + 1)];
}

export default function useGrigliataCombat({ uid, backgroundId, enabled, open, isManager, tokens, activeTurnTokenId, suspended }) {
  const [preferredId, setPreferredId] = useState('');
  const [revision, refresh] = useState(0);
  const [catalog, setCatalog] = useState({});
  const [draft, setDraft] = useState({});
  const [activity, setActivity] = useState({});
  // Per target of a logged action: this viewer's damage application in flight, its error, or the amount the server recorded.
  // Kept apart from `activity` so a refused application never reads as an arsenal error, and kept here rather than in
  // the form so a panel closed and reopened mid-request still shows it and still refuses a second send.
  const [damage, setDamage] = useState({});
  const locks = useRef(new Set());
  const aimTrigger = useRef(null);
  const board = useMemo(() => {
    if (!enabled || !open || suspended) return EMPTY;
    return tokens.map(token => ({
      ...token,
      name: token.label || token.characterId || 'Pedina',
      placementId: buildPlacementDocId(backgroundId, token.tokenId || token.id),
    }));
  }, [enabled, open, suspended, tokens, backgroundId]);
  const placedOwners = useMemo(() => new Map(board.map(token => [token.placementId, token.ownerUid])), [board]);
  // The DM applies damage to any target; a player only to their own pawns, never to the other side.
  const mayApplyDamage = target => !suspended && (isManager || (Boolean(uid) && target?.ownerUid === uid));
  // The live pawn must still belong to the target's owner. The DM's board shows every pawn, so a missing one has left
  // the map. A player's board leaves out their own pawns hidden by the DM or lost in the fog: only a pawn shown with
  // another owner rules the application out there, and the server checks the live pawn either way.
  const targetIsPresent = target => {
    if (!target?.ownerUid) return false;
    if (placedOwners.has(target.placementId)) return placedOwners.get(target.placementId) === target.ownerUid;
    return !isManager;
  };
  const actors = useMemo(() => board.filter(t => t.ownerUid === uid && !t.isDead), [board, uid]);
  const pawn = actors.find(t => t.placementId === preferredId) || actors.find(t => t.tokenId === uid) || actors[0];
  const actorId = pawn?.placementId || '';
  const catalogKey = enabled && open && !suspended && actorId ? JSON.stringify([uid, backgroundId, actorId]) : '';
  // The arsenal is fetched afresh whenever it comes back into view: panel reopened, another pawn or map.
  const [shownKey, setShownKey] = useState(catalogKey);
  if (shownKey !== catalogKey) {
    setShownKey(catalogKey);
    refresh(v => v + 1);
  }
  const [feed, retryFeed] = useCombatFeed(enabled ? uid : '', backgroundId, isManager, open);
  useEffect(() => {
    if (!catalogKey) return undefined;
    let active = true;
    getCallable('getGrigliataCombatArsenal')({backgroundId, actorPlacementId:actorId})
      .then(({data}) => { if (active) setCatalog({key:catalogKey, revision, data}); })
      .catch(error => {
        if (!active) return;
        setCatalog(previous => ({
          key: catalogKey,
          revision,
          data: previous.key === catalogKey ? previous.data : undefined,
          error: errorText(error),
        }));
      });
    return () => { active = false; };
  }, [catalogKey, backgroundId, actorId, revision]);
  // Equipment, spells or resources may change in another tab or window: coming back reloads the arsenal.
  useEffect(() => {
    if (!catalogKey) return undefined;
    const sync = () => refresh(v => v + 1);
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, [catalogKey]);
  const current = catalog.key === catalogKey ? catalog : {};
  // A launch needs an arsenal the latest fetch confirmed: not one still reloading (back from another tab, after a
  // launch, panel reopened) nor one whose reload failed.
  const arsenalSync = !current.data ? 'loading' : current.revision !== revision ? 'reloading' : current.error ? 'failed' : 'ready';
  const actions = current.data?.actions || EMPTY;
  const base = draft.key === catalogKey ? draft : initialSelection;
  const chosen = actions.find(a => a.id === base.actionId && a.kind === base.actionKind);
  // The one selection the panel shows and the aim uses: the chosen action, else the first of the chosen kind
  // (nothing when that kind is empty), else the first action before any choice.
  const action = chosen || actions.find(a => !base.actionKind || a.kind === base.actionKind);
  // A chosen action that leaves the loaded repertoire gives way for good to that fallback with a fresh pick:
  // re-equipping its item never brings back the old action and its targets.
  const lost = !!base.actionId && !chosen;
  if (lost && current.data) {
    setDraft({...initialSelection, actionId:action?.id || '', actionKind:action?.kind || base.actionKind, key:catalogKey});
  }
  const kept = lost ? initialSelection : base;
  // The draft is re-read through the current action so the launch carries only what the server accepts for it.
  const ground = picksGround(action);
  const multi = picksMultiple(action);
  const targetIds = [];
  if (action?.mode === 'self' && pawn) targetIds.push(actorId);
  else if (!ground) for (const id of kept.targetIds) {
    const token = board.find(t => t.placementId === id);
    if (token && canTargetToken(pawn,token,action,targetIds.length)) targetIds.push(id);
    else if (action?.targetRoles) break;
  }
  const full = multi && action.maxTargets > 0 && targetIds.length >= action.maxTargets;
  const nextRole = multi ? targetIds.length : 0;
  const candidates = board.filter(t => targetIds.includes(t.placementId) || (!full && canTargetToken(pawn,t,action,nextRole)))
    .map(t => ({...t,distanceFt:combatDistance(pawn,t)})).sort((a,b) => a.distanceFt-b.distanceFt || a.name.localeCompare(b.name,'it'));
  const point = ground && kept.point && withinCombatRange(pawn,kept.point,action) ? kept.point : null;
  const area = combatArea(action, point);
  const areaTargets = area ? board.filter(t => (!t.isDead || action.allowDead) && combatDistance(area, t) === 0) : EMPTY;
  const selection = {...kept, point, areaTargets, targetIds, actionId:action?.id || '', actionKind:action?.kind || base.actionKind,
    picking:!!(catalogKey && action && kept.picking)};
  useEffect(() => { if (!catalogKey) setDraft(initialSelection); }, [catalogKey]);
  const update = (next) => setDraft({ ...kept, actionId:selection.actionId, actionKind:selection.actionKind, targetIds, point, ...next, key:catalogKey });
  // Id and kind always travel together, and another action always starts from an empty pick.
  const same = next => next?.id === action?.id && next?.kind === action?.kind;
  const choose = next => ({...initialSelection, actionId:next?.id || '', actionKind:next?.kind || ''});
  const finishAim = (next = {}) => {
    update({...next, picking:false});
    const trigger = aimTrigger.current;
    if (trigger?.isConnected) trigger.focus({preventScroll:window.innerWidth >= 1280});
  };
  const beginAim = (next) => {
    if (selection.picking) { finishAim(); return; }
    aimTrigger.current = document.activeElement;
    update({...(same(next) ? {} : choose(next)), picking:true});
  };
  const selectAction = (next) => { if (!same(next)) update(choose(next)); };
  const pickToken = (id) => {
    if (!selection.picking || !candidates.some(t => t.placementId === id)) return;
    if (multi) update({targetIds:targetIds.includes(id) ? removeTarget(id) : [...targetIds,id]});
    else finishAim({targetIds:[id]});
  };
  const removeTarget = id => action?.targetRoles ? targetIds.slice(0,targetIds.indexOf(id)) : targetIds.filter(t => t !== id);
  const pickPoint = (cell) => {
    if (selection.picking && ground && withinCombatRange(pawn,cell,action)) finishAim({point:cell,targetIds:[]});
  };
  const run = async (scope, job, pending = {}) => {
    const key = JSON.stringify([uid,backgroundId,scope]);
    if (locks.current.has(key)) return;
    locks.current.add(key);
    setActivity(s => ({...s,[key]:{...pending,busy:true}}));
    try {
      await job();
      setActivity(s => ({...s,[key]:{}}));
    } catch (err) {
      setActivity(s => ({...s,[key]:{error:errorText(err)}}));
    } finally { locks.current.delete(key); }
  };
  const attack = activity[JSON.stringify([uid,backgroundId,'attack'])] || {};
  const mutate = payload => getCallable('mutateGrigliataCombat')(payload);
  const onLaunch = (used, options) => run('attack', async () => {
    if (!actorId || used.id !== action?.id || used.kind !== action?.kind) return;
    // The version pins the definition shown here: a weapon action's id is only its slot, and the slot may be re-equipped elsewhere.
    const payload = { ...options, command:'launch', backgroundId, actorPlacementId:actorId, kind:used.kind, actionId:used.id,
      actionVersion:action.version, targetPlacementIds:targetIds };
    if (point) payload.point = point;
    Object.keys(payload).forEach(k => { if (payload[k] == null) delete payload[k]; });
    try {
      await runWithDurableOperationIntent({actorUid:uid,kind:'grigliata-combat',intent:payload,isDefinitiveError:definitive,
        invoke: operationId => mutate({...payload,operationId})});
    } finally {
      // Success or failure, the arsenal is reloaded: a refused launch shows the current repertoire next to its error.
      // The draft is left alone: aiming ended before the launch and the player may already be drafting the next action.
      refresh(v => v+1);
    }
  });
  const damageKey = (event, target) => JSON.stringify([uid, backgroundId, 'damage', event.id, target.placementId]);
  const applyDamage = async (event, target, amount) => {
    const key = damageKey(event, target);
    // Rights checked again here, not only where the form is offered; the server has the last word.
    if (!mayApplyDamage(target) || !targetIsPresent(target) || locks.current.has(key)) return;
    locks.current.add(key);
    const criticalScore = target.critical?.score ?? null;
    const submitted = {value:String(amount), criticalScore};
    setDamage(s => ({...s,[key]:{busy:true,submitted}}));
    try {
      const {data} = await mutate({command:'applyDamage',combatId:event.id,targetPlacementId:target.placementId,amount,criticalScore});
      const recorded = data?.damageApplied?.amount;
      if (!Number.isSafeInteger(recorded) || recorded < 0) throw new Error('Esito non confermato. Riprova.');
      setDamage(s => ({...s,[key]:{applied:{amount:recorded}}}));
    } catch (err) {
      setDamage(s => ({...s,[key]:{error:damageErrorText(err),submitted}}));
    } finally { locks.current.delete(key); }
  };
  const onCritical = async (event, target, score) => {
    const key = damageKey(event, target);
    if (locks.current.has(key)) return;
    locks.current.add(key);
    try {
      await run('attack', () => mutate({command:'critical',combatId:event.id,targetPlacementId:target.placementId,round:target.round,score}),
        {criticalTargetKey:key});
    } finally { locks.current.delete(key); }
  };
  const damageState = (event, target) => {
    const key = damageKey(event, target);
    return {...damage[key], criticalPending:attack.criticalTargetKey === key, unavailable:!targetIsPresent(target)};
  };
  // A launch refreshes only the arsenal; listeners reopen only when one of them has failed.
  const reload = () => {
    refresh(v => v+1);
    if (feed.error) retryFeed();
  };
  return {
    actors, pawn, setActor:setPreferredId, reload,
    panel: {
      actor:current.data?.actor, actions, equipped:current.data?.equipped, selection, targets:candidates,
      events:feed.events || EMPTY, pending:feed.pending || EMPTY, currentUserId:uid,
      turn:{name:board.find(t => t.tokenId === activeTurnTokenId)?.name, isCurrent:pawn?.tokenId === activeTurnTokenId,
        canAct:!activeTurnTokenId || pawn?.tokenId === activeTurnTokenId},
      onSelectAction:selectAction, onBeginTargeting:beginAim,
      onRemoveTarget:id => update({targetIds:removeTarget(id)}), onLaunch,
      onRetry:(event,target) => run('attack',() => mutate({command:'retry',combatId:event.id,targetPlacementId:target.placementId,round:target.round})),
      onCritical,
      // The DM for every target, a player for their own pawns; nobody from the narration overlay or the player preview.
      onApplyDamage:suspended ? undefined : applyDamage,
      canApplyDamage:(event, target) => mayApplyDamage(target),
      damageState,
      busy:!!attack.busy, arsenalSync, loading:!!catalogKey && !current.data && !current.error,
      error:attack.error || current.error || feed.error,
    },
    overlay:open && pawn && action ? { pawn, action, selection, candidates, pickToken, pickPoint, finish:() => finishAim() } : null,
  };
}
