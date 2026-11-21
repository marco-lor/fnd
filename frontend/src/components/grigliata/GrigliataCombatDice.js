import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FaTimes } from 'react-icons/fa';
import { buildPlacementDocId, getGridCellPositionPx } from './boardUtils';
import './grigliataCombat.css';

const RENDERED_SIDES = new Set([4, 6, 8, 10, 12, 20, 100]);
const MAX_RENDERED_SOLIDS = 12;
const NO_ROLLS = [];
const HUE = { attack: 172, damage: 35, defense: 210 };
const playback = new WeakMap();

const validRoll = die => Number.isInteger(die?.sides) && die.sides >= 2
  && Number.isInteger(die.value) && die.value >= 1 && die.value <= die.sides;

export const combatDiceFaces = rolls => Array.isArray(rolls) ? rolls.filter(validRoll) : NO_ROLLS;
const solidCount = rolls => rolls.reduce((count, die) => count + (die.sides === 100 ? 2 : 1), 0);
const exampleFor = notation => {
  const sides = Number(notation?.match(/d(\d+)/i)?.[1]);
  return RENDERED_SIDES.has(sides) ? [{ sides, value: sides }] : NO_ROLLS;
};

export function canAnimateCombatDice(rolls) {
  return rolls.length > 0 && rolls.every(die => RENDERED_SIDES.has(die.sides))
    && solidCount(rolls) <= MAX_RENDERED_SOLIDS;
}

const preference = (query) => window.matchMedia?.(query);
const allowAnimation = (motion, data) => !motion?.matches && !data?.matches && !navigator.connection?.saveData;

export function CombatDiceCanvas({ rolls, kind, gesture, preview = false, pending = false, releasedAt }) {
  const canvas = useRef(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!canAnimateCombatDice(rolls) || typeof CanvasRenderingContext2D === 'undefined') return undefined;
    const motion = preference('(prefers-reduced-motion: reduce)');
    const data = preference('(prefers-reduced-data: reduce)');
    const connection = navigator.connection;
    const update = () => setActive(allowAnimation(motion, data));
    update();
    motion?.addEventListener?.('change', update);
    data?.addEventListener?.('change', update);
    connection?.addEventListener?.('change', update);
    return () => {
      motion?.removeEventListener?.('change', update);
      data?.removeEventListener?.('change', update);
      connection?.removeEventListener?.('change', update);
    };
  }, [rolls]);
  const canProject = active && canAnimateCombatDice(rolls);
  useEffect(() => {
    if (!canProject) return undefined;
    const surface = canvas.current;
    let live = true;
    let stop;
    import('./combatDiceCanvas').then(({ animateCombatDice }) => {
      if (!live) return;
      const now = performance.now();
      const startedAt = pending ? releasedAt : playback.get(rolls) ?? Math.max(releasedAt ?? now, now - 700);
      if (!preview && !pending) playback.set(rolls, startedAt);
      stop = animateCombatDice(surface, rolls, HUE[kind], { gesture, preview, pending, startedAt });
      if (!stop) setActive(false);
    }).catch(() => { if (live) setActive(false); });
    return () => {
      live = false;
      stop?.();
    };
  }, [canProject, rolls, kind, gesture, preview, pending, releasedAt]);
  return canProject ? <canvas className="gc-dice-canvas" data-preview={preview || undefined}
    data-pool={solidCount(rolls) > 4 ? 'large' : undefined} ref={canvas} aria-hidden="true" /> : null;
}

