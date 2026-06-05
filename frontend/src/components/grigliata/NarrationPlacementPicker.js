import React, { useMemo } from 'react';
import { FiArrowDown, FiArrowLeft, FiArrowRight, FiArrowUp, FiMove, FiX } from 'react-icons/fi';
import {
  buildBackgroundMap,
  buildNarrationPlacementBounds,
  NARRATION_PLACEMENT_MODE_FREE,
  NARRATION_PLACEMENT_MODE_MAGNETIC,
  NARRATION_PLACEMENT_SIDE_BOTTOM,
  NARRATION_PLACEMENT_SIDE_LEFT,
  NARRATION_PLACEMENT_SIDE_RIGHT,
  NARRATION_PLACEMENT_SIDE_TOP,
} from './narrationScene';

const PREVIEW_SIZE_PX = 168;
const PREVIEW_PADDING_PX = 14;
const PLACEMENT_BUTTON_CLASS = 'inline-flex h-10 w-10 items-center justify-center rounded-md border border-amber-500/40 bg-slate-950/90 text-amber-200 transition-colors hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-60';
const PLACEMENT_ICON_CLASS = 'h-4 w-4';

const getPreviewStyle = (placement, bounds) => {
  if (!placement || !bounds?.width || !bounds?.height) {
    return {};
  }

  const availableSize = PREVIEW_SIZE_PX - (PREVIEW_PADDING_PX * 2);
  const scale = Math.min(availableSize / bounds.width, availableSize / bounds.height);
  return {
    left: PREVIEW_PADDING_PX + ((placement.x - bounds.minX) * scale),
    top: PREVIEW_PADDING_PX + ((placement.y - bounds.minY) * scale),
    width: Math.max(8, placement.width * scale),
    height: Math.max(8, placement.height * scale),
  };
};

export default function NarrationPlacementPicker({
  isOpen,
  background,
  backgrounds = [],
  placements = [],
  isPending = false,
  onClose,
  onSelectPlacement,
}) {
  const backgroundName = background?.name || 'Untitled Map';
  const backgroundsById = useMemo(() => buildBackgroundMap(backgrounds), [backgrounds]);
  const previewBounds = useMemo(() => buildNarrationPlacementBounds(placements), [placements]);

  if (!isOpen || !background) {
    return null;
  }

  const handleSelectSide = (side) => {
    onSelectPlacement?.({
      mode: NARRATION_PLACEMENT_MODE_MAGNETIC,
      side,
    });
  };

  const handleSelectFree = () => {
    onSelectPlacement?.({
      mode: NARRATION_PLACEMENT_MODE_FREE,
      side: '',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/72 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-xs overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl shadow-black/70">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-100">{backgroundName}</p>
            <p className="text-[11px] uppercase tracking-[0.18em] text-amber-300">Multi Narration</p>
          </div>
          <button
            type="button"
            aria-label="Close multi narration placement"
            title="Close"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-700 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <FiX className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] grid-rows-[2.5rem_minmax(0,1fr)_2.5rem] gap-2 p-4">
          <div className="col-start-2 row-start-1 flex items-center justify-center">
            <button
              type="button"
              aria-label={`Attach ${backgroundName} above narration group`}
              title={`Attach ${backgroundName} above narration group`}
              disabled={isPending}
              onClick={() => handleSelectSide(NARRATION_PLACEMENT_SIDE_TOP)}
              className={PLACEMENT_BUTTON_CLASS}
            >
              <FiArrowUp className={PLACEMENT_ICON_CLASS} aria-hidden="true" />
            </button>
          </div>

          <div className="col-start-1 row-start-2 flex items-center justify-center">
            <button
              type="button"
              aria-label={`Attach ${backgroundName} left of narration group`}
              title={`Attach ${backgroundName} left of narration group`}
              disabled={isPending}
              onClick={() => handleSelectSide(NARRATION_PLACEMENT_SIDE_LEFT)}
              className={PLACEMENT_BUTTON_CLASS}
            >
              <FiArrowLeft className={PLACEMENT_ICON_CLASS} aria-hidden="true" />
            </button>
          </div>

          <div className="relative col-start-2 row-start-2 mx-auto h-[168px] w-[168px] overflow-hidden rounded-xl border border-slate-700 bg-slate-900/80 shadow-inner shadow-black/30">
            {placements.map((placement) => {
              const placementBackground = backgroundsById.get(placement.backgroundId) || null;
              const previewStyle = getPreviewStyle(placement, previewBounds);

              return (
                <div
                  key={placement.id}
                  className="absolute overflow-hidden rounded border border-sky-300/50 bg-sky-500/15"
                  style={previewStyle}
                >
                  {placementBackground?.imageUrl && (
                    <img
                      src={placementBackground.imageUrl}
                      alt=""
                      className="h-full w-full object-cover opacity-80"
                    />
                  )}
                </div>
              );
            })}
            <div className="absolute bottom-2 right-2 h-10 w-10 overflow-hidden rounded-md border border-amber-300/70 bg-amber-500/20 shadow-lg shadow-black/40">
              {background.imageUrl ? (
                <img src={background.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : null}
            </div>
          </div>

          <div className="col-start-3 row-start-2 flex items-center justify-center">
            <button
              type="button"
              aria-label={`Attach ${backgroundName} right of narration group`}
              title={`Attach ${backgroundName} right of narration group`}
              disabled={isPending}
              onClick={() => handleSelectSide(NARRATION_PLACEMENT_SIDE_RIGHT)}
              className={PLACEMENT_BUTTON_CLASS}
            >
              <FiArrowRight className={PLACEMENT_ICON_CLASS} aria-hidden="true" />
            </button>
          </div>

          <div className="col-start-2 row-start-3 flex items-center justify-center gap-2">
            <button
              type="button"
              aria-label={`Attach ${backgroundName} below narration group`}
              title={`Attach ${backgroundName} below narration group`}
              disabled={isPending}
              onClick={() => handleSelectSide(NARRATION_PLACEMENT_SIDE_BOTTOM)}
              className={PLACEMENT_BUTTON_CLASS}
            >
              <FiArrowDown className={PLACEMENT_ICON_CLASS} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`Place ${backgroundName} freely`}
              title={`Place ${backgroundName} freely`}
              disabled={isPending}
              onClick={handleSelectFree}
              className={PLACEMENT_BUTTON_CLASS}
            >
              <FiMove className={PLACEMENT_ICON_CLASS} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}