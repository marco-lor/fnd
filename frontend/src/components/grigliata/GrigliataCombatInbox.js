import React, { useEffect, useState } from 'react';
import { collection, doc, labelFirestoreTarget, onSnapshot, query, where } from '../../performance/firestore';
import { getCallable } from '../../data/functions/callableRegistry';
import { db } from '../firebaseConfig';
import { GrigliataDefensePopup } from './GrigliataDefensePopup';
import './grigliataCombat.css';

const REQUESTS = 'grigliata_combat_requests';
const errorCode = error => error?.code?.split('/').pop();
const CANCELLED = { status: 'cancelled' };
// The callable can refuse a stale submission before the private request listener sees the cancellation.
const cancelledError = error => error?.details?.status === 'cancelled'
  || (errorCode(error) === 'failed-precondition' && error?.message === "L'azione è stata annullata.");
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
    // Keep the last server list while offline. Cached requests may already be settled or cancelled.
    const unsubscribe = onSnapshot(labelFirestoreTarget(pending,'grigliata.combat-requests.pending.subscribe.v1','shell'), { includeMetadataChanges: true }, snapshot => {
      if (!active || snapshot.metadata?.fromCache) return;
      setConnectionError(false);
      const all = snapshot.docs.map(entry => ({...entry.data(), id:entry.id})).sort((a,b) => (a.createdAt?.seconds || 0)-(b.createdAt?.seconds || 0));
      setInbox({
        uid,
        waiting: all.filter(entry => entry.status === 'waiting'),
        damage: all.filter(entry => entry.status === 'damagePending'),
      });
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
    if (cancelledError(error)) return CANCELLED;
    if (UNCONFIRMED.includes(errorCode(error))) throw unconfirmedDefense();
    throw new Error(error?.message || 'Risposta non inviata. Riprova.');
  }
  if (!reply?.data?.outcome && reply?.data?.status !== 'cancelled') throw unconfirmedDefense();
  return reply.data;
}

// The popup follows the owner's private document for a retained reply or receipt, including after it leaves the query.
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
    if (cancelledError(error)) return CANCELLED;
    throw new Error(damageErrorText(error));
  }
  if (reply?.data?.status === 'cancelled') return CANCELLED;
  const recorded = reply?.data?.damageApplied?.amount;
  if (!Number.isSafeInteger(recorded) || recorded < 0) throw new Error(RETRY_SAFE);
  return { amount: recorded };
}
