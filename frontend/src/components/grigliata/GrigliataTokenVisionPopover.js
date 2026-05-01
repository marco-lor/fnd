import React, { useEffect, useRef, useState } from 'react';
import { FiMinus, FiPlus } from 'react-icons/fi';
import {
  MAX_TOKEN_VISION_RADIUS_SQUARES,
  MIN_TOKEN_VISION_RADIUS_SQUARES,
  normalizeTokenVisionRadiusSquares,
} from './lightingVisibility';

const normalizeVisionEnabled = (visionEnabled) => visionEnabled !== false;

const areVisionSettingsEqual = (left, right) => (
  normalizeVisionEnabled(left?.visionEnabled) === normalizeVisionEnabled(right?.visionEnabled)
  && normalizeTokenVisionRadiusSquares(left?.visionRadiusSquares) === normalizeTokenVisionRadiusSquares(right?.visionRadiusSquares)
);

export default function GrigliataTokenVisionPopover({
  open,
  visionEnabled = true,
  visionRadiusSquares,
  isPending = false,
  onCommitVision,
  onRequestClose,
  withinRef,
  placementStyle,
}) {
  const popoverRef = useRef(null);
  const lastCommittedSettingsRef = useRef({
    visionEnabled: normalizeVisionEnabled(visionEnabled),
    visionRadiusSquares: normalizeTokenVisionRadiusSquares(visionRadiusSquares),
  });
  const [draftVisionEnabled, setDraftVisionEnabled] = useState(() => normalizeVisionEnabled(visionEnabled));
  const [draftRadiusSquares, setDraftRadiusSquares] = useState(() => normalizeTokenVisionRadiusSquares(visionRadiusSquares));

  const commitVision = (nextSettings) => {
    const normalizedSettings = {
      visionEnabled: normalizeVisionEnabled(nextSettings?.visionEnabled),
      visionRadiusSquares: normalizeTokenVisionRadiusSquares(nextSettings?.visionRadiusSquares),
    };

    setDraftVisionEnabled(normalizedSettings.visionEnabled);
    setDraftRadiusSquares(normalizedSettings.visionRadiusSquares);
    if (!areVisionSettingsEqual(lastCommittedSettingsRef.current, normalizedSettings)) {
      lastCommittedSettingsRef.current = normalizedSettings;
      onCommitVision?.(normalizedSettings);
    }
  };

  const handleClose = ({ commitDraft = false } = {}) => {
    if (commitDraft) {
      commitVision({
        visionEnabled: draftVisionEnabled,
        visionRadiusSquares: draftRadiusSquares,
      });
    }
    onRequestClose?.();
  };

  useEffect(() => {
    if (!open) return;

    const nextSettings = {
      visionEnabled: normalizeVisionEnabled(visionEnabled),
      visionRadiusSquares: normalizeTokenVisionRadiusSquares(visionRadiusSquares),
    };
    lastCommittedSettingsRef.current = nextSettings;
    setDraftVisionEnabled(nextSettings.visionEnabled);
    setDraftRadiusSquares(nextSettings.visionRadiusSquares);
  }, [open, visionEnabled, visionRadiusSquares]);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (withinRef?.current?.contains(event.target) || popoverRef.current?.contains(event.target)) return;
      handleClose({ commitDraft: true });
    };

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      handleClose();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [draftRadiusSquares, draftVisionEnabled, onRequestClose, open, withinRef, onCommitVision]);

  if (!open) {
    return null;
  }

  return (
    <div
      data-testid="token-vision-popover"
      ref={popoverRef}
      className="absolute z-10 flex w-full max-w-[15.5rem] flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-950/96 p-3 shadow-2xl backdrop-blur-md"
      style={placementStyle}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="border-b border-slate-800/90 pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Vision</p>
        <p className="mt-1 text-sm text-slate-300">
          Configure the selected token as a dynamic lighting vision source.
        </p>
      </div>

      <div className="mt-3 space-y-3">
        <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800/90 bg-slate-900/80 px-3 py-2 text-sm text-slate-100">
          <span>Vision enabled</span>
          <input
            type="checkbox"
            checked={draftVisionEnabled}
            disabled={isPending}
            onChange={(event) => {
              const nextEnabled = event.target.checked;
              commitVision({
                visionEnabled: nextEnabled,
                visionRadiusSquares: draftRadiusSquares,
              });
            }}
            className="h-4 w-4 accent-cyan-300"
          />
        </label>

        <div className="rounded-2xl border border-slate-800/90 bg-slate-900/80 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Radius</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              aria-label="Decrease token vision radius"
              disabled={isPending || normalizeTokenVisionRadiusSquares(draftRadiusSquares) <= MIN_TOKEN_VISION_RADIUS_SQUARES}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => commitVision({
                visionEnabled: draftVisionEnabled,
                visionRadiusSquares: normalizeTokenVisionRadiusSquares(draftRadiusSquares) - 1,
              })}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <FiMinus className="h-4 w-4" />
            </button>

            <input
              aria-label="Token vision radius in squares"
              type="number"
              min={MIN_TOKEN_VISION_RADIUS_SQUARES}
              max={MAX_TOKEN_VISION_RADIUS_SQUARES}
              step={1}
              value={draftRadiusSquares}
              disabled={isPending}
              onMouseDown={(event) => event.stopPropagation()}
              onChange={(event) => setDraftRadiusSquares(event.target.value)}
              onBlur={() => commitVision({
                visionEnabled: draftVisionEnabled,
                visionRadiusSquares: draftRadiusSquares,
              })}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                commitVision({
                  visionEnabled: draftVisionEnabled,
                  visionRadiusSquares: draftRadiusSquares,
                });
              }}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-center text-sm font-semibold text-slate-100 outline-none focus:border-cyan-300"
            />

            <button
              type="button"
              aria-label="Increase token vision radius"
              disabled={isPending || normalizeTokenVisionRadiusSquares(draftRadiusSquares) >= MAX_TOKEN_VISION_RADIUS_SQUARES}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => commitVision({
                visionEnabled: draftVisionEnabled,
                visionRadiusSquares: normalizeTokenVisionRadiusSquares(draftRadiusSquares) + 1,
              })}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <FiPlus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
