import React from 'react';

const formatSummaryText = (summary) => {
  if (!summary || typeof summary !== 'object') {
    return 'No lighting metadata imported.';
  }

  const wallCount = Number.isFinite(Number(summary.wallCount)) ? Number(summary.wallCount) : 0;
  const lightCount = Number.isFinite(Number(summary.lightCount)) ? Number(summary.lightCount) : 0;
  const alignmentStatus = typeof summary.alignmentStatus === 'string' && summary.alignmentStatus
    ? summary.alignmentStatus
    : 'unknown';

  return `${wallCount} walls | ${lightCount} lights | ${alignmentStatus}`;
};

const isGridMismatch = (selectedBackground, lightingMetadataDraft) => {
  const importedGrid = lightingMetadataDraft?.grid;
  const backgroundGrid = selectedBackground?.grid;
  if (!importedGrid || !backgroundGrid) return false;

  return importedGrid.cellSizePx !== backgroundGrid.cellSizePx
    || importedGrid.offsetXPx !== backgroundGrid.offsetXPx
    || importedGrid.offsetYPx !== backgroundGrid.offsetYPx;
};

export default function GrigliataLightingImportPanel({
  selectedBackground,
  selectedFileName = '',
  importError = '',
  importWarnings = null,
  isImporting = false,
  isApplyingCalibration = false,
  isDebugOverlayVisible = true,
  hasLightingMetadata = false,
  lightingMetadataDraft = null,
  lightingMetadata = null,
  onLightingFileChange,
  onImportLightingMetadata,
  onApplyLightingCalibration,
  onToggleDebugOverlay,
}) {
  const summaryText = formatSummaryText(selectedBackground?.lightingSummary);
  const hasSelectedBackground = !!selectedBackground?.id;
  const hasSelectedFile = !!selectedFileName;
  const calibrationSource = lightingMetadataDraft || lightingMetadata;
  const hasCalibrationGrid = !!calibrationSource?.grid;
  const hasGridMismatch = isGridMismatch(selectedBackground, calibrationSource);

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-950/75 shadow-2xl backdrop-blur-sm overflow-hidden">
      <div className="border-b border-slate-800 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300">Lighting Import</h2>
      </div>

      <div className="space-y-4 p-4">
        {hasSelectedBackground ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
            <p className="text-sm font-semibold text-slate-100">{selectedBackground.name || 'Untitled Map'}</p>
            <p className="mt-1 text-xs text-slate-400">
              {selectedBackground.imageWidth || '?'} x {selectedBackground.imageHeight || '?'} px
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Current grid {selectedBackground.grid?.cellSizePx || '?'}px, offset {selectedBackground.grid?.offsetXPx || 0}, {selectedBackground.grid?.offsetYPx || 0}
            </p>
            <p className="mt-2 text-xs text-slate-400">{summaryText}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-4 text-sm text-slate-400">
            Select a background from the gallery before importing lighting metadata.
          </div>
        )}

        <label className="block">
          <span className="text-xs text-slate-300">Dungeon Alchemist JSON</span>
          <input
            type="file"
            accept=".json,application/json"
            onChange={onLightingFileChange}
            disabled={!hasSelectedBackground || isImporting}
            className="mt-2 block w-full text-sm text-slate-200 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-200 hover:file:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </label>

        {selectedFileName && (
          <p className="truncate text-xs text-slate-400">{selectedFileName}</p>
        )}

        {lightingMetadataDraft && (
          <div className="rounded-xl border border-cyan-500/25 bg-cyan-950/20 px-3 py-3 text-xs text-cyan-100">
            <p className="font-semibold">
              Parsed {lightingMetadataDraft.walls.length} walls and {lightingMetadataDraft.lights.length} lights.
            </p>
            <p className="mt-1 text-cyan-100/80">
              Imported grid {lightingMetadataDraft.grid.cellSizePx}px, offset {lightingMetadataDraft.grid.offsetXPx}, {lightingMetadataDraft.grid.offsetYPx}.
            </p>
          </div>
        )}

        {hasGridMismatch && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-900/20 px-3 py-2 text-xs text-amber-100">
            Imported grid differs from the current map calibration. The import will not change calibration automatically.
          </div>
        )}

        {importWarnings && (importWarnings.skippedWalls > 0 || importWarnings.skippedLights > 0) && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-900/20 px-3 py-2 text-xs text-amber-100">
            Skipped {importWarnings.skippedWalls || 0} malformed walls and {importWarnings.skippedLights || 0} malformed lights.
          </div>
        )}

        {importError && (
          <div className="rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-200">
            {importError}
          </div>
        )}

        <button
          type="button"
          onClick={onImportLightingMetadata}
          disabled={!hasSelectedBackground || !hasSelectedFile || isImporting}
          className="w-full rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isImporting ? 'Importing...' : 'Import Lighting Metadata'}
        </button>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onToggleDebugOverlay}
            disabled={!hasLightingMetadata}
            className="rounded-lg border border-cyan-500/40 px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDebugOverlayVisible ? 'Hide Debug Overlay' : 'Show Debug Overlay'}
          </button>
          <button
            type="button"
            onClick={onApplyLightingCalibration}
            disabled={!hasSelectedBackground || !hasCalibrationGrid || isApplyingCalibration}
            className="rounded-lg border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isApplyingCalibration ? 'Applying...' : 'Apply JSON Calibration'}
          </button>
        </div>
      </div>
    </section>
  );
}
