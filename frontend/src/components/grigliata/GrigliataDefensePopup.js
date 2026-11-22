import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FaClock, FaHeartBroken, FaShieldAlt, FaTimes } from 'react-icons/fa';
import {
  combatAppliedDamage, combatCardText, combatDamageFloor, combatDamageProposal, combatDefenderOutcomeLabel, combatProposalLabel,
  formatCombatRoll,
} from './combatPresentation';
import { AppliedDamage, TargetDamage } from './GrigliataDamageConfirmation';
import { CombatDiceCanvas, CombatDiceDrag, combatDiceFaces } from './GrigliataCombatDice';
import './grigliataCombat.css';

const requestKey = request => JSON.stringify([request.id || request.combatId, request.target?.placementId, request.round]);
const RECEIPT_LIMIT = 4;
const NONE = [];
// Keep each pawn's number for the session, including while its receipt is closed or queued.
function rememberReceiptTargets(targets, receipts) {
  const next = new Map(targets);
  for (const { target } of receipts) {
    const ids = next.get(target.name) || NONE;
    if (target.placementId && !ids.includes(target.placementId)) {
      next.set(target.name, [...ids, target.placementId]);
    }
  }
  return next;
}

const onReceiptMap = (receipt, backgroundId) =>
  !receipt.immediate || backgroundId === undefined || receipt.damage.backgroundId === backgroundId;

function showReceipts(queue, added, stillPending) {
  const keys = new Set(added.map(receipt => receipt.key));
  const combined = [...queue.shown.filter(receipt => !keys.has(receipt.key)), ...added];
  const pushedOut = combined.slice(0, -RECEIPT_LIMIT).filter(stillPending);
  return {
    ...queue,
    shown: combined.slice(-RECEIPT_LIMIT),
    waiting: [...queue.waiting.filter(receipt => !keys.has(receipt.key)), ...pushedOut],
    targets: rememberReceiptTargets(queue.targets, added),
  };
}

// The prompt's first field, never a control from a receipt.
const focusPrompt = dialog => dialog?.querySelector(
  'form[data-defense-prompt] input:enabled, form[data-defense-prompt] button:enabled'
)?.focus();
const NO_EFFECTS = { effects: [] };
const settledWithoutDamage = feed => feed?.settlement === 'none';
const NO_PROPOSAL = { amount: null, formula: '' };
const DAMAGE_FAILED = 'Danno non applicato. Riprova.';
const DEFENSE_FAILED = 'Risposta non inviata. Riprova.';
const without = (all, id) => {
  if (!(id in all)) return all;
  const { [id]: gone, ...rest } = all;
  return rest;
};
const receiptDetails = request => ({
  combatId: request.combatId,
  scope: requestScope(request, request.target?.placementId, request.ownerUid),
  target: { placementId: request.target?.placementId, name: request.target?.name || 'Difesa' },
  actionName: request.action?.name,
});
const lostFocus = () => !document.activeElement || document.activeElement === document.body;

// Focus inside a receipt's damage area is remembered as `{ id, name, element }`. A re-render that removes the focused
// control (the receipt moving between the dialog and the corner, or a reload of its copy) leaves focus nowhere: the
// control left behind is then the one to take back, never one the viewer has since left for somewhere else.
const FOCUSABLE = 'input, button:enabled, [tabindex]';
const leftBehind = memory => (memory && !memory.element.isConnected && lostFocus() ? memory : null);
function refocusDamage(memory, root) {
  const area = Array.from(root?.querySelectorAll('[data-damage-for]') || [])
    .find(node => node.getAttribute('data-damage-for') === memory.id);
  const controls = Array.from(area?.querySelectorAll(FOCUSABLE) || []);
  (controls.find(control => memory.name && control.getAttribute('name') === memory.name) || controls[0])?.focus();
}

// The identities a private request must match; null when one is missing.
const requestScope = ({ id, combatId, backgroundId }, placementId, ownerUid) => (
  [id, combatId, placementId, ownerUid].every(value => typeof value === 'string' && value)
    ? { requestId: id, combatId, placementId, ownerUid, backgroundId: typeof backgroundId === 'string' ? backgroundId : null }
    : null
);

// What this answer lets its owner confirm: only a landed outcome with a concrete damage on this very pawn, by the
// rule the Registro uses. The amount itself is never taken from here: the form waits for the server's own copy.
function receiptDamageScope(scope, answer) {
  if (!scope) return null;
  const { placementId } = scope;
  const landed = { status: 'done', outcome: answer.outcome, damage: answer.damage, placementId };
  if (!answer.damagePending && !combatDamageProposal({ effects: answer.effects || [] }, landed)) return null;
  return scope;
}

