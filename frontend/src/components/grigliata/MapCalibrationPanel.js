import React from 'react';

export default function MapCalibrationPanel({
  selectedBackground,
  calibrationDraft,
  calibrationError,
  isSavingCalibration,
  onCalibrationDraftChange,
  onSaveCalibration,
  onResetCalibration,
}) {
  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-950/75 shadow-2xl backdrop-blur-sm overflow-hidden">
      <div className="border-b border-slate-800 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">Map Calibration</h2>
      </div>

      <div className="p-4">
        {selectedBackground ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
              <p className="text-sm font-semibold text-slate-100">{selectedBackground.name || 'Untitled Map'}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                Grid values are stored in native image pixels for this background.
              </p>
            </div>

            <label className="block">
              <span className="text-xs text-slate-300">Square Size</span>
              <input
                type="number"
                min="24"
                max="240"
                step="1"
                value={calibrationDraft.cellSizePx}
                onChange={(event) => onCalibrationDraftChange('cellSizePx', event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="text-xs text-slate-300">Offset X</span>
              <input
                type="number"
                step="1"
                value={calibrationDraft.offsetXPx}
                onChange={(event) => onCalibrationDraftChange('offsetXPx', event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="text-xs text-slate-300">Offset Y</span>
              <input
                type="number"
                step="1"
                value={calibrationDraft.offsetYPx}
                onChange={(event) => onCalibrationDraftChange('offsetYPx', event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none"
              />
            </label>

            {calibrationError && (
              <div className="rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-200">
                {calibrationError}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onResetCalibration}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-800"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={onSaveCalibration}
                disabled={isSavingCalibration}
                className="flex-1 rounded-lg bg-amber-400 px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingCalibration ? 'Saving...' : 'Save Calibration'}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-4 text-sm text-slate-400">
            Select a background from the gallery to edit its grid calibration.
          </div>
        )}
      </div>
    </section>
  );
}
