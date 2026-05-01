import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FiEye, FiEyeOff, FiMaximize, FiMinus, FiPlus, FiSun } from 'react-icons/fi';
import { GiAura, GiDeathSkull } from 'react-icons/gi';
import { normalizeTokenSizeSquares } from './boardUtils';
import GrigliataTokenVisionPopover from './GrigliataTokenVisionPopover';
import {
  GRIGLIATA_TOKEN_STATUSES,
  GRIGLIATA_TOKEN_STATUS_GROUPS,
  getTokenStatusDefinition,
  normalizeTokenStatuses,
  toggleTokenStatus,
} from './tokenStatuses';

export function TokenStatusPopover({
  open,
  activeStatuses,
  isPending = false,
  onToggleStatus,
  onClearAll,
  onRequestClose,
  withinRef,
  placementStyle,
}) {
  const popoverRef = useRef(null);
  const activeStatusSet = useMemo(
    () => new Set(normalizeTokenStatuses(activeStatuses)),
    [activeStatuses]
  );
  const activeStatusCount = activeStatusSet.size;

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (withinRef?.current?.contains(event.target) || popoverRef.current?.contains(event.target)) return;
      onRequestClose?.();
    };

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onRequestClose?.();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onRequestClose, open, withinRef]);

  if (!open) {
    return null;
  }

  return (
    <div
      data-testid="token-status-popover"
      ref={popoverRef}
      className="absolute z-10 flex flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-950/96 p-3 shadow-2xl backdrop-blur-md"
      style={placementStyle}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-800/90 pb-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Statuses</p>
          <p className="mt-1 text-sm text-slate-300">
            Toggle any badge. New statuses are added to the front of the token stack.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300">
            {activeStatusCount} active
          </div>
          <button
            type="button"
            disabled={isPending || activeStatusCount < 1}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => onClearAll?.()}
            className="rounded-full border border-rose-400/45 bg-rose-500/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-100 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900/70 disabled:text-slate-500"
          >
            Clear All
          </button>
        </div>
      </div>

      <div className="mt-3 min-h-0 space-y-3 overflow-y-auto pr-1">
        {GRIGLIATA_TOKEN_STATUS_GROUPS.map((group) => {
          const groupStatuses = GRIGLIATA_TOKEN_STATUSES.filter((status) => status.group === group.id);

          return (
            <section key={group.id}>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {group.label}
                </span>
                <span className="h-px flex-1 bg-slate-800" />
              </div>

              <div className="grid grid-cols-4 gap-2">
                {groupStatuses.map((status) => {
                  const StatusIcon = status.icon;
                  const isActive = activeStatusSet.has(status.id);

                  return (
                    <button
                      key={status.id}
                      type="button"
                      aria-label={status.label}
                      aria-pressed={isActive}
                      data-active={isActive ? 'true' : 'false'}
                      disabled={isPending}
                      title={status.label}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={() => onToggleStatus?.(status.id)}
                      className="group relative flex flex-col items-center gap-1 rounded-2xl border px-2 py-2 text-center transition-transform duration-150 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55"
                      style={{
                        borderColor: isActive ? status.accentColor : 'rgba(51, 65, 85, 0.9)',
                        background: isActive
                          ? `linear-gradient(180deg, ${status.badgeFill} 0%, rgba(15, 23, 42, 0.96) 100%)`
                          : 'rgba(15, 23, 42, 0.88)',
                        boxShadow: isActive
                          ? `0 0 0 1px ${status.accentColor}, inset 0 0 0 1px rgba(255,255,255,0.08), 0 10px 22px rgba(2, 6, 23, 0.48)`
                          : 'inset 0 0 0 1px rgba(255,255,255,0.04)',
                      }}
                    >
                      {isActive && (
                        <span
                          data-testid={`status-active-${status.id}`}
                          className="absolute right-1.5 top-1.5 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em]"
                          style={{
                            borderColor: status.accentColor,
                            background: 'rgba(2, 6, 23, 0.88)',
                            color: '#f8fafc',
                          }}
                        >
                          Active
                        </span>
                      )}
                      <span
                        aria-hidden="true"
                        className="flex h-10 w-10 items-center justify-center rounded-full border"
                        style={{
                          borderColor: isActive ? status.accentColor : 'rgba(71, 85, 105, 0.8)',
                          background: isActive ? status.badgeFill : 'rgba(2, 6, 23, 0.78)',
                          color: isActive ? '#ffffff' : '#cbd5e1',
                          boxShadow: isActive ? `0 0 0 2px rgba(255,255,255,0.06), 0 0 18px ${status.accentColor}` : 'none',
                        }}
                      >
                        <StatusIcon className="h-[55%] w-[55%]" />
                      </span>
                      <span
                        className="text-[11px] font-medium leading-tight"
                        style={{
                          color: isActive ? '#f8fafc' : '#cbd5e1',
                          textShadow: isActive ? '0 0 10px rgba(255,255,255,0.12)' : 'none',
                        }}
                      >
                        {status.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function TokenSizePopover({
  open,
  sizeSquares = 1,
  isPending = false,
  onCommitSize,
  onRequestClose,
  withinRef,
  placementStyle,
}) {
  const popoverRef = useRef(null);
  const lastCommittedSizeRef = useRef(normalizeTokenSizeSquares(sizeSquares));
  const [draftSizeSquares, setDraftSizeSquares] = useState(() => normalizeTokenSizeSquares(sizeSquares));
  const normalizedDraftSize = normalizeTokenSizeSquares(draftSizeSquares);
  const presetSizes = [1, 2, 3, 4];

  const commitSize = (nextSizeSquares) => {
    const normalizedSizeSquares = normalizeTokenSizeSquares(nextSizeSquares);
    setDraftSizeSquares(normalizedSizeSquares);
    if (lastCommittedSizeRef.current !== normalizedSizeSquares) {
      lastCommittedSizeRef.current = normalizedSizeSquares;
      onCommitSize?.(normalizedSizeSquares);
    }
    return normalizedSizeSquares;
  };

  const handleClose = ({ commitDraft = false } = {}) => {
    if (commitDraft) {
      commitSize(draftSizeSquares);
    }
    onRequestClose?.();
  };

  useEffect(() => {
    if (!open) return;
    const normalizedSizeSquares = normalizeTokenSizeSquares(sizeSquares);
    lastCommittedSizeRef.current = normalizedSizeSquares;
    setDraftSizeSquares(normalizedSizeSquares);
  }, [open, sizeSquares]);

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
  }, [draftSizeSquares, onRequestClose, open, withinRef, onCommitSize]);

  if (!open) {
    return null;
  }

  return (
    <div
      data-testid="token-size-popover"
      ref={popoverRef}
      className="absolute z-10 flex w-full max-w-[15.5rem] flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-950/96 p-3 shadow-2xl backdrop-blur-md"
      style={placementStyle}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="border-b border-slate-800/90 pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Footprint</p>
        <p className="mt-1 text-sm text-slate-300">
          Keep `1x1` for normal tokens. Resize only when this piece should cover more squares.
        </p>
      </div>

      <div className="mt-3 min-h-0 space-y-3 overflow-y-auto pr-1" data-testid="token-size-popover-body">
        <div className="grid grid-cols-4 gap-2">
          {presetSizes.map((presetSize) => {
            const isActive = normalizedDraftSize === presetSize;

            return (
              <button
                key={presetSize}
                type="button"
                aria-label={`Set token size to ${presetSize} by ${presetSize}`}
                disabled={isPending}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => commitSize(presetSize)}
                className={`rounded-xl border px-2 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                  isActive
                    ? 'border-amber-300/70 bg-amber-500/25 text-amber-50'
                    : 'border-slate-700 bg-slate-900/85 text-slate-200 hover:border-slate-500 hover:bg-slate-800'
                }`}
              >
                {presetSize}x{presetSize}
              </button>
            );
          })}
        </div>

        <div className="rounded-2xl border border-slate-800/90 bg-slate-900/80 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Custom Size</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              aria-label="Decrease token size"
              disabled={isPending || normalizedDraftSize <= 1}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => commitSize(normalizedDraftSize - 1)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <FiMinus className="h-4 w-4" />
            </button>

            <input
              aria-label="Token size in squares"
              type="number"
              min={1}
              max={9}
              step={1}
              value={draftSizeSquares}
              disabled={isPending}
              onMouseDown={(event) => event.stopPropagation()}
              onChange={(event) => setDraftSizeSquares(event.target.value)}
              onBlur={() => commitSize(draftSizeSquares)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                commitSize(draftSizeSquares);
              }}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-center text-sm font-semibold text-slate-100 outline-none focus:border-amber-300"
            />

            <button
              type="button"
              aria-label="Increase token size"
              disabled={isPending || normalizedDraftSize >= 9}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => commitSize(normalizedDraftSize + 1)}
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

export function TokenStatusSummaryCard({
  statuses,
  className = '',
  onMouseEnter,
  onMouseLeave,
  style,
}) {
  const normalizedStatuses = normalizeTokenStatuses(statuses)
    .map((statusId) => getTokenStatusDefinition(statusId))
    .filter(Boolean);

  if (!normalizedStatuses.length) {
    return null;
  }

  return (
    <div
      className={`rounded-2xl border border-slate-700/80 bg-slate-950/94 p-3 shadow-2xl backdrop-blur-md ${className}`.trim()}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="border-b border-slate-800/90 pb-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Token Statuses</p>
        <p className="mt-1 text-sm text-slate-300">
          {normalizedStatuses.length} active {normalizedStatuses.length === 1 ? 'status' : 'statuses'}
        </p>
      </div>

      <div className="mt-3 space-y-2">
        {normalizedStatuses.map((status) => {
          const StatusIcon = status.icon;

          return (
            <div
              key={status.id}
              className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/75 px-2.5 py-2"
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-full border"
                style={{
                  borderColor: status.badgeStroke,
                  background: status.badgeFill,
                  color: '#f8fafc',
                }}
              >
                <StatusIcon className="h-[55%] w-[55%]" />
              </span>
              <span className="text-sm font-medium text-slate-100">{status.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function GrigliataTokenActions({
  actionState,
  viewportSize,
  isTokenVisibilityActionPending = false,
  isTokenDeadActionPending = false,
  isTokenStatusActionPending = false,
  isTokenSizeActionPending = false,
  isTokenVisionActionPending = false,
  onSetSelectedTokensVisibility,
  onSetSelectedTokensDeadState,
  onUpdateTokenStatuses,
  onSetSelectedTokenSize,
  onSetSelectedTokenVision,
}) {
  const [isStatusPopoverOpen, setIsStatusPopoverOpen] = useState(false);
  const [isSizePopoverOpen, setIsSizePopoverOpen] = useState(false);
  const [isVisionPopoverOpen, setIsVisionPopoverOpen] = useState(false);
  const statusControlRef = useRef(null);
  const statusTokenId = actionState?.statusToken?.tokenId || '';
  const sizeTokenId = actionState?.sizeToken?.tokenId || '';
  const visionTokenId = actionState?.visionToken?.tokenId || '';
  const hasStatusToken = !!actionState?.statusToken;
  const hasSizeToken = !!actionState?.sizeToken;
  const hasVisionToken = !!actionState?.visionToken;
  const statusPopoverPlacement = useMemo(() => {
    if (!actionState || !viewportSize?.width || !viewportSize?.height) {
      return null;
    }

    const edgePadding = 12;
    const gap = 10;
    const toolbarWidth = actionState.toolbarWidth || 0;
    const toolbarHeight = actionState.toolbarHeight || (actionState.buttonSize + 16);
    const popoverWidth = Math.min(416, Math.max(260, viewportSize.width - (edgePadding * 2)));
    const absoluteLeft = Math.min(
      Math.max(actionState.toolbarPosition.left + toolbarWidth - popoverWidth, edgePadding),
      Math.max(edgePadding, viewportSize.width - popoverWidth - edgePadding)
    );
    const availableBelow = Math.max(
      0,
      viewportSize.height - actionState.toolbarPosition.top - toolbarHeight - gap - edgePadding
    );
    const availableAbove = Math.max(
      0,
      actionState.toolbarPosition.top - gap - edgePadding
    );
    const shouldOpenUpwards = availableBelow < 320 && availableAbove > availableBelow;
    const popoverMaxHeight = Math.max(
      0,
      Math.min(shouldOpenUpwards ? availableAbove : availableBelow, viewportSize.height - (edgePadding * 2))
    );

    return {
      left: `${absoluteLeft - actionState.toolbarPosition.left}px`,
      width: `${popoverWidth}px`,
      maxHeight: `${popoverMaxHeight}px`,
      ...(shouldOpenUpwards
        ? { bottom: `${toolbarHeight + gap}px` }
        : { top: `${toolbarHeight + gap}px` }),
    };
  }, [actionState, viewportSize]);
  const sizePopoverPlacement = useMemo(() => {
    if (!actionState || !viewportSize?.width || !viewportSize?.height) {
      return null;
    }

    const edgePadding = 12;
    const gap = 10;
    const toolbarWidth = actionState.toolbarWidth || 0;
    const toolbarHeight = actionState.toolbarHeight || (actionState.buttonSize + 16);
    const popoverWidth = Math.min(248, Math.max(220, viewportSize.width - (edgePadding * 2)));
    const absoluteLeft = Math.min(
      Math.max(actionState.toolbarPosition.left + toolbarWidth - popoverWidth, edgePadding),
      Math.max(edgePadding, viewportSize.width - popoverWidth - edgePadding)
    );
    const availableBelow = Math.max(
      0,
      viewportSize.height - actionState.toolbarPosition.top - toolbarHeight - gap - edgePadding
    );
    const availableAbove = Math.max(
      0,
      actionState.toolbarPosition.top - gap - edgePadding
    );
    const shouldOpenUpwards = availableBelow < 248 && availableAbove > availableBelow;
    const popoverMaxHeight = Math.max(
      0,
      Math.min(shouldOpenUpwards ? availableAbove : availableBelow, viewportSize.height - (edgePadding * 2))
    );

    return {
      left: `${absoluteLeft - actionState.toolbarPosition.left}px`,
      width: `${popoverWidth}px`,
      maxHeight: `${popoverMaxHeight}px`,
      ...(shouldOpenUpwards
        ? { bottom: `${toolbarHeight + gap}px` }
        : { top: `${toolbarHeight + gap}px` }),
    };
  }, [actionState, viewportSize]);

  useEffect(() => {
    if (!hasStatusToken) {
      setIsStatusPopoverOpen(false);
    }
  }, [hasStatusToken, statusTokenId]);

  useEffect(() => {
    if (!hasSizeToken) {
      setIsSizePopoverOpen(false);
      return;
    }

    setIsSizePopoverOpen(false);
  }, [hasSizeToken, sizeTokenId]);

  useEffect(() => {
    if (!hasVisionToken) {
      setIsVisionPopoverOpen(false);
      return;
    }

    setIsVisionPopoverOpen(false);
  }, [hasVisionToken, visionTokenId]);

  if (!actionState) {
    return null;
  }

  const handleToggleStatus = (statusId) => {
    if (!actionState.statusToken?.tokenId) return;

    onUpdateTokenStatuses?.(
      actionState.statusToken.tokenId,
      toggleTokenStatus(actionState.statusToken.statuses, statusId)
    );
  };
  const handleClearAllStatuses = () => {
    if (!actionState.statusToken?.tokenId) return;

    onUpdateTokenStatuses?.(actionState.statusToken.tokenId, []);
  };

  const visibilityTitle = actionState.visibilityTitle || 'Toggle token visibility';
  const deadStateTitle = actionState.deadStateTitle || 'Toggle token dead state';
  const statusTitle = actionState.statusToken
    ? `Edit statuses for ${actionState.statusToken.label || 'token'}`
    : 'Edit token statuses';
  const sizeTitle = actionState.sizeToken
    ? `Resize ${actionState.sizeToken.label || 'token'}`
    : 'Resize token';
  const visionTitle = actionState.visionToken
    ? `Edit vision for ${actionState.visionToken.label || 'token'}`
    : 'Edit token vision';
  const VisibilityIcon = actionState.nextIsVisibleToPlayers ? FiEye : FiEyeOff;

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div
        className="pointer-events-auto absolute"
        style={{
          left: actionState.toolbarPosition.left,
          top: actionState.toolbarPosition.top,
        }}
      >
        <div ref={statusControlRef} className="relative">
          <div className="flex items-center gap-2 rounded-[1.4rem] border border-slate-700/80 bg-slate-950/88 p-2 shadow-2xl backdrop-blur-sm">
            {actionState.showVisibilityAction && (
              <button
                type="button"
                aria-label={visibilityTitle}
                title={visibilityTitle}
                disabled={isTokenVisibilityActionPending}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onSetSelectedTokensVisibility?.(
                    actionState.tokenIds,
                    actionState.nextIsVisibleToPlayers
                  );
                }}
                className={`flex items-center justify-center rounded-[1.15rem] border text-slate-50 shadow-lg transition-transform duration-150 hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-60 ${
                  actionState.nextIsVisibleToPlayers
                    ? 'border-emerald-300/60 bg-emerald-500/30'
                    : 'border-slate-200/30 bg-slate-900/90'
                }`}
                style={{
                  width: actionState.buttonSize,
                  height: actionState.buttonSize,
                }}
              >
                <VisibilityIcon className="h-[42%] w-[42%]" />
              </button>
            )}

            {actionState.showDeadAction && (
              <button
                type="button"
                aria-label={deadStateTitle}
                title={deadStateTitle}
                disabled={isTokenDeadActionPending}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onSetSelectedTokensDeadState?.(
                    actionState.tokenIds,
                    actionState.nextIsDead
                  );
                }}
                className={`flex items-center justify-center rounded-[1.15rem] border text-slate-50 shadow-lg transition-transform duration-150 hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-60 ${
                  actionState.nextIsDead
                    ? 'border-rose-300/60 bg-rose-600/35'
                    : 'border-emerald-300/55 bg-emerald-600/25'
                }`}
                style={{
                  width: actionState.buttonSize,
                  height: actionState.buttonSize,
                }}
              >
                <GiDeathSkull className="h-[48%] w-[48%]" />
              </button>
            )}

            {actionState.statusToken && (
              <button
                type="button"
                aria-label={statusTitle}
                title={statusTitle}
                disabled={isTokenStatusActionPending}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setIsSizePopoverOpen(false);
                  setIsVisionPopoverOpen(false);
                  setIsStatusPopoverOpen((currentValue) => !currentValue);
                }}
                className={`flex items-center justify-center rounded-[1.15rem] border text-slate-50 shadow-lg transition-transform duration-150 hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-60 ${
                  isStatusPopoverOpen
                    ? 'border-amber-300/70 bg-amber-500/30'
                    : 'border-sky-300/45 bg-sky-500/18'
                }`}
                style={{
                  width: actionState.buttonSize,
                  height: actionState.buttonSize,
                }}
              >
                <GiAura className="h-[48%] w-[48%]" />
              </button>
            )}

            {actionState.sizeToken && (
              <button
                type="button"
                aria-label={sizeTitle}
                title={sizeTitle}
                disabled={isTokenSizeActionPending}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setIsStatusPopoverOpen(false);
                  setIsVisionPopoverOpen(false);
                  setIsSizePopoverOpen((currentValue) => !currentValue);
                }}
                className={`flex items-center justify-center rounded-[1.15rem] border text-slate-50 shadow-lg transition-transform duration-150 hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-60 ${
                  isSizePopoverOpen
                    ? 'border-amber-300/70 bg-amber-500/30'
                    : 'border-violet-300/45 bg-violet-500/18'
                }`}
                style={{
                  width: actionState.buttonSize,
                  height: actionState.buttonSize,
                }}
              >
                <FiMaximize className="h-[44%] w-[44%]" />
              </button>
            )}

            {actionState.visionToken && (
              <button
                type="button"
                aria-label={visionTitle}
                title={visionTitle}
                disabled={isTokenVisionActionPending}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setIsStatusPopoverOpen(false);
                  setIsSizePopoverOpen(false);
                  setIsVisionPopoverOpen((currentValue) => !currentValue);
                }}
                className={`flex items-center justify-center rounded-[1.15rem] border text-slate-50 shadow-lg transition-transform duration-150 hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-60 ${
                  isVisionPopoverOpen
                    ? 'border-cyan-200/75 bg-cyan-400/28'
                    : 'border-cyan-300/45 bg-cyan-500/18'
                }`}
                style={{
                  width: actionState.buttonSize,
                  height: actionState.buttonSize,
                }}
              >
                <FiSun className="h-[44%] w-[44%]" />
              </button>
            )}
          </div>

          <TokenStatusPopover
            open={isStatusPopoverOpen && !!actionState.statusToken}
            activeStatuses={actionState.statusToken?.statuses || []}
            isPending={isTokenStatusActionPending}
            onToggleStatus={handleToggleStatus}
            onClearAll={handleClearAllStatuses}
            onRequestClose={() => setIsStatusPopoverOpen(false)}
            withinRef={statusControlRef}
            placementStyle={statusPopoverPlacement}
          />

          <TokenSizePopover
            open={isSizePopoverOpen && !!actionState.sizeToken}
            sizeSquares={actionState.sizeToken?.sizeSquares || 1}
            isPending={isTokenSizeActionPending}
            onCommitSize={(nextSizeSquares) => onSetSelectedTokenSize?.(
              actionState.sizeToken?.tokenId,
              nextSizeSquares
            )}
            onRequestClose={() => setIsSizePopoverOpen(false)}
            withinRef={statusControlRef}
            placementStyle={sizePopoverPlacement}
          />

          <GrigliataTokenVisionPopover
            open={isVisionPopoverOpen && !!actionState.visionToken}
            visionEnabled={actionState.visionToken?.visionEnabled}
            visionRadiusSquares={actionState.visionToken?.visionRadiusSquares}
            isPending={isTokenVisionActionPending}
            onCommitVision={(nextVisionSettings) => onSetSelectedTokenVision?.(
              actionState.visionToken?.tokenId,
              nextVisionSettings
            )}
            onRequestClose={() => setIsVisionPopoverOpen(false)}
            withinRef={statusControlRef}
            placementStyle={sizePopoverPlacement}
          />
        </div>
      </div>
    </div>
  );
}
