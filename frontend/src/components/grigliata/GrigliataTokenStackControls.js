import React, { useEffect, useId, useRef, useState } from 'react';
import { getGridCellPositionPx } from './boardUtils';

const PICKER_WIDTH_PX = 208;
const PICKER_ROW_HEIGHT_PX = 36;
const PICKER_CHROME_HEIGHT_PX = 44;
const EDGE_GAP_PX = 8;
const BADGE_MAX_PX = 24;
const BADGE_COMFORT_PX = 16;
// Below this the ×N text no longer fits inside the hit area: the badge becomes a
// dot and the count moves to a non-intercepting label shown on hover/focus/open.
const BADGE_TEXT_MIN_PX = 16;
// Pixels kept free between the hit area and the cell center (and fog anchor).
const POINT_CLEARANCE_PX = 1;

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
const getTokenName = (token) => token?.label || token?.characterId || 'Pedina';

// The clickable badge is a square tucked into one corner of the stack's own
// cell and sized with the zoom: it never reaches the cell center, the fog
// anchor or any neighboring cell, so normal token drags keep working there.
// The corner follows the anchor's quadrant (the visible side under fog) and
// flips when the preferred corner falls outside the stage.
const getTokenStackBadgeLayout = ({ stack, grid, viewport, stageSize }) => {
  const scale = viewport.scale;
  const cellWorld = getGridCellPositionPx({ col: stack.col, row: stack.row }, grid);
  const size = cellWorld.size * scale;
  const cell = { left: viewport.x + (cellWorld.x * scale), top: viewport.y + (cellWorld.y * scale), size };
  const center = { x: cell.left + (size / 2), y: cell.top + (size / 2) };
  const anchor = { x: viewport.x + (stack.anchor.x * scale), y: viewport.y + (stack.anchor.y * scale) };
  const clearance = Math.min(POINT_CLEARANCE_PX, size * 0.1);
  const baseSize = Math.min(
    BADGE_MAX_PX,
    Math.max(BADGE_COMFORT_PX, Math.round(size * 0.3)),
    (size / 2) - clearance
  );

  const preferRight = anchor.x >= center.x - 0.5;
  const preferTop = anchor.y <= center.y + 0.5;
  const candidates = [
    [preferRight, preferTop], [!preferRight, preferTop], [preferRight, !preferTop], [!preferRight, !preferTop],
  ].map(([right, top]) => {
    const cornerX = right ? cell.left + size : cell.left;
    const cornerY = top ? cell.top : cell.top + size;
    // A square from the corner excludes a point when the point is farther than
    // its side along at least one axis.
    const anchorLimit = Math.max(Math.abs(anchor.x - cornerX), Math.abs(anchor.y - cornerY)) - clearance;
    const badgeSize = Math.min(baseSize, anchorLimit);
    const left = right ? cornerX - badgeSize : cornerX;
    const boxTop = top ? cornerY : cornerY - badgeSize;
    return {
      right,
      top,
      left,
      boxTop,
      badgeSize,
      onStage: left >= 0 && boxTop >= 0
        && left + badgeSize <= stageSize.width && boxTop + badgeSize <= stageSize.height,
      overlapsStage: left + badgeSize > 0 && boxTop + badgeSize > 0
        && left < stageSize.width && boxTop < stageSize.height,
    };
  }).filter((candidate) => candidate.badgeSize > 0);

  const onStage = candidates.filter((candidate) => candidate.onStage);
  const chosen = onStage.find((candidate) => candidate.badgeSize === baseSize)
    || onStage.reduce((best, candidate) => (!best || candidate.badgeSize > best.badgeSize ? candidate : best), null)
    || candidates.find((candidate) => candidate.overlapsStage);
  if (!chosen) return null;

  return {
    cell,
    left: chosen.left,
    top: chosen.boxTop,
    size: chosen.badgeSize,
    isRight: chosen.right,
    isTop: chosen.top,
    isCompact: chosen.badgeSize < BADGE_TEXT_MIN_PX,
  };
};