// The damage of an action that asked this owner for no defense, still to confirm: a receipt with the same scope,
// document watch and form as an answered defense, or null unless every identity is this owner's.
function immediateDamageReceipt(entry, ownerUid) {
  if (entry?.status !== 'damagePending') return null;
  const scope = requestScope(entry, entry.ownerDamage?.target?.placementId, ownerUid);
  const owner = receiptOwnerDamage({ id: entry.id, data: entry }, scope);
  const proposal = owner && !owner.damageApplied ? combatDamageProposal(NO_EFFECTS, owner) : null;
  if (!proposal) return null;
  return {
    key: JSON.stringify(['damage', entry.id]),
    combatId: entry.combatId,
    scope,
    immediate: true,
    target: { placementId: owner.placementId, name: owner.name || 'Bersaglio' },
    actionName: entry.ownerDamage.action?.name,
    source: entry.defense?.consent ? 'Consenso dato'
      : entry.defense ? entry.defense.label || 'Difesa' : 'Nessuna difesa richiesta',
    outcome: 'Danno subito',
    proposal: combatProposalLabel(proposal.amount),
    effects: [],
    damage: scope,
  };
}

function scopedRequestData(snapshot, scope) {
  const data = snapshot?.data;
  if (!scope || snapshot?.id !== scope.requestId || !data || data.ownerUid !== scope.ownerUid
    || data.combatId !== scope.combatId || (scope.backgroundId && data.backgroundId !== scope.backgroundId)) return null;
  return data;
}

// The owner's private copy of this one outcome, with only the fields the form needs.
export function receiptOwnerDamage(snapshot, scope) {
  const target = scopedRequestData(snapshot, scope)?.ownerDamage?.target;
  if (!target || target.placementId !== scope.placementId || target.ownerUid !== scope.ownerUid) return null;
  const { placementId, name, ownerUid, status, round, outcome, damage, critical } = target;
  return {
    placementId, name, ownerUid, status, round, outcome, damage,
    critical: critical && typeof critical === 'object' ? critical : null,
    damageApplied: combatAppliedDamage(target),
  };
}

function nextDamageFeed(before = {}, snapshot, scope) {
  const data = scopedRequestData(snapshot, scope);
  const owner = receiptOwnerDamage(snapshot, scope);
  let settlement = before.settlement;
  if (owner?.damageApplied || combatDamageProposal(NO_EFFECTS, owner)) settlement = 'proposal';
  else if (data?.target?.placementId === scope.placementId && data.damagePending === false) settlement = 'none';
  return { synced: true, owner, settlement };
}

// What a receipt shows below its outcome: the confirmation form, a recorded application, a lost copy, the wait for the
// server's copy, or nothing when the server holds no damage to confirm for this pawn.
function receiptDamageView(feed = {}, state = {}) {
  const { owner } = feed;
  // What the server recorded wins; the reply to this viewer's own application covers the moments before the copy.
  const applied = owner?.damageApplied || state.applied || null;
  const proposal = owner ? combatDamageProposal(NO_EFFECTS, owner) : null;
  if (feed.synced && !feed.error && owner && (proposal || applied)) return { kind: 'target', owner, proposal, applied };
  if (applied) return { kind: 'applied', applied };
  if (feed.error) return { kind: 'error' };
  if (!feed.synced) return { kind: 'loading' };
  return null;
}

// The same private watch follows a defense from sending to its retained receipt.
function RequestWatch({ scope, attempt, watch, setFeeds, cancelCombat }) {
  const { requestId, combatId, placementId, backgroundId, ownerUid } = scope;
  useEffect(() => {
    let active = true;
    const read = { requestId, combatId, placementId, backgroundId, ownerUid };
    const fail = () => { if (active) setFeeds(all => ({ ...all, [requestId]: { ...all[requestId], error: true } })); };
    let stop;
    try {
      stop = watch(requestId, {
        next: snapshot => {
          if (!active || snapshot?.fromCache) return;
          const status = scopedRequestData(snapshot, read)?.status;
          if (status === 'cancelled') {
            cancelCombat(combatId);
            return;
          }
          if (status === 'waiting') return;
          setFeeds(all => ({ ...all, [requestId]: nextDamageFeed(all[requestId], snapshot, read) }));
        },
        error: fail,
      });
    } catch {
      fail();
    }
    return () => {
      active = false;
      if (typeof stop === 'function') stop();
      // Reopening reloads the confirmation form. Keep only the proof the throw already settled.
      setFeeds(all => {
        const settlement = all[requestId]?.settlement;
        return settlement ? { ...all, [requestId]: { settlement } } : without(all, requestId);
      });
    };
  }, [watch, requestId, combatId, placementId, backgroundId, ownerUid, attempt, setFeeds, cancelCombat]);
  return null;
}

