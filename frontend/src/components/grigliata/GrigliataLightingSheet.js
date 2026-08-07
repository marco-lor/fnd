import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FiX, FiZap } from 'react-icons/fi';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

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
  const requestedReturnFocusElementRef = useRef(returnFocusElement);
  const initialCloseDisabledRef = useRef(isCloseDisabled);
  const backgroundName = background?.name || 'Untitled Map';
  const titleId = 'grigliata-lighting-sheet-title';
  const statusText = isCloseDisabled
    ? 'Importing'
    : (!isMetadataReady
      ? 'Loading'
      : (hasLightingMetadata
        ? (isLightingEnabled ? 'Configured' : 'Configured · Disabled')
        : 'Not configured'));

  const requestClose = useCallback(() => {
    if (isCloseDisabled) return;

    if (
      hasUnsavedChanges
      && typeof window !== 'undefined'
      && !window.confirm('Discard the parsed lighting file without importing it?')
    ) {
      return;
    }

    onClose?.();
  }, [hasUnsavedChanges, isCloseDisabled, onClose]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    const requestedReturnFocusElement = requestedReturnFocusElementRef.current;
    const previouslyFocusedElement = document.activeElement;
    document.body.style.overflow = 'hidden';
    if (initialCloseDisabledRef.current) {
      dialogRef.current?.focus();
    } else {
      closeButtonRef.current?.focus();
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      const focusTarget = [
        requestedReturnFocusElement,
        previouslyFocusedElement,
        document.querySelector('[role="tab"][aria-label="DM Gallery"]'),
      ].find((element) => element?.isConnected && typeof element.focus === 'function');
      if (focusTarget) {
        focusTarget.focus();
      }
    };
  }, []);

  const handleDialogKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusableElements = Array.from(
      dialogRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || []
    );
    if (!focusableElements.length) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  if (!background || typeof document === 'undefined') return null;

  return createPortal(
    <div
      data-testid="grigliata-lighting-sheet-backdrop"
      className="fixed inset-0 z-[140] flex justify-end bg-slate-950/55 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="grigliata-lighting-sheet"
        onKeyDown={handleDialogKeyDown}
        className="flex h-full w-full flex-col border-slate-700 bg-slate-950/[0.98] text-slate-100 shadow-2xl shadow-black/70 sm:max-w-[34rem] sm:border-l"
      >
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur-md">
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
            disabled={isCloseDisabled}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 disabled:cursor-wait disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-slate-300"
          >
            <FiX className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="custom-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
          {children}
        </div>
      </section>
    </div>,
    document.body
  );
}