// DOM badges (×N) for cells where several locally visible tokens overlap, plus
// a picker that lets the viewer choose which one the next drag from that stack
// moves. The board owns the choice; this component only owns which picker is open.
export default function GrigliataTokenStackControls({
  stacks,
  tokensById,
  viewport,
  stageSize,
  grid,
  choice,
  onChoose,
  onChosenBadgeMouseDown,
}) {
  const pickerId = useId();
  const [openKey, setOpenKey] = useState('');
  const pickerRef = useRef(null);
  const triggerRefs = useRef(new Map());
  const openStack = stacks.find((stack) => stack.badgeCellKey === openKey) || null;

  useEffect(() => {
    if (openKey && !openStack) setOpenKey('');
  }, [openKey, openStack]);

  useEffect(() => {
    if (!openKey) return undefined;

    pickerRef.current?.querySelector('button:not(:disabled)')?.focus();
    const handlePointerDown = (event) => {
      if (pickerRef.current?.contains(event.target)) return;
      if (triggerRefs.current.get(openKey)?.contains(event.target)) return;
      setOpenKey('');
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [openKey]);

  const closePicker = () => {
    triggerRefs.current.get(openKey)?.focus();
    setOpenKey('');
  };

  const handleKeyDown = (event) => {
    if (event.key !== 'Escape' || !openKey) return;
    event.preventDefault();
    event.stopPropagation();
    closePicker();
  };

  const getLayout = (stack) => getTokenStackBadgeLayout({ stack, grid, viewport, stageSize });

  // Turn entries receive clicks over closed badges. Collapsing the drawer exposes a covered badge.
  // The wrapper has no stacking context so an open picker can receive clicks above the turn entries.
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" onKeyDown={handleKeyDown}>
      {stacks.map((stack) => {
        const layout = getLayout(stack);
        if (!layout) return null;

        const isOpen = stack.badgeCellKey === openKey;
        const isChosenStack = choice?.badgeCellKey === stack.badgeCellKey;
        const count = `×${stack.tokenIds.length}`;
        const names = stack.tokenIds.map((tokenId) => getTokenName(tokensById.get(tokenId))).join(', ');
        return (
          <button
            key={stack.badgeCellKey}
            ref={(node) => {
              if (node) triggerRefs.current.set(stack.badgeCellKey, node);
              else triggerRefs.current.delete(stack.badgeCellKey);
            }}
            type="button"
            data-testid={`token-stack-badge-${stack.badgeCellKey}`}
            data-compact={layout.isCompact ? 'true' : 'false'}
            aria-label={`${stack.tokenIds.length} pedine sovrapposte: ${names}. Scegli quale trascinare`}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            aria-controls={isOpen ? pickerId : undefined}
            onMouseDown={isChosenStack ? (event) => onChosenBadgeMouseDown?.(event.nativeEvent) : undefined}
            onClick={() => setOpenKey(isOpen ? '' : stack.badgeCellKey)}
            className={`group pointer-events-auto absolute z-[19] flex items-center justify-center rounded-full border font-bold leading-none text-slate-50 shadow-sm shadow-black/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
              isChosenStack ? 'border-amber-300' : 'border-slate-100/90'
            } ${
              layout.isCompact ? 'bg-amber-400 hover:bg-amber-200' : 'bg-slate-950/90 text-[11px] hover:bg-slate-800'
            }`}
            style={{
              left: layout.left,
              top: layout.top,
              width: layout.size,
              height: layout.size,
              borderWidth: layout.size < 6 ? 0 : undefined,
            }}
          >
            {layout.isCompact ? (
              // Painted outside the cell but never hit-tested: pointer events
              // over it fall through to the board and the neighboring tokens.
              <span
                aria-hidden="true"
                data-testid={`token-stack-label-${stack.badgeCellKey}`}
                className={`pointer-events-none absolute flex h-5 min-w-[20px] items-center justify-center whitespace-nowrap rounded-full border border-slate-100/90 bg-slate-950/90 px-1 text-[11px] font-bold leading-none text-slate-50 shadow-md shadow-black/50 ${
                  isOpen ? 'visible' : 'invisible group-hover:visible group-focus-visible:visible'
                }`}
                style={{
                  ...(layout.isRight ? { left: '100%' } : { right: '100%' }),
                  ...(layout.isTop ? { bottom: '100%' } : { top: '100%' }),
                }}
              >
                {count}
              </span>
            ) : (
              <span aria-hidden="true">{count}</span>
            )}
          </button>
        );
      })}

      {openStack && (() => {
        const layout = getLayout(openStack);
        if (!layout) return null;
        const { cell } = layout;
        const pickerHeight = PICKER_CHROME_HEIGHT_PX + (openStack.tokenIds.length * PICKER_ROW_HEIGHT_PX);
        return (
          <div
            ref={pickerRef}
            id={pickerId}
            role="dialog"
            aria-label="Pedine sovrapposte"
            data-testid="token-stack-picker"
            className="pointer-events-auto absolute z-[31] max-h-72 overflow-y-auto rounded-xl border border-slate-700/90 bg-slate-950/96 p-1.5 text-xs text-slate-100 shadow-lg shadow-black/45 backdrop-blur-sm"
            style={{
              width: PICKER_WIDTH_PX,
              left: clamp(
                layout.isRight ? cell.left + cell.size + EDGE_GAP_PX : cell.left - EDGE_GAP_PX - PICKER_WIDTH_PX,
                EDGE_GAP_PX,
                stageSize.width - PICKER_WIDTH_PX - EDGE_GAP_PX
              ),
              top: clamp(cell.top, EDGE_GAP_PX, stageSize.height - pickerHeight - EDGE_GAP_PX),
            }}
          >
            <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Trascina dalla pila
            </p>
            <ul className="flex flex-col gap-0.5">
              {openStack.tokenIds.map((tokenId, index) => {
                const token = tokensById.get(tokenId);
                const canMove = !!token?.canMove;
                const isChosen = choice?.badgeCellKey === openStack.badgeCellKey && choice.tokenId === tokenId;
                return (
                  <li key={tokenId}>
                    <button
                      type="button"
                      disabled={!canMove}
                      aria-pressed={isChosen}
                      data-testid={`token-stack-option-${tokenId}`}
                      onClick={() => {
                        onChoose(openStack, tokenId);
                        closePicker();
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-50 ${
                        isChosen ? 'bg-amber-500/20 text-amber-100' : 'hover:bg-slate-800'
                      }`}
                    >
                      <span className="truncate">{getTokenName(token)}</span>
                      <span className="shrink-0 text-[10px] font-medium text-slate-400">
                        {!canMove ? 'Non tua' : index === 0 ? 'In cima' : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })()}
    </div>
  );
}
