import { createTask07AbortError } from './mediaErrors';

const createController = () => {
  if (typeof AbortController !== 'function') {
    throw new Error('Task 07 media cancellation is unavailable in this browser.');
  }
  return new AbortController();
};

const abortEntry = (entry, reason) => {
  if (!entry || entry.controller.signal.aborted) return false;
  entry.controller.abort(createTask07AbortError(reason));
  return true;
};

/**
 * Owns exactly one component-scoped media operation. Starting a replacement
 * aborts the previous lease, while dispose aborts the current lease and
 * permanently closes the owner. The pipeline and upload queue both consume
 * the returned signal, so the same owner covers queued and in-flight work.
 */
export const createTask07MediaOperationOwner = () => {
  let activeEntry = null;
  let disposed = false;

  const start = (replacementReason = 'Task 07 media operation was replaced.') => {
    if (disposed) {
      throw new Error('Task 07 media operation owner has been disposed.');
    }
    const entry = {
      controller: createController(),
    };
    const replacedEntry = activeEntry;
    activeEntry = entry;
    // Publish the new owner before abort dispatch. Abort listeners run
    // synchronously and may themselves dispose or replace this owner; this
    // ordering guarantees that no re-entrant lease becomes unowned.
    abortEntry(replacedEntry, replacementReason);

    return Object.freeze({
      signal: entry.controller.signal,
      cancel: (reason = 'Task 07 media operation was cancelled.') => (
        abortEntry(entry, reason)
      ),
      isCurrent: () => (
        !disposed
        && activeEntry === entry
        && !entry.controller.signal.aborted
      ),
      release: () => {
        if (activeEntry === entry) activeEntry = null;
      },
    });
  };

  return Object.freeze({
    start,
    cancel: (reason = 'Task 07 media operation was cancelled.') => (
      abortEntry(activeEntry, reason)
    ),
    dispose: (reason = 'Task 07 media owner was unmounted.') => {
      if (disposed) return false;
      disposed = true;
      const disposedEntry = activeEntry;
      activeEntry = null;
      return abortEntry(disposedEntry, reason);
    },
    hasActiveOperation: () => (
      !disposed
      && !!activeEntry
      && !activeEntry.controller.signal.aborted
    ),
    isDisposed: () => disposed,
  });
};
