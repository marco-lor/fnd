import React, { useState } from 'react';

export default function BackgroundGalleryPanel({
  backgrounds,
  activeBackgroundId,
  selectedBackgroundId,
  uploadName,
  selectedFileName,
  uploadError,
  isUploading,
  activatingBackgroundId,
  deletingBackgroundId,
  clearingTokensBackgroundId,
  calibrationDraft,
  calibrationError,
  isSavingCalibration,
  onUploadNameChange,
  onUploadFileChange,
  onUploadBackground,
  onSelectBackground,
  onUseBackground,
  onClearTokensForBackground,
  onDeleteBackground,
  onCalibrationDraftChange,
  onSaveCalibration,
  onResetCalibration,
}) {
  const selectedBackground = backgrounds.find((background) => background.id === selectedBackgroundId) || null;
  const [isCalibrationExpanded, setIsCalibrationExpanded] = useState(false);

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-950/75 backdrop-blur-sm shadow-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-300">DM Gallery</h2>
      </div>

      <div className="p-4 space-y-5">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Upload Background</p>
          <div className="mt-3 space-y-3">
            <input
              type="text"
              value={uploadName}
              onChange={(event) => onUploadNameChange(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none"
              placeholder="Display name for this map"
            />

            <input
              type="file"
              accept="image/*"
              onChange={onUploadFileChange}
              className="block w-full text-sm text-slate-200 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-200 hover:file:bg-slate-700"
            />

            {selectedFileName && (
              <p className="text-xs text-slate-400 truncate">{selectedFileName}</p>
            )}

            {uploadError && (
              <div className="rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-200">
                {uploadError}
              </div>
            )}

            <button
              type="button"
              onClick={onUploadBackground}
              disabled={isUploading}
              className="w-full rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUploading ? 'Uploading...' : 'Add To Gallery'}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70">
          <div className="px-3 py-3 border-b border-slate-800">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Available Maps</p>
          </div>

          <div className="max-h-[26rem] overflow-y-auto custom-scroll divide-y divide-slate-800">
            {backgrounds.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-400">
                No backgrounds uploaded yet.
              </div>
            ) : (
              backgrounds.map((background) => {
                const isActive = background.id === activeBackgroundId;
                const isSelected = background.id === selectedBackgroundId;

                return (
                  <div
                    key={background.id}
                    className={`px-3 py-3 transition-colors ${
                      isSelected ? 'bg-slate-800/70' : 'bg-transparent'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectBackground(background.id)}
                      className="w-full text-left"
                    >
                      <div className="flex gap-3">
                        <div className="w-20 h-14 rounded-lg overflow-hidden border border-slate-700 bg-slate-950 shrink-0">
                          {background.imageUrl ? (
                            <img src={background.imageUrl} alt={background.name} className="w-full h-full object-cover" />
                          ) : null}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-slate-100 truncate">{background.name || 'Untitled Map'}</p>
                            {isActive && (
                              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                                Active
                              </span>
                            )}
                          </div>

                          <p className="mt-1 text-xs text-slate-400">
                            {background.imageWidth || '?'} x {background.imageHeight || '?'} px
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Grid {background.grid?.cellSizePx || 70}px | offset {background.grid?.offsetXPx || 0}, {background.grid?.offsetYPx || 0}
                          </p>
                        </div>
                      </div>
                    </button>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onUseBackground(background)}
                        disabled={activatingBackgroundId === background.id || deletingBackgroundId === background.id}
                        className="rounded-md border border-emerald-500/40 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {activatingBackgroundId === background.id ? 'Using...' : 'Use'}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          onSelectBackground(background.id);
                          setIsCalibrationExpanded(true);
                        }}
                        className="rounded-md border border-sky-500/40 px-3 py-1.5 text-xs font-semibold text-sky-200 transition-colors hover:bg-sky-500/10"
                      >
                        Calibrate
                      </button>

                      <button
                        type="button"
                        onClick={() => onClearTokensForBackground(background)}
                        disabled={clearingTokensBackgroundId === background.id || deletingBackgroundId === background.id}
                        className="rounded-md border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {clearingTokensBackgroundId === background.id ? 'Clearing...' : 'Clear Tokens'}
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteBackground(background)}
                        disabled={deletingBackgroundId === background.id || clearingTokensBackgroundId === background.id}
                        className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingBackgroundId === background.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <button
            type="button"
            onClick={() => setIsCalibrationExpanded((currentValue) => !currentValue)}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Calibration</p>
              <p className="mt-1 text-xs text-slate-400">
                {isCalibrationExpanded
                  ? 'Manual offsets and square-size form'
                  : 'Collapsed. Open to edit offsets manually.'}
              </p>
            </div>
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">
              {isCalibrationExpanded ? 'Hide' : 'Show'}
            </span>
          </button>

          {isCalibrationExpanded && (
            selectedBackground ? (
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-slate-100">{selectedBackground.name || 'Untitled Map'}</p>
                  <p className="text-xs text-slate-400">Grid values are stored in native image pixels.</p>
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
              <p className="mt-3 text-sm text-slate-400">
                Select a background from the gallery to edit its grid calibration.
              </p>
            )
          )}
        </div>
      </div>
    </section>
  );
}
