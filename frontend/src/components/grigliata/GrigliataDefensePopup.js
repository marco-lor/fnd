import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FaClock, FaHeartBroken, FaShieldAlt, FaTimes } from 'react-icons/fa';
import {
  combatAppliedDamage, combatCardText, combatDamageFloor, combatDamageProposal, combatDefenderOutcomeLabel, combatProposalLabel,
  formatCombatRoll,
} from './combatPresentation';
import { AppliedDamage, TargetDamage } from './GrigliataDamageConfirmation';
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
const NO_PROPOSAL = { amount: null, formula: '' };
const DAMAGE_FAILED = 'Danno non applicato. Riprova.';
const DEFENSE_FAILED = 'Risposta non inviata. Riprova.';
const without = (all, id) => {
  if (!(id in all)) return all;
  const { [id]: gone, ...rest } = all;
  return rest;
};
const receiptDetails = ({ target, action }) => ({
  target: { placementId: target?.placementId, name: target?.name || 'Difesa' },
  actionName: action?.name,
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

// The identities a receipt's private copy must match; null when one is missing.
const damageScope = ({ id, combatId, backgroundId }, placementId, ownerUid) => (
  [id, combatId, placementId, ownerUid].every(value => typeof value === 'string' && value)
    ? { requestId: id, combatId, placementId, ownerUid, backgroundId: typeof backgroundId === 'string' ? backgroundId : null }
    : null
);

// What this answer lets its owner confirm: only a landed outcome with a concrete damage on this very pawn, by the
// rule the Registro uses. The amount itself is never taken from here: the form waits for the server's own copy.
function receiptDamageScope(request, answer, ownerUid) {
  const placementId = request.target?.placementId;
  const landed = { status: 'done', outcome: answer.outcome, damage: answer.damage, placementId };
  if (!combatDamageProposal({ effects: answer.effects || [] }, landed)) return null;
  return damageScope(request, placementId, ownerUid);
}

// The damage of an action that asked this owner for no defense, still to confirm: a receipt with the same scope,
// document watch and form as an answered defense, or null unless every identity is this owner's.
function immediateDamageReceipt(entry, ownerUid) {
  if (entry?.status !== 'damagePending') return null;
  const scope = damageScope(entry, entry.ownerDamage?.target?.placementId, ownerUid);
  const owner = receiptOwnerDamage({ id: entry.id, data: entry }, scope);
  const proposal = owner && !owner.damageApplied ? combatDamageProposal(NO_EFFECTS, owner) : null;
  if (!proposal) return null;
  return {
    key: JSON.stringify(['damage', entry.id]),
    immediate: true,
    target: { placementId: owner.placementId, name: owner.name || 'Bersaglio' },
    actionName: entry.ownerDamage.action?.name,
    outcome: 'Danno subito',
    proposal: combatProposalLabel(proposal.amount),
    effects: [],
    damage: scope,
  };
}

// The owner's private copy of this one outcome, `{ id, data, fromCache }` from the host's listener: read only when every
// identity matches the receipt it fills, and only the fields the form needs.
export function receiptOwnerDamage(snapshot, scope) {
  const data = snapshot?.data;
  const target = data?.ownerDamage?.target;
  if (!scope || snapshot?.id !== scope.requestId || !data || data.ownerUid !== scope.ownerUid
    || data.combatId !== scope.combatId || (scope.backgroundId && data.backgroundId !== scope.backgroundId)
    || !target || target.placementId !== scope.placementId || target.ownerUid !== scope.ownerUid) return null;
  const { placementId, name, ownerUid, status, round, outcome, damage, critical } = target;
  return {
    placementId, name, ownerUid, status, round, outcome, damage,
    critical: critical && typeof critical === 'object' ? critical : null,
    damageApplied: combatAppliedDamage(target),
  };
}

// A cached copy may predate the answer: it never clears a copy already read, and the form opens only once the server
// itself has answered.
function nextDamageFeed(before = {}, snapshot, scope) {
  if (snapshot?.fromCache) return before;
  return { synced: true, owner: receiptOwnerDamage(snapshot, scope) };
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

// Follows one receipt's private copy while the receipt is shown, wherever it is shown: rendered once per receipt outside
// the stacks, so moving between the dialog and the corner never reopens it. Gone with the receipt, the user or the popup.
function DamageWatch({ scope, attempt, watch, setFeeds }) {
  const { requestId, combatId, placementId, backgroundId, ownerUid } = scope;
  useEffect(() => {
    let active = true;
    const read = { requestId, combatId, placementId, backgroundId, ownerUid };
    const fail = () => { if (active) setFeeds(all => ({ ...all, [requestId]: { ...all[requestId], error: true } })); };
    let stop;
    try {
      stop = watch(requestId, {
        next: snapshot => { if (active) setFeeds(all => ({ ...all, [requestId]: nextDamageFeed(all[requestId], snapshot, read) })); },
        error: fail,
      });
    } catch {
      fail();
    }
    return () => {
      active = false;
      if (typeof stop === 'function') stop();
      // A retry starts from the server's copy again; a receipt gone leaves nothing behind.
      setFeeds(all => without(all, requestId));
    };
  }, [watch, requestId, combatId, placementId, backgroundId, ownerUid, attempt, setFeeds]);
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
        const owner = feeds[receipt.damage?.requestId]?.owner;
        const current = combatDamageProposal(NO_EFFECTS, owner);
        const proposal = current
          ? combatProposalLabel(current.amount, receipt.effects.filter(effect => effect.kind !== 'damage'))
          : receipt.proposal;
        return (
          <div className={damage ? 'gc-defense-receipt gc-defense-receipt-damage' : 'gc-defense-receipt'} key={receipt.key}>
            <div>
              <small>{title}</small>
              <strong>{receipt.outcome}</strong>
              {receipt.immediate && <p>Nessuna difesa richiesta</p>}
              {receipt.rolls && (
                <p className="gc-defense-roll">
                  {receipt.rolls.attack} <code>{receipt.rolls.attackRoll}</code> contro la tua {receipt.rolls.defense}{' '}
                  <code>{receipt.rolls.roll}</code>
                </p>
              )}
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

  function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (unconfirmed) {
      onRespond(request, sent);
      return;
    }
    if (!canRoll) return;
    onRespond(request, {
      defense: Number(defense),
      ...(rules.showDie ? { die: Number(die) } : {}),
      ...(rules.showReduction ? { reduction: Number(reduction) } : {}),
    });
  }

  return (
    <>
      <header className="gc-heading">
        <FaShieldAlt aria-hidden="true" />
        <h2 id={titleId}>Difesa</h2>
        {queueLength > 1 && <small>{queueLength} richieste</small>}
      </header>
      <form className="gc-panel-body gc-stack" data-defense-prompt="" onSubmit={submit}>
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
            <button type="submit" className="gc-primary" disabled={busy || !canRoll}>Tira {label}</button>
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
  const [deferred, setDeferred] = useState(new Set());
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
  const answering = useRef(false);
  // Damage to confirm already offered once: a later write of its request never offers or announces it again.
  const offeredDamage = useRef(new Set());
  const liveKeys = useRef(new Set());
  const locks = useRef(new Set());
  const dialogRef = useRef(null);
  const feedRef = useRef(null);
  const damageFocus = useRef(null);
  // A receipt control being edited in the corner when a prompt took the screen: focus goes back to it on close.
  const returnFocus = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const liveRequestKeys = useMemo(() => new Set(requests.map(requestKey)), [requests]);
  const attemptsByRequest = Object.values(answers);
  const held = attemptsByRequest.filter(answer => (answer.busy || answer.unconfirmed) && !liveRequestKeys.has(answer.key));
  const queue = [...requests, ...held.map(answer => answer.request)];
  const available = queue.filter(candidate => !deferred.has(requestKey(candidate)));
  const request = available.find(candidate => requestKey(candidate) === activeKey) || available[0];
  const key = request ? requestKey(request) : '';
  const own = answers[key];
  const confirmsDamage = Boolean(onWatchDamage && onApplyDamage);
  // One listener per request shown, at most one per receipt kept.
  const watched = new Map(confirmsDamage
    ? receipts.filter(receipt => receipt.damage).map(receipt => [receipt.damage.requestId, receipt.damage])
    : []);
  // Damage of actions that asked no defense, oldest first, as the server last listed it; those not shown wait behind
  // the corner's count, so neither a closed receipt nor one pushed out of the four is lost.
  const pendingDamage = useMemo(() => (confirmsDamage
    ? damageRequests
      .filter(entry => entry?.backgroundId === activeDamageBackgroundId)
      .map(entry => immediateDamageReceipt(entry, uid)).filter(Boolean)
    : NONE), [activeDamageBackgroundId, confirmsDamage, damageRequests, uid]);
  const visibleReceipts = receipts.filter(receipt => onReceiptMap(receipt, activeDamageBackgroundId));
  const activeDamageIds = new Set(pendingDamage.map(receipt => receipt.damage.requestId));
  const listedDamageIds = useMemo(() => new Set(damageRequests.map(entry => entry?.id)), [damageRequests]);
  const hiddenDamage = queuedReceipts.filter(receipt => !receipt.immediate || activeDamageIds.has(receipt.damage.requestId));

  // Park other maps outside the visible slots. While someone edits a receipt, new arrivals join the queue.
  useLayoutEffect(() => {
    const focused = document.activeElement;
    const editedId = feedRef.current?.contains(focused)
      ? focused.closest('[data-damage-for]')?.getAttribute('data-damage-for')
      : null;
    const added = key ? NONE : pendingDamage.filter(receipt => !offeredDamage.current.has(receipt.damage.requestId));
    added.forEach(receipt => offeredDamage.current.add(receipt.damage.requestId));
    const onMap = receipt => onReceiptMap(receipt, activeDamageBackgroundId);
    const pending = receipt => {
      const id = receipt.damage.requestId;
      return !damage[id]?.applied && (!receipt.immediate || listedDamageIds.has(id));
    };
    setReceiptQueue(queue => {
      const shown = queue.shown.filter(onMap);
      const movedAside = queue.shown.filter(receipt => !onMap(receipt));
      const parked = [...queue.parked, ...movedAside].filter(pending);
      const restored = key ? NONE : parked.filter(onMap);
      const stayingParked = key ? parked : parked.filter(receipt => !onMap(receipt));
      const waiting = queue.waiting.filter(pending);
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
  }, [activeDamageBackgroundId, damage, key, listedDamageIds, pendingDamage]);

  // A queued receipt keeps its draft and submission. Only discard them once the receipt leaves the queue entirely.
  useEffect(() => {
    const retained = new Set([...receipts, ...queuedReceipts, ...parkedReceipts].map(receipt => receipt.damage?.requestId));
    const prune = all => Object.keys(all).reduce((kept, id) => retained.has(id) ? kept : without(kept, id), all);
    setDamage(prune);
    setDrafts(prune);
    setAttempts(prune);
  }, [parkedReceipts, queuedReceipts, receipts]);

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
    }
  });

  function stillPending(receipt) {
    const id = receipt.damage?.requestId;
    return confirmsDamage && id && (!receipt.immediate || listedDamageIds.has(id))
      && !feeds[id]?.owner?.damageApplied && !damage[id]?.applied;
  }

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
    setDeferred(new Set(queue.map(requestKey).filter(id => id === key || deferred.has(id))));
  }

  function reopen() {
    setDeferred(new Set());
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

  async function respond(answeredRequest, values) {
    if (answering.current) return;
    answering.current = true;
    const answeredKey = requestKey(answeredRequest);
    const sent = { key: answeredKey, request: answeredRequest, values };
    const save = next => setAnswers(all => next ? { ...all, [answeredKey]: next } : without(all, answeredKey));
    // A retry keeps its prompt as it was while it goes: same values, same round.
    save({ ...sent, busy: true, unconfirmed: Boolean(answers[answeredKey]?.unconfirmed) });
    let reply;
    try {
      reply = await onRespond(answeredRequest, values);
    } catch (failure) {
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
      answering.current = false;
    }
    save(null);
    if (!reply?.outcome) return;
    const { action } = answeredRequest;
    const { attack, defense } = reply;
    addReceipt({
      key: answeredKey,
      ...receiptDetails(answeredRequest),
      outcome: combatDefenderOutcomeLabel(reply.outcome, action?.kind, action?.hands),
      rolls: attack?.total != null && defense?.total != null && {
        attack: attack.label || 'Attacco',
        attackRoll: formatCombatRoll(attack),
        defense: defense.label || 'Difesa',
        roll: formatCombatRoll(defense),
      },
      proposal: combatProposalLabel(reply.damage, reply.effects),
      effects: reply.effects || [],
      // A landed spell or technique can do more than damage (e.g. no movement next turn): the defender sees it here.
      cardText: ['hit', 'accepted'].includes(reply.outcome) ? combatCardText(action, action?.kind) : '',
      damage: receiptDamageScope(answeredRequest, reply, uid),
    });
  }

  async function applyDamage(scope, owner, amount) {
    const id = scope.requestId;
    // Checked again here, not only where the form is offered: one application in flight per pawn, none once recorded.
    if (locks.current.has(id) || owner.damageApplied || damage[id]?.applied) return;
    locks.current.add(id);
    const criticalScore = owner.critical?.score ?? null;
    const submitted = { value: String(amount), criticalScore };
    setDamage(all => ({ ...all, [id]: { busy: true, submitted } }));
    // Keep the reply if the receipt is still visible or waiting to be reopened.
    const settle = next => setDamage(all => (all[id] ? { ...all, [id]: next } : all));
    try {
      const applied = await onApplyDamage({ combatId: scope.combatId, targetPlacementId: owner.placementId, amount, criticalScore });
      settle({ applied });
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
    if (view?.kind === 'loading') return <p className="gc-hint">Recupero il danno da confermare…</p>;
    return null;
  }

  return (
    <>
      {Array.from(watched.values(), scope => (
        <DamageWatch
          key={scope.requestId}
          scope={scope}
          attempt={attempts[scope.requestId] || 0}
          watch={onWatchDamage}
          setFeeds={setFeeds}
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
              busy={busy || attemptsByRequest.some(answer => answer.busy)}
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
// `onWatchDamage(requestId, { next, error })` follows the signed-in owner's private request and returns its unsubscribe;
// `onApplyDamage({ combatId, targetPlacementId, amount, criticalScore })` resolves the recorded `{ amount }` or rejects with
// a message to show. Without both, receipts read as before.
// `damageRequests` lists the owner's `damagePending` requests from the server (never a cached copy): damage of actions
// that asked no defense, each offered once as a receipt to confirm.
// `isManager` is the signed-in DM, who may confirm any amount for a pawn of theirs; an owner is held to each proposal.
export function GrigliataDefensePopup({
  currentUserId, isManager = false, requests = NONE, damageRequests = NONE, activeDamageBackgroundId, onRespond, busy = false, error,
  onWatchDamage, onApplyDamage,
}) {
  if (!currentUserId || !onRespond) return null;
  const pending = requests.filter(request => request.ownerUid === currentUserId && request.status === 'waiting');
  return (
    <DefenseInbox
      key={currentUserId}
      uid={currentUserId}
      isManager={Boolean(isManager)}
      requests={pending}
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