// A throw reads just the horizontal swipe. The native button beside it is also the keyboard and tap control.
export function CombatDiceDrag({ disabled, kind, notation, onThrow }) {
  const pointer = useRef(null);
  const preview = useMemo(() => exampleFor(notation), [notation]);
  return (
    <div className="gc-dice-drag" aria-hidden="true" data-disabled={disabled || undefined}
      onPointerDown={event => {
        if (disabled || event.isPrimary === false || event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }}
      onPointerUp={event => {
        const start = pointer.current;
        if (!start || event.pointerId !== start.id) return;
        pointer.current = null;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (!disabled && Math.abs(dx) >= 24 && Math.abs(dx) > Math.abs(dy)) {
          onThrow({ direction: Math.sign(dx), power: Math.min(1.25, 0.78 + Math.abs(dx) / 320) });
        }
      }}
      onPointerCancel={() => { pointer.current = null; }}
      onLostPointerCapture={() => { pointer.current = null; }}
    >
      {preview.length > 0 && <CombatDiceCanvas rolls={preview} kind={kind} preview />}
      Trascina per tirare
    </div>
  );
}

export function CombatDiceFaces({ rolls }) {
  return (
    <ul className="gc-dice-faces" aria-label="Risultati dei dadi" tabIndex={rolls.length > 8 ? 0 : undefined}>
      {rolls.map(({ sides, value, sign }, index) => (
        <li key={index}><span>d{sides}</span> <strong>{sign === -1 ? '−' : ''}{value}</strong></li>
      ))}
    </ul>
  );
}

const RESULT_STATUS = {
  waiting: 'In attesa di risposta',
  retry: 'Parità · rilancio nel pannello Combattimento',
  awaitingDamage: 'In attesa del tiro di danno',
};

export function CombatMapDamage({ nextDamage }) {
  return <button type="button" className="gc-secondary" disabled={nextDamage.disabled} onClick={nextDamage.prepare}>{nextDamage.label}</button>;
}

export function getCombatDiceMapPosition({ anchor, visibleTokens, grid, viewport, stageSize, large }) {
  const { width, height } = stageSize;
  const visible = new Map(visibleTokens.map(token => [buildPlacementDocId(anchor?.backgroundId, token.tokenId), token.renderPosition]));
  const target = anchor?.targetIds?.map(id => visible.get(id)).find(Boolean);
  const point = target
    ? { x: target.x + target.size / 2, y: target.y + target.size / 2 }
    : anchor?.point && getGridCellPositionPx(anchor.point, grid, 'center');
  const margin = Math.min(width, height, 24) / 2;
  const overlayWidth = Math.min(large ? 420 : 280, width - margin * 2);
  const overlayHeight = Math.min(large ? 148 : 104, height - margin * 2);
  const x = point ? point.x * viewport.scale + viewport.x + 28 : width * 0.5;
  const y = point ? point.y * viewport.scale + viewport.y - 52 : height * 0.4;
  const clamp = (value, range, size) => Math.min(range - size - margin, Math.max(margin, value - size / 2));
  return { left: clamp(x, width, overlayWidth), top: clamp(y, height, overlayHeight), width: overlayWidth, height: overlayHeight };
}

export function CombatMapDice({ tray, visibleTokens, grid, viewport, stageSize }) {
  const receipt = useMemo(() => combatDiceFaces(tray?.rolls), [tray?.rolls]);
  const example = useMemo(() => exampleFor(tray?.notation), [tray?.notation]);
  const pending = tray?.phase === 'sending';
  const rolls = pending ? example : receipt;
  if ((!pending && tray?.phase !== 'result') || !canAnimateCombatDice(rolls) || !stageSize.width || !stageSize.height) return null;
  const large = solidCount(rolls) > 4;
  const style = getCombatDiceMapPosition({ anchor: tray.anchor, visibleTokens, grid, viewport, stageSize, large });
  return <div className="gc-map-dice" aria-hidden="true" data-testid="grigliata-board-dice-projection" style={style}>
    <CombatDiceCanvas rolls={rolls} kind={tray.kind} gesture={tray.gesture} pending={pending} releasedAt={tray.releasedAt} />
  </div>;
}

export default function GrigliataCombatDiceTray({ tray, nextDamage, resultStatus, resultOutcomes = NO_ROLLS }) {
  const { id, title, notation, kind, phase, error, close, throwDice } = tray;
  const rolls = useMemo(() => combatDiceFaces(tray.rolls), [tray.rolls]);
  const headingId = useId();
  const section = useRef(null);
  const trigger = useRef(null);
  const closeButton = useRef(null);
  const sending = phase === 'sending';
  const result = phase === 'result';
  const canCloseOnly = result || phase === 'rejected';
  useLayoutEffect(() => {
    section.current?.scrollIntoView?.({ block: 'nearest' });
    trigger.current?.focus({ preventScroll: true });
  }, [id]);
  useLayoutEffect(() => {
    if (canCloseOnly && (document.activeElement === document.body || section.current?.contains(document.activeElement))) {
      closeButton.current?.focus({ preventScroll: true });
    }
  }, [canCloseOnly]);

  return (
    <section className="gc-dice-tray" aria-labelledby={headingId} ref={section} data-kind={kind}>
      <header className="gc-dice-head">
        <h3 id={headingId}>{title}</h3>
        <code>{notation}</code>
        <button type="button" className="gc-dice-close" aria-label="Chiudi il vassoio" ref={closeButton}
          aria-disabled={sending} onClick={close}><FaTimes aria-hidden="true" /></button>
      </header>
      {result ? (
        <>
          <div role="status">
            {rolls.length ? <CombatDiceFaces rolls={rolls} /> : 'Azione registrata.'}
            {Number.isFinite(tray.damage) && <p>{tray.damage} danni proposti</p>}
            {RESULT_STATUS[resultStatus] && <p>{RESULT_STATUS[resultStatus]}</p>}
            {resultOutcomes.length > 0 && <ul className="gc-dice-outcomes" aria-label="Esiti dei bersagli">
              {resultOutcomes.map(({ id, name, label }) => <li key={id}>{name} · {label}</li>)}
            </ul>}
          </div>
          {nextDamage && <CombatMapDamage nextDamage={nextDamage} />}
        </>
      ) : phase !== 'rejected' && (
        <>
          <div className="gc-dice-controls">
            <CombatDiceDrag disabled={sending} kind={kind} notation={notation} onThrow={throwDice} />
            <button type="button" className="gc-primary" ref={trigger} aria-disabled={sending}
              onClick={() => throwDice()}>{phase === 'error' ? 'Riprova il tiro' : 'Tira i dadi'}</button>
          </div>
          {sending && <p role="status">Attendi l’esito del tiro…</p>}
        </>
      )}
      {error && <p role="alert" className="gc-error">{error}</p>}
    </section>
  );
}
