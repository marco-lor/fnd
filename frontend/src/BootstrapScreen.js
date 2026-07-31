import React from "react";

const phaseMessages = {
  "config-loading": "Loading application configuration…",
  "firebase-initializing": "Starting secure services…",
  "app-loading": "Preparing Etherium…",
};

const BootstrapScreen = ({ phase, onRetry }) => {
  const isError = phase === "error";

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white"
      aria-live="polite"
      aria-busy={!isError}
      data-testid="bootstrap-screen"
      data-bootstrap-phase={phase}
    >
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/80 p-8 text-center shadow-2xl">
        <h1 className="text-2xl font-semibold tracking-wide">Etherium</h1>
        {isError ? (
          <>
            <p className="mt-4 text-slate-300">
              The application could not start. Check your connection and try again.
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-6 rounded-xl border border-cyan-300/60 bg-cyan-400/10 px-5 py-2.5 font-medium text-cyan-100 hover:bg-cyan-400/20"
            >
              Retry
            </button>
          </>
        ) : (
          <>
            <div
              className="mx-auto mt-6 h-9 w-9 animate-spin rounded-full border-2 border-cyan-300/30 border-t-cyan-200"
              aria-hidden="true"
            />
            <p className="mt-4 text-slate-300">
              {phaseMessages[phase] || phaseMessages["app-loading"]}
            </p>
          </>
        )}
      </section>
    </main>
  );
};

export default BootstrapScreen;