function DefenseReceipts({ receipts, targets, onDismiss, renderDamage, feeds }) {
  return (
    <div role="status" className="gc-defense-receipts">
      {receipts.map(receipt => {
        const { name: pawnName, placementId } = receipt.target;
        const ids = targets.get(pawnName);
        const name = ids?.length > 1 && ids.includes(placementId)
          ? pawnName + ' · Pedina ' + (ids.indexOf(placementId) + 1)
          : pawnName;
        const title = [name, receipt.actionName].filter(Boolean).join(' · ');
        const damage = renderDamage?.(receipt, name);
        const feed = feeds[receipt.damage?.requestId];
        const owner = feed?.owner;
        const current = combatDamageProposal(NO_EFFECTS, owner);
        const proposal = current
          ? combatProposalLabel(current.amount, receipt.effects.filter(effect => effect.kind !== 'damage'))
          : receipt.proposal;
        return (
          <div className={damage ? 'gc-defense-receipt gc-defense-receipt-damage' : 'gc-defense-receipt'} key={receipt.key}>
            <div>
              <small>{title}</small>
              <strong>{receipt.outcome}</strong>
              {receipt.source && <p>{receipt.source}</p>}
              {receipt.rolls && (
                <p className="gc-defense-roll">
                  {receipt.rolls.attack && <>{receipt.rolls.attack} <code>{receipt.rolls.attackRoll}</code> contro la tua </>}
                  {receipt.rolls.defense}{' '}
                  <code>{receipt.rolls.roll}</code>
                </p>
              )}
              {receipt.dice?.length > 0 && <CombatDiceCanvas rolls={receipt.dice} kind="defense" gesture={receipt.gesture} />}
              {receipt.waitingForDamage && !current && feed?.settlement !== 'proposal' && <p>{settledWithoutDamage(feed)
                ? 'Nessun danno da applicare' : 'In attesa che l’attaccante tiri il danno.'}</p>}
              {proposal && <p>{proposal}</p>}
              {receipt.problem && <p className="gc-error">{receipt.problem}</p>}
              {receipt.cardText && <p className="gc-source">{receipt.cardText}</p>}
              {/* Outside the receipt's announcement: the form speaks through its own alert and status. */}
              {damage && (
                <div className="gc-defense-damage" aria-live="off" data-damage-for={receipt.damage.requestId}>{damage}</div>
              )}
            </div>
            <button type="button" aria-label={receipt.immediate ? 'Chiudi esito danno' : 'Chiudi esito difesa'} onClick={() => onDismiss(receipt.key)}>
              <FaTimes aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// `sent` holds the values of an answer in flight or whose reply was lost: shown as sent, and resent as they are by the
// retry of an `unconfirmed` answer, for the same round.
function DefensePrompt({ request, busy, error, sent, unconfirmed, onRespond, onDefer, titleId, descriptionId, queueLength }) {
  const rules = request.defense || {};
  const { action } = request;
  // What a consent accepts: the proposed rolls and the card's own text; older requests without them read as before.
  const terms = rules.consent ? [['Danno', action?.damageExpr], ['Cura', action?.healExpr]]
    .filter(([, expr]) => expr).map(parts => parts.join(' ')).join(' · ') : '';
  const cardText = action?.description || action?.manualEffect;
  const [defense, setDefense] = useState(sent?.defense ?? rules.value ?? '');
  const [reduction, setReduction] = useState(sent?.reduction ?? rules.reduction ?? '');
  const [die, setDie] = useState(sent?.die ?? rules.die ?? '');
  const retryRef = useRef(null);
  const label = rules.label || 'Difesa';
  const integerIn = (value, min, max) => value !== '' && Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
  const canRoll = integerIn(defense, -99, 999)
    && (!rules.showDie || integerIn(die, 2, 100))
    && (!rules.showReduction || integerIn(reduction, 0, 999));
  const locked = Boolean(sent);

  useEffect(() => {
    // The retry replaces the consent button pressed: focus follows it, unless the viewer is already elsewhere.
    if (unconfirmed && lostFocus()) retryRef.current?.focus();
  }, [unconfirmed]);

  function send(gesture) {
    if (busy) return;
    if (unconfirmed) {
      onRespond(request, sent);
      return;
    }
    if (!canRoll) return;
    const values = {
      defense: Number(defense),
      ...(rules.showDie ? { die: Number(die) } : {}),
      ...(rules.showReduction ? { reduction: Number(reduction) } : {}),
    };
    if (gesture) onRespond(request, values, gesture);
    else onRespond(request, values);
  }

  return (
    <>
      <header className="gc-heading">
        <FaShieldAlt aria-hidden="true" />
        <h2 id={titleId}>Difesa</h2>
        {queueLength > 1 && <small>{queueLength} richieste</small>}
      </header>
      <form className="gc-panel-body gc-stack" data-defense-prompt="" onSubmit={event => { event.preventDefault(); send(); }}>
        <div id={descriptionId} className="gc-defense-request">
          <strong>{request.actor?.name || 'Attaccante'} → {request.target?.name || 'Bersaglio'}</strong>
          <p>{action?.name || 'Azione'}{request.round > 1 && ' · Rilancio ' + (request.round - 1)}</p>
          {request.attack && (
            <p className="gc-defense-roll">{request.attack.label} <code>{formatCombatRoll(request.attack)}</code></p>
          )}
          {terms && <p className="gc-defense-roll">{terms}</p>}
        </div>
        {rules.consent ? (
          <>
            {cardText && <p className="gc-source">{cardText}</p>}
            <p className="gc-hint">Vuoi accettare l’effetto per questa pedina?</p>
          </>
        ) : (
          <div className="gc-defense-fields">
            <label className="gc-field">
              <span>{label}</span>
              <input type="number" min="-99" max="999" step="1" value={defense} required readOnly={locked} onChange={event => setDefense(event.target.value)} />
            </label>
            {rules.showDie && (
              <label className="gc-field">
                <span>Dado Anima</span>
                <input type="number" min="2" max="100" step="1" value={die} required readOnly={locked} onChange={event => setDie(event.target.value)} />
              </label>
            )}
            {rules.showReduction && (
              <label className="gc-field">
                <span>Riduzione danni</span>
                <input type="number" min="0" max="999" step="1" value={reduction} required readOnly={locked} onChange={event => setReduction(event.target.value)} />
              </label>
            )}
          </div>
        )}
        {unconfirmed && rules.consent && <p className="gc-hint">Risposta inviata: {sent.consent ? 'Accetta' : 'Rifiuta'}.</p>}
        {error && <p className="gc-error" role="alert">{error.message || error}</p>}
        {!rules.consent && rules.showDie && !unconfirmed && (
          <div className="gc-defense-dice">
            <CombatDiceDrag disabled={busy || !canRoll} kind="defense" notation={integerIn(die, 2, 100) ? 'd' + die : ''} onThrow={send} />
            {integerIn(die, 2, 100) && <code>d{die}</code>}
          </div>
        )}
        <div className="gc-dialog-buttons">
          <button type="button" className="gc-secondary" onClick={onDefer}><FaClock aria-hidden="true" />Più tardi</button>
          {unconfirmed ? (
            <button ref={retryRef} type="submit" className="gc-primary" disabled={busy}>Riprova</button>
          ) : rules.consent ? (
            <>
              <button type="button" className="gc-secondary" disabled={busy} onClick={() => onRespond(request, { consent: false })}>Rifiuta</button>
              <button type="button" className="gc-primary" disabled={busy} onClick={() => onRespond(request, { consent: true })}>Accetta</button>
            </>
          ) : (
            <button type="submit" className="gc-primary" disabled={busy || !canRoll}>{rules.showDie ? 'Tira ' : 'Invia '}{label}</button>
          )}
        </div>
        {busy && <p className="gc-hint" role="status">Invio della risposta…</p>}
      </form>
    </>
  );
}

function DefenseInbox({
  uid, isManager, requests, damageRequests, activeDamageBackgroundId, onRespond, busy, error, onWatchDamage, onApplyDamage,
}) {
  const [deferred, setDeferred] = useState(new Map());
  const [activeKey, setActiveKey] = useState('');
  const [receiptQueue, setReceiptQueue] = useState(() => ({ shown: [], waiting: [], parked: [], targets: new Map() }));
  const { shown: receipts, waiting: queuedReceipts, parked: parkedReceipts, targets } = receiptQueue;
  // Per answered request with damage to confirm: the server's latest copy, and this viewer's application (in flight,
  // refused with the amount sent, or recorded). Kept here, not in the form, so a receipt moving between the dialog and
  // the corner keeps both, and a second send stays refused while one is in flight.
  const [feeds, setFeeds] = useState({});
  const [damage, setDamage] = useState({});
  // The amount typed and not yet sent, with the critical it was typed against: kept here for the same reason.
  const [drafts, setDrafts] = useState({});
  const [attempts, setAttempts] = useState({});
  // Keep each unconfirmed answer and its values until that defense is settled.
  const [answers, setAnswers] = useState({});
  const answering = useRef(null);
  const [cancelledCombats, setCancelledCombats] = useState(() => new Set());
  const cancelled = useRef(cancelledCombats);
  const cancelCombat = useCallback(combatId => {
    if (!combatId || cancelled.current.has(combatId)) return;
    cancelled.current = new Set(cancelled.current).add(combatId);
    if (answering.current?.request.combatId === combatId) answering.current = null;
    setCancelledCombats(cancelled.current);
    setAnswers(all => Object.values(all).reduce((kept, answer) =>
      answer.request.combatId === combatId ? without(kept, answer.key) : kept, all));
    setDeferred(all => new Map([...all].filter(([, id]) => id !== combatId)));
    setReceiptQueue(queue => {
      const retain = receipt => receipt.combatId !== combatId;
      return {
        ...queue,
        shown: queue.shown.filter(retain),
        waiting: queue.waiting.filter(retain),
        parked: queue.parked.filter(retain),
      };
    });
  }, []);
  useLayoutEffect(() => {
    for (const entry of [...requests, ...damageRequests]) {
      if (entry?.status === 'cancelled' && entry.ownerUid === uid) cancelCombat(entry.combatId);
    }
  }, [requests, damageRequests, uid, cancelCombat]);
  // Damage to confirm already offered once: a later write of its request never offers or announces it again.
  const offeredDamage = useRef(new Set());
  const seenInOwnerInbox = useRef(new Set());
  const liveKeys = useRef(new Set());
  const locks = useRef(new Set());
  const dialogRef = useRef(null);
  const feedRef = useRef(null);
  const damageFocus = useRef(null);
  // A receipt control being edited in the corner when a prompt took the screen: focus goes back to it on close.
  const returnFocus = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const waitingRequests = useMemo(() => requests.filter(entry =>
    entry.status === 'waiting' && !cancelledCombats.has(entry.combatId)), [requests, cancelledCombats]);
  const liveRequestKeys = useMemo(() => new Set(waitingRequests.map(requestKey)), [waitingRequests]);
  const unsettled = useMemo(() => Object.values(answers).filter(answer => answer.busy || answer.unconfirmed), [answers]);
  const held = unsettled.filter(answer => !liveRequestKeys.has(answer.key));
  const queue = [...waitingRequests, ...held.map(answer => answer.request)];
  const available = queue.filter(candidate => !deferred.has(requestKey(candidate)));
  const request = available.find(candidate => requestKey(candidate) === activeKey) || available[0];
  const key = request ? requestKey(request) : '';
  const own = answers[key];
  const confirmsDamage = Boolean(onWatchDamage && onApplyDamage);
  // Damage ready to confirm, including earlier defenses when the owner returns on another device.
  const pendingDamage = useMemo(() => (confirmsDamage
    ? damageRequests
      .filter(entry => entry?.backgroundId === activeDamageBackgroundId && !cancelledCombats.has(entry?.combatId))
      .map(entry => immediateDamageReceipt(entry, uid)).filter(Boolean)
    : NONE), [activeDamageBackgroundId, confirmsDamage, damageRequests, uid, cancelledCombats]);
  const visibleReceipts = receipts.filter(receipt => onReceiptMap(receipt, activeDamageBackgroundId));
  const activeDamageIds = new Set(pendingDamage.map(receipt => receipt.damage.requestId));
  const listedDamageIds = useMemo(() => new Set(damageRequests.map(entry => entry?.id)), [damageRequests]);
  useLayoutEffect(() => {
    // The host preserves the last server-confirmed list across cached snapshots.
    for (const id of listedDamageIds) seenInOwnerInbox.current.add(id);
  }, [listedDamageIds]);
  const stillPending = useCallback(receipt => {
    const id = receipt.damage?.requestId;
    if (!confirmsDamage || !id) return false;
    const requiresListing = receipt.immediate || (receipt.waitingForDamage && seenInOwnerInbox.current.has(id));
    if (requiresListing && !listedDamageIds.has(id)) return false;
    const feed = feeds[id];
    return !feed?.owner?.damageApplied && !damage[id]?.applied && !settledWithoutDamage(feed);
  }, [confirmsDamage, damage, feeds, listedDamageIds]);
  const hiddenDamage = queuedReceipts.filter(receipt => stillPending(receipt)
    && (!receipt.immediate || activeDamageIds.has(receipt.damage.requestId)));

  // Park other maps outside the visible slots. While someone edits a receipt, new arrivals join the queue.
  useLayoutEffect(() => {
    const focused = document.activeElement;
    const editedId = feedRef.current?.contains(focused)
      ? focused.closest('[data-damage-for]')?.getAttribute('data-damage-for')
      : null;
    const offered = key ? NONE : pendingDamage.filter(receipt => !offeredDamage.current.has(receipt.damage.requestId));
    const retainedIds = new Set([...receipts, ...queuedReceipts, ...parkedReceipts].map(receipt => receipt.damage?.requestId));
    const added = offered.filter(receipt => !retainedIds.has(receipt.damage.requestId));
    offered.forEach(receipt => offeredDamage.current.add(receipt.damage.requestId));
    const onMap = receipt => onReceiptMap(receipt, activeDamageBackgroundId);
    setReceiptQueue(queue => {
      const shown = queue.shown.filter(onMap);
      const movedAside = queue.shown.filter(receipt => !onMap(receipt));
      const parked = [...queue.parked, ...movedAside].filter(stillPending);
      const restored = key ? NONE : parked.filter(onMap);
      const stayingParked = key ? parked : parked.filter(receipt => !onMap(receipt));
      const waiting = queue.waiting.filter(stillPending);
      const candidates = [...restored, ...added];
      if (!candidates.length && !movedAside.length && waiting.length === queue.waiting.length
        && stayingParked.length === queue.parked.length) return queue;

      const editing = editedId && shown.some(receipt => receipt.damage?.requestId === editedId);
      const slots = editing ? 0 : RECEIPT_LIMIT - shown.length;
      const overflow = Math.max(0, candidates.length - slots);
      return {
        shown: [...shown, ...candidates.slice(overflow)],
        waiting: [...waiting, ...candidates.slice(0, overflow)],
        parked: stayingParked,
        targets: rememberReceiptTargets(queue.targets, added),
      };
    });
  }, [activeDamageBackgroundId, key, pendingDamage, receipts, queuedReceipts, parkedReceipts, stillPending]);

  // A queued receipt keeps its draft and submission. Only discard them once the receipt leaves the queue entirely.
  useEffect(() => {
    const retained = new Set([...receipts, ...queuedReceipts, ...parkedReceipts].map(receipt => receipt.scope?.requestId));
    const prune = (all, ids = retained) => Object.keys(all).reduce((kept, id) => ids.has(id) ? kept : without(kept, id), all);
    const followed = new Set([...retained, ...unsettled.map(({ request }) => request.id)]);
    setFeeds(all => prune(all, followed));
    setDamage(all => prune(all));
    setDrafts(all => prune(all));
    setAttempts(all => prune(all));
  }, [parkedReceipts, queuedReceipts, receipts, unsettled]);

  useLayoutEffect(() => {
    liveKeys.current = liveRequestKeys;
    setAnswers(all => Object.values(all).reduce((kept, answer) => {
      if (answer.busy || answer.unconfirmed || liveRequestKeys.has(answer.key)) return kept;
      return without(kept, answer.key);
    }, all));
  }, [liveRequestKeys]);

  useEffect(() => {
    const follow = event => {
      const area = event.target instanceof Element ? event.target.closest('[data-damage-for]') : null;
      const ours = area && (feedRef.current?.contains(area) || dialogRef.current?.contains(area));
      damageFocus.current = ours
        ? { id: area.getAttribute('data-damage-for'), name: event.target.getAttribute('name'), element: event.target }
        : null;
    };
    const leave = event => {
      const memory = damageFocus.current;
      if (event.relatedTarget || memory?.element !== event.target) return;
      // Focus left for nowhere: the viewer moved away, unless a re-render just removed the control itself.
      Promise.resolve().then(() => {
        const { element } = memory;
        if (damageFocus.current === memory && element.isConnected && document.activeElement !== element) damageFocus.current = null;
      });
    };
    document.addEventListener('focusin', follow);
    document.addEventListener('focusout', leave);
    return () => {
      document.removeEventListener('focusin', follow);
      document.removeEventListener('focusout', leave);
    };
  }, []);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (key) {
      if (!dialog.open) {
        returnFocus.current = leftBehind(damageFocus.current);
        dialog.showModal();
      }
      // A new prompt takes focus, even from a receipt above it.
      focusPrompt(dialog);
    } else if (dialog.open) {
      // Closed while editing a receipt (or after interrupting one in the corner): focus follows its field to the corner.
      const memory = leftBehind(damageFocus.current) || (lostFocus() ? returnFocus.current : null);
      returnFocus.current = null;
      dialog.close();
      if (memory) refocusDamage(memory, feedRef.current);
    }
    setActiveKey(key);
  }, [key]);

  // Any other re-render that removed the focused receipt control, such as a reload of its copy, hands focus to what
  // replaced it, once there is something to focus.
  useLayoutEffect(() => {
    const memory = leftBehind(damageFocus.current);
    if (!memory) return;
    if (receipts.some(receipt => receipt.damage?.requestId === memory.id)) {
      refocusDamage(memory, dialogRef.current.open ? dialogRef.current : feedRef.current);
    } else {
      damageFocus.current = null;
      if (key) focusPrompt(dialogRef.current);
    }
  });

  function dismiss(receiptKey) {
    setReceiptQueue(queue => {
      const receipt = queue.shown.find(item => item.key === receiptKey);
      if (!receipt) return queue;
      return {
        ...queue,
        shown: queue.shown.filter(item => item.key !== receiptKey),
        waiting: stillPending(receipt) ? [...queue.waiting, receipt] : queue.waiting,
      };
    });
    if (key) focusPrompt(dialogRef.current);
  }

  function defer() {
    if (!key) return;
    setDeferred(new Map(queue.map(entry => [requestKey(entry), entry.combatId]).filter(([id]) => id === key || deferred.has(id))));
  }

  function reopen() {
    setDeferred(new Map());
  }

  // The oldest left behind come back, within the four kept. Once the count itself goes, focus follows to the newest
  // amount reopened when it can be edited, through the same hand-over as a receipt moving between dialog and corner.
  function reopenDamage(event) {
    const batch = hiddenDamage.slice(0, RECEIPT_LIMIT);
    if (!batch.length) return;
    damageFocus.current = { id: batch[batch.length - 1].damage.requestId, name: 'amount', element: event.currentTarget };
    setReceiptQueue(queue => showReceipts(queue, batch, stillPending));
  }

  function addReceipt(receipt) {
    setReceiptQueue(queue => showReceipts(queue, [receipt], stillPending));
  }

  async function respond(answeredRequest, values, gesture) {
    const { combatId } = answeredRequest;
    if (answering.current || cancelled.current.has(combatId)) return;
    const answeredKey = requestKey(answeredRequest);
    const sent = { key: answeredKey, request: answeredRequest, values };
    answering.current = sent;
    const save = next => setAnswers(all => next ? { ...all, [answeredKey]: next } : without(all, answeredKey));
    // A retry keeps its prompt as it was while it goes: same values, same round.
    save({ ...sent, busy: true, unconfirmed: Boolean(answers[answeredKey]?.unconfirmed) });
    let reply;
    try {
      reply = await onRespond(answeredRequest, values);
    } catch (failure) {
      if (cancelled.current.has(combatId)) return;
      const message = failure?.message || DEFENSE_FAILED;
      if (failure?.unconfirmed) {
        save({ ...sent, error: message, unconfirmed: true });
      } else if (liveKeys.current.has(answeredKey)) {
        save({ ...sent, error: message });
      } else {
        // Refused for good, and the request is gone: the prompt goes too, and the reason stays in view.
        save(null);
        addReceipt({ key: answeredKey, ...receiptDetails(answeredRequest), outcome: 'Risposta non registrata', problem: message });
      }
      return;
    } finally {
      if (answering.current === sent) answering.current = null;
    }
    if (cancelled.current.has(combatId)) return;
    if (reply?.status === 'cancelled') {
      cancelCombat(combatId);
      return;
    }
    save(null);
    if (!reply?.outcome) return;
    const { action } = answeredRequest;
    const { attack, defense } = reply;
    const details = receiptDetails(answeredRequest);
    addReceipt({
      key: answeredKey,
      ...details,
      outcome: combatDefenderOutcomeLabel(reply.outcome, action?.kind, action?.hands),
      rolls: defense?.total != null && (attack?.total != null || answeredRequest.defense?.showDie) && {
        attack: attack?.total != null ? attack.label || 'Attacco' : null,
        attackRoll: formatCombatRoll(attack),
        defense: defense.label || 'Difesa',
        roll: formatCombatRoll(defense),
      },
      dice: answeredRequest.defense?.showDie && !answeredRequest.defense?.consent
        ? combatDiceFaces(defense?.rolls?.map(value => ({ sides: defense.sides, value })))
        : NONE,
      gesture,
      waitingForDamage: reply.damagePending === true,
      proposal: combatProposalLabel(reply.damage, reply.effects),
      effects: reply.effects || [],
      // A landed spell or technique can do more than damage (e.g. no movement next turn): the defender sees it here.
      cardText: ['hit', 'accepted'].includes(reply.outcome) ? combatCardText(action, action?.kind) : '',
      damage: receiptDamageScope(details.scope, reply),
    });
  }

  async function applyDamage(scope, owner, amount) {
    const { requestId: id, combatId } = scope;
    // Checked again here, not only where the form is offered: one application in flight per pawn, none once recorded.
    if (cancelled.current.has(combatId) || locks.current.has(id) || owner.damageApplied || damage[id]?.applied) return;
    locks.current.add(id);
    const criticalScore = owner.critical?.score ?? null;
    const submitted = { value: String(amount), criticalScore };
    setDamage(all => ({ ...all, [id]: { busy: true, submitted } }));
    // Keep the reply if the receipt is still visible or waiting to be reopened.
    const settle = next => {
      if (!cancelled.current.has(combatId)) setDamage(all => (all[id] ? { ...all, [id]: next } : all));
    };
    try {
      const applied = await onApplyDamage({ combatId, targetPlacementId: owner.placementId, amount, criticalScore });
      if (applied?.status === 'cancelled') cancelCombat(combatId);
      else settle({ applied });
    } catch (failure) {
      settle({ error: failure?.message || DAMAGE_FAILED, submitted });
    } finally {
      locks.current.delete(id);
    }
  }

  function renderDamage(receipt, name) {
    const scope = receipt.damage;
    if (!confirmsDamage || !scope) return null;
    const id = scope.requestId;
    const view = receiptDamageView(feeds[id], damage[id]);
    if (view?.kind === 'target') {
      const { owner, proposal, applied } = view;
      return (
        <TargetDamage
          name={name}
          proposal={proposal || NO_PROPOSAL}
          floor={combatDamageFloor(proposal, isManager)}
          criticalScore={owner.critical?.score ?? null}
          applied={applied}
          state={damage[id]}
          onApply={amount => applyDamage(scope, owner, amount)}
          draft={drafts[id]}
          onDraftChange={next => setDrafts(all => ({ ...all, [id]: next }))}
        />
      );
    }
    if (view?.kind === 'applied') return <AppliedDamage applied={view.applied} />;
    if (view?.kind === 'error') {
      return (
        <div className="gc-damage-retry">
          <p className="gc-error" role="alert">
            Danno da confermare non aggiornato. Riprova; se non torna, applicalo dal Registro della mappa.
          </p>
          <button type="button" className="gc-link" onClick={() => setAttempts(all => ({ ...all, [id]: (all[id] || 0) + 1 }))}>
            Ricarica il danno
          </button>
        </div>
      );
    }
    if (view?.kind === 'loading' && (!receipt.waitingForDamage || feeds[id]?.settlement === 'proposal')) {
      return <p className="gc-hint">Recupero il danno da confermare…</p>;
    }
    return null;
  }

  // The owner query covers queued proposals it already lists. Other retained receipts and unsettled
  // replies need their own document for cancellation after the request drops out of the query.
  const retainedOutsideQuery = [...queuedReceipts, ...parkedReceipts].filter(receipt => {
    const id = receipt.damage?.requestId;
    return id && (damage[id]?.busy || (!listedDamageIds.has(id) && !seenInOwnerInbox.current.has(id) && stillPending(receipt)));
  });
  const scopes = [
    ...unsettled.map(({ request }) => requestScope(request, request.target?.placementId, uid)),
    ...[...receipts, ...retainedOutsideQuery].map(receipt => receipt.scope),
  ];
  const watched = new Map(onWatchDamage ? scopes.filter(Boolean).map(scope => [scope.requestId, scope]) : []);

  return (
    <>
      {Array.from(watched.values(), scope => (
        <RequestWatch
          key={scope.requestId}
          scope={scope}
          attempt={attempts[scope.requestId] || 0}
          watch={onWatchDamage}
          setFeeds={setFeeds}
          cancelCombat={cancelCombat}
        />
      ))}
      <div className="gc-defense-feed" ref={feedRef}>
        {/* Newest first in the DOM: the corner stack shows it at the bottom and scrolls up to older ones. */}
        <DefenseReceipts receipts={request ? [] : [...visibleReceipts].reverse()} targets={targets} onDismiss={dismiss} renderDamage={renderDamage} feeds={feeds} />
        {!request && (queue.length > 0 || hiddenDamage.length > 0) && (
          <div className="gc-defense-launchers">
            {hiddenDamage.length > 0 && (
              <button type="button" className="gc-defense-launcher" onClick={reopenDamage}>
                <FaHeartBroken aria-hidden="true" />Danni da confermare · {hiddenDamage.length}
              </button>
            )}
            {queue.length > 0 && (
              <button type="button" className="gc-defense-launcher" onClick={reopen}>
                <FaShieldAlt aria-hidden="true" />Difesa · {queue.length}
              </button>
            )}
          </div>
        )}
      </div>
      <dialog
        className="gc-dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialogRef}
        onCancel={event => {
          event.preventDefault();
          defer();
        }}
      >
        {request && (
          <>
            <DefensePrompt
              key={key}
              {...{ request, titleId, descriptionId }}
              busy={busy || unsettled.some(answer => answer.busy)}
              error={own?.error || error}
              sent={own && (own.busy || own.unconfirmed) ? own.values : null}
              unconfirmed={Boolean(own?.unconfirmed)}
              onRespond={respond}
              onDefer={defer}
              queueLength={queue.length}
            />
            <DefenseReceipts receipts={visibleReceipts} targets={targets} onDismiss={dismiss} renderDamage={renderDamage} feeds={feeds} />
          </>
        )}
      </dialog>
    </>
  );
}

// `onRespond(request, values)` resolves the server's answer, or rejects with a message to show, flagged `unconfirmed`
// when the answer may already be recorded (a retry then resends it for the same round); hosts that report failures
// through `busy` and `error` resolve nothing instead.
// `onWatchDamage(requestId, { next, error })` follows the signed-in owner's private request and returns its unsubscribe.
// `onApplyDamage({ combatId, targetPlacementId, amount, criticalScore })` resolves the recorded `{ amount }` or rejects with
// a message to show. Either command may resolve to `{ status: 'cancelled' }` when cancellation wins.
// `damageRequests` lists the owner's `damagePending` requests from the server (never a cached copy): damage of actions
// that asked no defense, each offered once as a receipt to confirm.
// `isManager` is the signed-in DM, who may confirm any amount for a pawn of theirs; an owner is held to each proposal.
export function GrigliataDefensePopup({
  currentUserId, isManager = false, requests = NONE, damageRequests = NONE, activeDamageBackgroundId, onRespond, busy = false, error,
  onWatchDamage, onApplyDamage,
}) {
  if (!currentUserId || !onRespond) return null;
  const owned = requests.filter(request => request.ownerUid === currentUserId);
  return (
    <DefenseInbox
      key={currentUserId}
      uid={currentUserId}
      isManager={Boolean(isManager)}
      requests={owned}
      damageRequests={damageRequests}
      activeDamageBackgroundId={activeDamageBackgroundId}
      onRespond={onRespond}
      busy={busy}
      error={error}
      onWatchDamage={onWatchDamage}
      onApplyDamage={onApplyDamage}
    />
  );
}

export default GrigliataDefensePopup;
