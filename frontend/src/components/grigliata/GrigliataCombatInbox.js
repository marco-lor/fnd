import React, { useEffect, useState } from 'react';
import { collection, doc, labelFirestoreTarget, onSnapshot, query, where } from '../../performance/firestore';
import { getCallable } from '../../data/functions/callableRegistry';
import { db } from '../firebaseConfig';
import { GrigliataDefensePopup } from './GrigliataDefensePopup';
import './grigliataCombat.css';

const REQUESTS = 'grigliata_combat_requests';
const errorCode = error => error?.code?.split('/').pop();
// A lost or broken reply leaves the outcome unknown, and its raw text ("internal") says nothing: a retry is safe because
// the server keeps the first application and answers any later one with it.
const UNCONFIRMED = ['internal', 'unavailable', 'deadline-exceeded', 'unknown'];
const RETRY_SAFE = 'Conferma non ricevuta. Riprova: un danno già registrato non viene applicato due volte.';
const DEFENSE_RETRY_SAFE = 'Conferma non ricevuta. Riprova: una difesa già registrata non viene ripetuta, ne vedrai l’esito.';
const damageErrorText = error => (UNCONFIRMED.includes(errorCode(error))
  ? RETRY_SAFE
  : error?.message || 'Danno non applicato. Riprova.');
const unconfirmedDefense = () => Object.assign(new Error(DEFENSE_RETRY_SAFE), { unconfirmed: true });
const NOTHING = { waiting: [], damage: [] };

// `isManager`: the signed-in account is the DM, from the profile the host already reads.
export default function GrigliataCombatInbox({ uid, isManager = false }) {
  const [inbox, setInbox] = useState({ uid, ...NOTHING });
  const [connectionError, setConnectionError] = useState(false);
  const [damageMap, setDamageMap] = useState(null);
  const [revision, refresh] = useState(0);
  useEffect(() => {
    let active = true;
    const pending = query(collection(db,REQUESTS),where('ownerUid','==',uid),where('status','in',['waiting','damagePending']));
    // Metadata changes included: a damage first read from the cache opens once the server's own snapshot confirms it.
    const unsubscribe = onSnapshot(labelFirestoreTarget(pending,'grigliata.combat-requests.pending.subscribe.v1','shell'), { includeMetadataChanges: true }, snapshot => {
      if (!active) return;
      setConnectionError(false);
      const all = snapshot.docs.map(entry => ({...entry.data(), id:entry.id})).sort((a,b) => (a.createdAt?.seconds || 0)-(b.createdAt?.seconds || 0));
      const fresh = !snapshot.metadata?.fromCache;
      setInbox(before => ({
        uid,
        waiting: all.filter(entry => entry.status === 'waiting'),
        // A cached copy may be damage already applied: the last server list stands until the server answers again.
        damage: fresh ? all.filter(entry => entry.status === 'damagePending') : before.uid === uid ? before.damage : [],
      }));
    }, () => {
      if (active) setConnectionError(true);
    });
    return () => {active = false; unsubscribe();};
  }, [uid, revision]);
  // Never another account's lists, even for the moment before the new listener answers.
  const { waiting, damage } = inbox.uid === uid ? inbox : NOTHING;
  const hasPendingDamage = damage.length > 0;
  useEffect(() => {
    if (!hasPendingDamage) {
      setDamageMap(null);
      return undefined;
    }
    let active = true;
    const unsubscribe = watchDamageMap({
      next: backgroundId => {
        if (active) setDamageMap({ uid, backgroundId });
      },
      error: () => {
        if (active) setDamageMap({ uid, backgroundId: null, error: true });
      },
    });
    return () => { active = false; unsubscribe(); };
  }, [uid, revision, hasPendingDamage]);

  const currentMap = damageMap?.uid === uid ? damageMap : null;
  const activeDamageBackgroundId = hasPendingDamage ? currentMap?.backgroundId ?? null : undefined;
  // The popup sends one answer at a time and keeps a prompt whose reply was lost until a retry settles it.
  return <>
    {(connectionError || (hasPendingDamage && currentMap?.error)) && <button type="button" className="fixed bottom-4 right-4 z-50 rounded-xl border border-amber-700 bg-slate-950 p-2 text-xs text-amber-200" onClick={() => refresh(n => n+1)}>Combattimento scollegato · Riconnetti</button>}
    <GrigliataDefensePopup currentUserId={uid} isManager={isManager} requests={waiting} damageRequests={damage} onRespond={sendDefense}
      activeDamageBackgroundId={activeDamageBackgroundId} onWatchDamage={watchReceiptDamage} onApplyDamage={applyReceiptDamage}/>
  </>;
}

// The defender's answer for this very round: the server's reply, or an error to show, marked `unconfirmed` when the
// answer may already be recorded. The server answers a repeat of a recorded round with that round's own result.
export async function sendDefense(request, values) {
  let reply;
  try {
    reply = await getCallable('mutateGrigliataCombat')({
      ...values, command: 'defend', combatId: request.combatId, targetPlacementId: request.target.placementId, round: request.round,
    });
  } catch (error) {
    if (UNCONFIRMED.includes(errorCode(error))) throw unconfirmedDefense();
    throw new Error(error?.message || 'Risposta non inviata. Riprova.');
  }
  if (!reply?.data?.outcome) throw unconfirmedDefense();
  return reply.data;
}

// The private request of one answered defense, or of a damage that asked none, read only while its receipt shows damage
// to confirm; the popup checks that it belongs to this owner, action and pawn. Metadata changes included: the receipt
// waits for the server's own copy, not a cached one from before the answer. It stays readable once applied.
export function watchReceiptDamage(requestId, { next, error }) {
  const target = labelFirestoreTarget(doc(db, REQUESTS, requestId), 'grigliata.combat-requests.receipt-damage.subscribe.v1', 'shell');
  return onSnapshot(target, { includeMetadataChanges: true }, snapshot => next({
    id: snapshot.id,
    data: snapshot.exists() ? snapshot.data() : null,
    fromCache: Boolean(snapshot.metadata?.fromCache),
  }), error);
}

// Follow the map only while there are immediate confirmations that may become available.
function watchDamageMap({ next, error }) {
  const target = labelFirestoreTarget(doc(db, 'grigliata_state', 'current'), 'grigliata.combat-requests.active-map.subscribe.v1', 'shell');
  return onSnapshot(target, { includeMetadataChanges: true }, snapshot => {
    if (!snapshot.metadata?.fromCache) next(snapshot.exists() ? snapshot.data()?.activeBackgroundId ?? null : null);
  }, error);
}

// The same command the Registro sends: the recorded amount, or a message the receipt can show.
export async function applyReceiptDamage({ combatId, targetPlacementId, amount, criticalScore }) {
  let reply;
  try {
    reply = await getCallable('mutateGrigliataCombat')({ command: 'applyDamage', combatId, targetPlacementId, amount, criticalScore });
  } catch (error) {
    throw new Error(damageErrorText(error));
  }
  const recorded = reply?.data?.damageApplied?.amount;
  if (!Number.isSafeInteger(recorded) || recorded < 0) throw new Error(RETRY_SAFE);
  return { amount: recorded };
}
