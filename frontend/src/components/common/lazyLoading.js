import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { beginRouteAsyncWork } from '../../performance/runtime';

const CHUNK_ERROR_PATTERNS = [
  /chunkloaderror/i,
  /loading (?:css )?chunk [\w-]+ failed/i,
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
];

export const isChunkLoadError = (error) => {
  if (!error) return false;
  const message = `${error.name || ''} ${error.message || error}`;
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

export const canPrefetchModules = (connection = (
  typeof navigator !== 'undefined' ? navigator.connection : null
)) => {
  if (!connection) return true;
  if (connection.saveData === true) return false;
  return !['slow-2g', '2g'].includes(String(connection.effectiveType || '').toLowerCase());
};

export const createModuleLoader = ({ importer, exportName = 'default', chunkName = '' }) => {
  let modulePromise = null;

  const load = () => {
    if (!modulePromise) {
      modulePromise = Promise.resolve()
        .then(importer)
        .then((loadedModule) => {
          const component = exportName === 'default'
            ? loadedModule?.default
            : loadedModule?.[exportName];
          if (!component) {
            throw new Error(`Lazy module ${chunkName || 'unknown'} has no ${exportName} export.`);
          }
          return { default: component };
        })
        .catch((error) => {
          modulePromise = null;
          throw error;
        });
    }
    return modulePromise;
  };

  return Object.freeze({ chunkName, exportName, load, preload: load });
};

export const LazyLoadFallback = ({ label = 'Loading content', variant = 'feature', onClose }) => {
  useEffect(() => beginRouteAsyncWork(`lazy-${variant}`), [variant]);

  return (
    <div
      className={variant === 'route'
        ? 'flex min-h-[16rem] w-full items-center justify-center px-6 py-10 text-white'
        : 'flex min-h-[8rem] w-full items-center justify-center rounded-2xl border border-slate-700 bg-slate-950/70 p-5 text-slate-200'}
      role="status"
      aria-live="polite"
      data-testid={`lazy-${variant}-fallback`}
    >
      <div className="text-center">
        <p className="text-sm font-semibold">{label}</p>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="mt-3 rounded-lg border border-slate-500 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-800"
          >
            Close
          </button>
        ) : null}
      </div>
    </div>
  );
};

class LazyErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (isChunkLoadError(error)) {
      console.warn('A lazy-loaded application chunk could not be loaded.', error);
      return;
    }
    console.error('A lazy-loaded application view failed to render.', error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const chunkError = isChunkLoadError(error);
    return (
      <div
        className="flex min-h-[12rem] w-full items-center justify-center px-5 py-8 text-white"
        role="alert"
        data-testid="lazy-load-error"
      >
        <section className="w-full max-w-lg rounded-2xl border border-red-400/30 bg-slate-950/90 p-6 text-center shadow-2xl">
          <h2 className="text-lg font-semibold">
            {chunkError ? 'This part of the application could not be loaded' : 'This view encountered an error'}
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            {chunkError
              ? 'The application may have been updated, or the connection may have been interrupted.'
              : 'Retry the view. If the problem continues, refresh the application.'}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={this.props.onRetry}
              className="rounded-xl border border-cyan-300/50 px-4 py-2 text-sm text-cyan-100"
            >
              Retry loading
            </button>
            <button
              type="button"
              onClick={this.props.onRefresh}
              className="rounded-xl border border-slate-400/50 px-4 py-2 text-sm text-slate-100"
            >
              Refresh application
            </button>
            {this.props.onClose ? (
              <button
                type="button"
                onClick={this.props.onClose}
                className="rounded-xl border border-amber-300/50 px-4 py-2 text-sm text-amber-100"
              >
                Close
              </button>
            ) : null}
          </div>
        </section>
      </div>
    );
  }
}

export const RetryableLazyBoundary = ({
  descriptor,
  fallbackLabel,
  variant = 'feature',
  onClose,
  componentProps = {},
  retryResetKey = descriptor.chunkName,
}) => {
  const [attempt, setAttempt] = useState(0);
  const boundaryKey = `${retryResetKey}:${attempt}`;
  const LazyComponent = useMemo(
    () => {
      // Deliberately recreate React.lazy after a rejected import.
      void attempt;
      return React.lazy(descriptor.load);
    },
    [attempt, descriptor]
  );

  const retry = () => setAttempt((value) => value + 1);
  const refresh = () => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  return (
    <LazyErrorBoundary
      key={boundaryKey}
      onRetry={retry}
      onRefresh={refresh}
      onClose={onClose}
    >
      <Suspense
        key={boundaryKey}
        fallback={<LazyLoadFallback label={fallbackLabel} variant={variant} onClose={onClose} />}
      >
        <LazyComponent {...componentProps} />
      </Suspense>
    </LazyErrorBoundary>
  );
};
