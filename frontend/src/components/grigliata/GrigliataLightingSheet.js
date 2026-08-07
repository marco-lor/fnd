import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FiX, FiZap } from 'react-icons/fi';

const LIGHTING_SHEET_ENTRY_DURATION_MS = 260;
const LIGHTING_SHEET_EXIT_DURATION_MS = 180;
const LIGHTING_SHEET_TRANSITION_FALLBACK_MS = 50;
const LIGHTING_SHEET_ENTRY_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const LIGHTING_SHEET_EXIT_EASING = 'cubic-bezier(0.4, 0, 1, 1)';

const prefersReducedMotion = () => (
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

const focusWithoutScrolling = (element) => {
  if (!element || typeof element.focus !== 'function') return;

  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
};

export default function GrigliataLightingSheet({
  background,
  hasLightingMetadata = false,
  isLightingEnabled = true,
  isMetadataReady = true,
  hasUnsavedChanges = false,
  isCloseDisabled = false,
  returnFocusElement = null,
  onClose,
  children,
}) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const entryFocusTimeoutRef = useRef(null);
  const entryFocusCommittedRef = useRef(false);
  const closeFallbackTimeoutRef = useRef(null);
  const closeCommittedRef = useRef(false);
  const requestedReturnFocusElementRef = useRef(returnFocusElement);
  const initialCloseDisabledRef = useRef(isCloseDisabled);
  const [isEntered, setIsEntered] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const isReducedMotion = prefersReducedMotion();
  const backgroundName = background?.name || 'Untitled Map';
  const titleId = 'grigliata-lighting-sheet-title';
  const statusText = isCloseDisabled
    ? 'Importing'
    : (!isMetadataReady
      ? 'Loading'
      : (hasLightingMetadata
        ? (isLightingEnabled ? 'Configured' : 'Configured · Disabled')
        : 'Not configured'));

  const completeClose = useCallback(() => {
    if (closeCommittedRef.current) return;

    closeCommittedRef.current = true;
    if (closeFallbackTimeoutRef.current) {
      clearTimeout(closeFallbackTimeoutRef.current);
      closeFallbackTimeoutRef.current = null;
    }
    onClose?.();
  }, [onClose]);

  const focusEnteredPanel = useCallback(() => {
    if (entryFocusCommittedRef.current) return;

    entryFocusCommittedRef.current = true;
    if (entryFocusTimeoutRef.current) {
      clearTimeout(entryFocusTimeoutRef.current);
      entryFocusTimeoutRef.current = null;
    }

    const focusTarget = initialCloseDisabledRef.current
      ? dialogRef.current
      : closeButtonRef.current;
    focusWithoutScrolling(focusTarget);
  }, []);

  const requestClose = useCallback(() => {
    if (isCloseDisabled || isClosing) return;

    if (
      hasUnsavedChanges
      && typeof window !== 'undefined'
      && !window.confirm('Discard the parsed lighting file without importing it?')
    ) {
      return;
    }

    setIsClosing(true);
    setIsEntered(false);

    if (prefersReducedMotion()) {
      completeClose();
      return;
    }

    closeFallbackTimeoutRef.current = setTimeout(
      completeClose,
      LIGHTING_SHEET_EXIT_DURATION_MS + LIGHTING_SHEET_TRANSITION_FALLBACK_MS
    );
  }, [completeClose, hasUnsavedChanges, isCloseDisabled, isClosing]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const requestedReturnFocusElement = requestedReturnFocusElementRef.current;
    const previouslyFocusedElement = document.activeElement;
    const startEntry = () => setIsEntered(true);
    let entryFrame = null;
    let entryTimeout = null;

    if (prefersReducedMotion()) {
      startEntry();
      entryFocusTimeoutRef.current = setTimeout(focusEnteredPanel, 0);
    } else if (typeof window.requestAnimationFrame === 'function') {
      entryFrame = window.requestAnimationFrame(startEntry);
      entryFocusTimeoutRef.current = setTimeout(
        focusEnteredPanel,
        LIGHTING_SHEET_ENTRY_DURATION_MS + LIGHTING_SHEET_TRANSITION_FALLBACK_MS
      );
    } else {
      entryTimeout = setTimeout(startEntry, 0);
      entryFocusTimeoutRef.current = setTimeout(
        focusEnteredPanel,
        LIGHTING_SHEET_ENTRY_DURATION_MS + LIGHTING_SHEET_TRANSITION_FALLBACK_MS
      );
    }

    return () => {
      if (entryFrame !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(entryFrame);
      }
      if (entryTimeout !== null) clearTimeout(entryTimeout);
      if (entryFocusTimeoutRef.current) clearTimeout(entryFocusTimeoutRef.current);
      if (closeFallbackTimeoutRef.current) clearTimeout(closeFallbackTimeoutRef.current);

      const restoreFocus = () => {
        const focusTarget = [
          requestedReturnFocusElement,
          previouslyFocusedElement,
          document.querySelector('[role="tab"][aria-label="DM Gallery"]'),
        ].find((element) => element?.isConnected && typeof element.focus === 'function');
        focusWithoutScrolling(focusTarget);
      };

      setTimeout(restoreFocus, 0);
    };
  }, [focusEnteredPanel]);

  if (!background) return null;

  return (
    <section
      ref={dialogRef}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="grigliata-lighting-sheet"
      data-motion-state={isClosing ? 'exiting' : (isEntered ? 'entered' : 'entering')}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.propertyName && event.propertyName !== 'transform') return;
        if (isClosing) completeClose();
        else if (isEntered) focusEnteredPanel();
      }}
      className="flex h-full w-full flex-col rounded-2xl border border-slate-700 bg-slate-950/[0.98] text-slate-100 transition-transform will-change-transform"
      style={{
        backfaceVisibility: 'hidden',
        transform: isEntered ? 'translate3d(0, 0, 0)' : 'translate3d(100%, 0, 0)',
        transitionProperty: isReducedMotion ? 'none' : 'transform',
        transitionDuration: isReducedMotion
          ? '0ms'
          : `${isClosing ? LIGHTING_SHEET_EXIT_DURATION_MS : LIGHTING_SHEET_ENTRY_DURATION_MS}ms`,
        transitionTimingFunction: isClosing
          ? LIGHTING_SHEET_EXIT_EASING
          : LIGHTING_SHEET_ENTRY_EASING,
      }}
    >
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-4 py-3">
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
            hasLightingMetadata
              ? 'border-cyan-300/60 bg-cyan-500/15 text-cyan-200 shadow-lg shadow-cyan-950/40'
              : 'border-slate-600 bg-transparent text-slate-400'
          }`}
          aria-hidden="true"
        >
          <FiZap className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-sm font-semibold text-slate-100">
            Lighting — {backgroundName}
          </h2>
          <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
            hasLightingMetadata
              ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-200'
              : 'border-slate-700 bg-slate-900 text-slate-400'
          }`}
          >
            {statusText}
          </span>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          aria-label={`Close lighting for ${backgroundName}`}
          title={isCloseDisabled ? 'Import in progress; close is temporarily unavailable' : 'Close lighting'}
          onClick={requestClose}
          disabled={isCloseDisabled || isClosing}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 disabled:cursor-wait disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-slate-300"
        >
          <FiX className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <div className="custom-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
        {children}
      </div>
    </section>
  );
}
