import React, { useEffect, useRef, useState } from 'react';
import { FiCheck, FiCrosshair, FiMapPin, FiX } from 'react-icons/fi';
import { getGridCellPositionPx, snapBoardPointToGrid } from './boardUtils';
import { combatArea, picksGround, picksMultiple, withinCombatRange } from './combatTargeting';
import { COMBAT_CONE_HINT, combatRoleStep, combatStepRange, combatStepRangeFt } from './combatPresentation';

const CELL_STEPS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export default function GrigliataCombatAim({ aim, tokens, viewport, grid, stageSize, setViewport, applyScale }) {
  const { pawn, action, selection, candidates, pickToken, pickPoint, finish, confirm = finish } = aim;
  const { picking, targetIds, point } = selection;
  const layer = useRef(null);
  const drag = useRef(null);
  const centered = useRef('');
  const cellButton = useRef(null);
  const [notice, setNotice] = useState('');
  const [keyboardCell, setKeyboardCell] = useState(null);
  const actorPosition = tokens.find(t => t.tokenId === pawn.tokenId)?.renderPosition;
  const ground = picksGround(action);
  const multi = picksMultiple(action);
  const key = picking ? pawn.placementId + '/' + action.id : '';
  const aimedCell = picking && ground ? keyboardCell || point || pawn : point;
  useEffect(() => {
    setKeyboardCell(null);
    if (key && ground) cellButton.current?.focus({preventScroll: true});
  }, [key, ground]);
  useEffect(() => {
    if (!key) { centered.current = ''; return; }
    if (centered.current === key || !actorPosition || !stageSize.width || !stageSize.height) return;
    centered.current = key;
    setNotice('');
    layer.current?.scrollIntoView?.({block:'nearest'});
    layer.current?.querySelector('summary')?.focus({preventScroll:true});
    const x = (actorPosition.x + actorPosition.size / 2) * viewport.scale;
    const y = (actorPosition.y + actorPosition.size / 2) * viewport.scale;
    if (x + viewport.x < 40 || x + viewport.x > stageSize.width - 40 ||
        y + viewport.y < 40 || y + viewport.y > stageSize.height - 40) {
      setViewport(v => ({...v, x:stageSize.width / 2 - x, y:stageSize.height / 2 - y}));
    }
  }, [key, actorPosition, viewport, stageSize, setViewport]);
  useEffect(() => {
    if (!picking) return undefined;
    const handleKey = event => { if (event.key === 'Escape') {event.preventDefault(); finish();} };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [picking, finish]);
  const confirmCell = cell => {
    if (withinCombatRange(pawn, cell, action)) pickPoint({col: cell.col, row: cell.row});
    else setNotice('Casella fuori gittata');
  };
  const selectGround = (event) => {
    if (!picking || !ground) return;
    const rect = layer.current.getBoundingClientRect();
    const cell = snapBoardPointToGrid({x:(event.clientX - rect.left - viewport.x)/viewport.scale,y:(event.clientY - rect.top - viewport.y)/viewport.scale},grid,'center');
    confirmCell(cell);
  };
  const moveCell = event => {
    const step = CELL_STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    const next = {col: aimedCell.col + step[0], row: aimedCell.row + step[1]};
    setKeyboardCell(next);
    setNotice('');
    const center = getGridCellPositionPx(next, grid, 'center');
    const x = center.x * viewport.scale;
    const y = center.y * viewport.scale;
    if (x + viewport.x < 24 || x + viewport.x > stageSize.width - 24 ||
        y + viewport.y < 24 || y + viewport.y > stageSize.height - 72) {
      setViewport(v => ({...v, x: stageSize.width / 2 - x, y: stageSize.height / 2 - y}));
    }
  };
  const ringStyle = (pos, diameter) => ({
    left:viewport.x + (pos.x + pos.size/2)*viewport.scale, top:viewport.y + (pos.y + pos.size/2)*viewport.scale,
    width:diameter, height:diameter, transform:'translate(-50%, -50%)'
  });
  const box = combatArea(action,aimedCell);
  const marker = aimedCell && getGridCellPositionPx(box || aimedCell,grid,box ? 'top-left' : 'center');
  const markerSize = box && box.sizeSquares*grid.cellSizePx*viewport.scale;
  const chosen = targetIds.length;
  const caption = combatRoleStep(action, chosen) || (ground ? 'Scegli una casella' : multi ? 'Scegli i bersagli' : 'Scegli un bersaglio');
  const rangeLabel = combatStepRange(action, chosen);
  const listTitle = combatStepRangeFt(action, chosen) == null ? 'Bersagli' : 'Bersagli in gittata';
  const fallenMissing = action.requireDead && !candidates.some(c => !targetIds.includes(c.placementId));
  return <div ref={layer} aria-label="Mira sulla mappa" className={'absolute inset-0 z-[32] overflow-hidden ' + (picking ? 'cursor-crosshair' : 'pointer-events-none')}>
    {picking && <div aria-hidden="true" className="absolute inset-0 touch-none"
      onWheel={e => {
        const bounds = layer.current.getBoundingClientRect();
        applyScale(viewport.scale * 1.08 ** (e.deltaY > 0 ? -3 : 3), {x:e.clientX - bounds.left,y:e.clientY - bounds.top});
      }}
      onPointerDown={e => {
        if (!e.isPrimary || e.button > 1) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {x:e.clientX,y:e.clientY,vx:viewport.x,vy:viewport.y,moved:false};
      }}
      onPointerMove={e => {
        if (!drag.current) return;
        const start = drag.current;
        const dx = e.clientX-start.x, dy = e.clientY-start.y;
        if (!start.moved && Math.hypot(dx,dy) < 4) return;
        start.moved = true;
        setViewport(v => ({...v,x:start.vx+dx,y:start.vy+dy}));
      }}
      onPointerUp={e => {
        if (drag.current && !drag.current.moved) selectGround(e);
        drag.current = null;
      }}
      onPointerCancel={() => { drag.current = null; }} />}
    {tokens.map(t => {
      const origin = picking && t.tokenId === pawn.tokenId;
      const candidate = candidates.find(c => c.tokenId === t.tokenId);
      const selected = candidate && targetIds.includes(candidate.placementId);
      const canPick = picking && !ground && candidate;
      if (!origin && !selected && !canPick) return null;
      const size = t.renderPosition.size*viewport.scale;
      const frame = ringStyle(t.renderPosition, Math.max(origin ? 54 : 18, size + (origin ? 12 : 6)));
      return <React.Fragment key={t.tokenId}>
        {origin && <div data-testid="combat-actor-ring" style={frame} className="pointer-events-none absolute z-[1] rounded-full border-[3px] border-teal-200 shadow-[0_0_0_2px_#102a32,0_0_13px_#38dcca]">
          <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-slate-950/95 px-1.5 text-xs font-bold text-teal-200">{pawn.name}</span>
        </div>}
        {(canPick || selected) && <button type="button" tabIndex={canPick ? 0 : -1} disabled={!canPick}
          aria-label={'Bersaglio ' + candidate.name} aria-pressed={!!selected} title={candidate.name + ' · ' + candidate.distanceFt + ' ft'}
          className={'absolute rounded-full border-2 focus-visible:outline focus-visible:outline-white ' + (selected ? 'border-amber-300 shadow-[0_0_0_2px_#18140c]' : 'border-dashed border-teal-300/85')}
          style={ringStyle(t.renderPosition,Math.max(18,size+5))} onClick={() => pickToken(candidate.placementId)} />}
      </React.Fragment>;
    })}
    {marker && <div aria-label="Area selezionata" className={'pointer-events-none absolute text-amber-300 ' + (box ? 'border-2 border-amber-300 bg-amber-300/15' : '-translate-x-1/2 -translate-y-1/2')}
      style={{left:viewport.x + marker.x*viewport.scale,top:viewport.y + marker.y*viewport.scale,width:markerSize || undefined,height:markerSize || undefined}}>
      {!box && <FiMapPin size={22}/>}
    </div>}
    {picking && <div className="absolute bottom-3 left-1/2 z-[2] w-max max-w-[96%] -translate-x-1/2 cursor-auto rounded-xl border border-teal-400/60 bg-slate-950/95 px-2.5 py-2 text-sm text-slate-100 shadow-lg">
      <div className="flex items-center justify-center gap-2"><FiCrosshair className="text-teal-200" />
        <span>{caption}{rangeLabel && ' · ' + rangeLabel}</span>
        <button type="button" onClick={multi ? confirm : finish} aria-label={multi ? 'Conferma bersagli' : 'Chiudi mirino'} className="rounded p-1 hover:bg-slate-700">{multi ? <FiCheck/> : <FiX/>}</button>
      </div>
      {ground && <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-xs">
        <button type="button" ref={cellButton} onKeyDown={moveCell} onClick={() => confirmCell(aimedCell)}
          className="rounded border border-teal-400 px-2 py-1 focus-visible:outline focus-visible:outline-white">
          Scegli casella <span aria-live="polite">({aimedCell.col}, {aimedCell.row})</span>
        </button>
        <span>Frecce per spostarti</span>
      </div>}
      {ground && notice && <p role="status" className="text-xs text-amber-300">{notice}</p>}
      {action.area?.shape === 'cone' && <p className="mt-1 max-w-xs text-xs text-slate-300">{COMBAT_CONE_HINT}</p>}
      {fallenMissing && <p className="mt-1 max-w-xs text-xs text-amber-300">Nessuna pedina caduta da scegliere: il master deve prima segnarla come caduta sulla mappa.</p>}
      {!ground && <details className="mt-1 text-xs"><summary className="cursor-pointer text-teal-200">{listTitle} · {candidates.length}</summary>
        <div className="max-h-32 overflow-auto">{candidates.map(t => <button type="button" key={t.placementId} onClick={() => pickToken(t.placementId)}
          className="flex w-full justify-between gap-3 rounded px-2 py-1 text-left hover:bg-slate-800" aria-pressed={targetIds.includes(t.placementId)}>
          <span>{targetIds.includes(t.placementId) && '✓ '}{t.name}</span><span>{t.distanceFt} ft</span></button>)}</div>
      </details>}
    </div>}
  </div>;
}
