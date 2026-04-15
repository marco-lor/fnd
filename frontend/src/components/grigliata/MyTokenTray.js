import React from 'react';
import { TRAY_DRAG_MIME } from './constants';

export default function MyTokenTray({
  currentUserToken,
  activeMapName,
  isMusicMuted = false,
  isMusicMutePending = false,
  onToggleMusicMuted,
  onDragStart,
  onDragEnd,
}) {
  const imageUrl = currentUserToken?.imageUrl || '';
  const ownerUid = currentUserToken?.ownerUid || '';
  const isHiddenByManager = currentUserToken?.isHiddenByManager === true;
  const canDrag = !!(imageUrl && ownerUid && !isHiddenByManager);

  const handleDragStart = (event) => {
    if (!canDrag) {
      event.preventDefault();
      return;
    }

    const payload = JSON.stringify({
      type: 'grigliata-token',
      uid: ownerUid,
    });

    event.dataTransfer.setData(TRAY_DRAG_MIME, payload);
    event.dataTransfer.setData('text/plain', payload);
    event.dataTransfer.effectAllowed = 'copyMove';
    onDragStart?.();
  };

  const statusLabel = activeMapName
    ? (
      isHiddenByManager
        ? `Hidden on ${activeMapName} by the DM`
        : currentUserToken?.placed
        ? `On ${activeMapName} at ${currentUserToken.col}, ${currentUserToken.row}`
        : `Not placed on ${activeMapName} yet`
    )
    : 'Select a map to place your token';

  return (
    <section className="rounded-2xl border border-slate-700 bg-slate-950/75 backdrop-blur-sm shadow-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">My Token</h2>
      </div>

      <div className="p-4 space-y-4">
        <div
          draggable={canDrag}
          onDragStart={handleDragStart}
          onDragEnd={onDragEnd}
          className={`rounded-2xl border px-4 py-4 transition-colors ${
            isHiddenByManager
              ? 'border-rose-500/45 bg-rose-950/20 cursor-not-allowed'
              : canDrag
              ? 'border-amber-400/50 bg-slate-900/85 cursor-grab active:cursor-grabbing hover:border-amber-300'
              : 'border-slate-700 bg-slate-900/60 cursor-not-allowed opacity-75'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-slate-300/70 bg-slate-800 shrink-0">
              {imageUrl ? (
                <img src={imageUrl} alt={currentUserToken?.label || 'My token'} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-400 px-2 text-center">
                  No Img
                </div>
              )}
            </div>

            <div className="min-w-0">
              <p className="text-base font-semibold text-slate-100 truncate">
                {currentUserToken?.label || 'Player'}
              </p>
              <p className={`text-xs truncate ${isHiddenByManager ? 'text-rose-200' : 'text-slate-400'}`}>
                {statusLabel}
              </p>
            </div>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-slate-300">
            {isHiddenByManager
              ? 'The DM is currently hiding or controlling your token on this map. You will be able to drag it again once it is shown.'
              : !canDrag
              ? 'Upload a profile image from the navbar first. Without it, your token tray stays disabled.'
              : activeMapName
                ? 'Drag this portrait onto the active map to place or reposition your round token.'
                : 'Select a map first. Token positions are saved independently for each map.'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Music</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-300">
                {isMusicMuted
                  ? 'Shared Grigliata music is muted only for you on this device.'
                  : 'Shared Grigliata music will play here whenever the DM starts a track.'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onToggleMusicMuted?.()}
              disabled={isMusicMutePending}
              aria-busy={isMusicMutePending ? true : undefined}
              className="shrink-0 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-sky-100 transition-colors hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isMusicMuted ? 'Unmute Music' : 'Mute Music'}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Token Rules</p>
          <p className="mt-2 text-xs leading-relaxed text-slate-300">
            Your token always uses your shared public token snapshot, not a live read of another user profile.
          </p>
        </div>
      </div>
    </section>
  );
}
