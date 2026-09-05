import { useCallback, useEffect, useRef, useState } from 'react';
import { getCodex, invalidateCodex } from '../../data/codexRepository';
import { getVarie, invalidateConfig } from '../../data/configRepository';

const isRecord = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
);

const classifyCodex = (data) => {
  if (!isRecord(data)) {
    return { data: null, status: 'missing' };
  }
  // The shipped Codex fixture and older documents intentionally omit Razze;
  // RaceSelection owns the permanent-summoning placeholder for that legacy
  // shape. Only an explicitly present, non-map Razze value is malformed.
  if (!Object.prototype.hasOwnProperty.call(data, 'Razze') || data.Razze == null) {
    return { data, status: 'missing' };
  }
  if (!isRecord(data.Razze)) {
    return { data, status: 'malformed' };
  }
  return { data, status: 'ready' };
};

const classifyVarie = (data) => {
  if (!isRecord(data)) {
    return { data: null, status: 'missing' };
  }
  if (!isRecord(data.modAnima)) {
    return { data, status: 'malformed' };
  }
  return { data, status: 'ready' };
};

const startRead = (read) => {
  try {
    return Promise.resolve(read());
  } catch (error) {
    return Promise.reject(error);
  }
};

export const loadCharacterCreationData = () => {
  // Invoke both repository boundaries before awaiting either result. The
  // repositories retain actor scoping, single-flight, cache, and transition
  // retry behavior; this layer owns only the route-level join and snapshot.
  const codexPromise = startRead(getCodex);
  const variePromise = startRead(getVarie);

  return Promise.all([codexPromise, variePromise]).then(([codex, varie]) => {
    const codexResult = classifyCodex(codex);
    const varieResult = classifyVarie(varie);
    return {
      codex: codexResult.data,
      codexStatus: codexResult.status,
      varie: varieResult.data,
      varieStatus: varieResult.status,
    };
  });
};

const createIdleState = (scopeKey = null) => ({
  scopeKey,
  codex: null,
  codexStatus: 'idle',
  codexError: null,
  varie: null,
  varieStatus: 'idle',
  varieError: null,
});

const createLoadingState = (scopeKey) => ({
  scopeKey,
  codex: null,
  codexStatus: 'loading',
  codexError: null,
  varie: null,
  varieStatus: 'loading',
  varieError: null,
});

const createScopeKey = (uid, repositoryAccessGeneration) => (
  uid ? `character-creation:${uid}:${repositoryAccessGeneration}` : null
);

export const useCharacterCreationData = ({
  uid = null,
  repositoryAccessGeneration = 0,
  enabled = true,
} = {}) => {
  const scopeKey = enabled && uid
    ? createScopeKey(uid, repositoryAccessGeneration)
    : null;
  const [state, setState] = useState(() => createIdleState());
  const stateRef = useRef(state);
  const scopeKeyRef = useRef(scopeKey);
  const scopeGenerationRef = useRef(0);
  const attemptRef = useRef({ codex: 0, varie: 0 });
  const inFlightRef = useRef({ codex: false, varie: false });
  const mountedRef = useRef(false);
  const lifetimeRef = useRef(0);

  stateRef.current = state;
  scopeKeyRef.current = scopeKey;

  const runResource = useCallback((resource, read, classify, scopeGeneration) => {
    const attempt = attemptRef.current[resource] + 1;
    attemptRef.current[resource] = attempt;
    inFlightRef.current[resource] = true;
    const lifetime = lifetimeRef.current;
    const isCurrentAttempt = () => (
      mountedRef.current
      && lifetimeRef.current === lifetime
      && scopeKeyRef.current === scopeKey
      && scopeGenerationRef.current === scopeGeneration
      && attemptRef.current[resource] === attempt
    );

    startRead(read).then(
      (value) => {
        if (!isCurrentAttempt()) return;
        inFlightRef.current[resource] = false;
        const result = classify(value);
        setState((previous) => {
          if (previous.scopeKey !== scopeKey) return previous;
          return {
            ...previous,
            [resource]: result.data,
            [`${resource}Status`]: result.status,
            [`${resource}Error`]: null,
          };
        });
      },
      (error) => {
        if (!isCurrentAttempt()) return;
        inFlightRef.current[resource] = false;
        setState((previous) => {
          if (previous.scopeKey !== scopeKey) return previous;
          return {
            ...previous,
            [`${resource}Status`]: 'error',
            [`${resource}Error`]: error,
          };
        });
      }
    );
  }, [scopeKey]);

  useEffect(() => {
    mountedRef.current = true;
    const lifetime = lifetimeRef.current + 1;
    lifetimeRef.current = lifetime;

    if (!scopeKey) {
      scopeGenerationRef.current += 1;
      inFlightRef.current = { codex: false, varie: false };
      setState(createIdleState());
      return () => {
        if (lifetimeRef.current !== lifetime) return;
        mountedRef.current = false;
        lifetimeRef.current += 1;
        inFlightRef.current = { codex: false, varie: false };
      };
    }

    const scopeGeneration = scopeGenerationRef.current + 1;
    scopeGenerationRef.current = scopeGeneration;
    inFlightRef.current = { codex: true, varie: true };
    setState(createLoadingState(scopeKey));

    // Start both approved repository reads before either promise is awaited.
    // Each resource settles into its own state so Step 1 is not held hostage
    // by later-step configuration.
    runResource('codex', getCodex, classifyCodex, scopeGeneration);
    runResource('varie', getVarie, classifyVarie, scopeGeneration);

    return () => {
      if (lifetimeRef.current !== lifetime) return;
      mountedRef.current = false;
      lifetimeRef.current += 1;
      inFlightRef.current = { codex: false, varie: false };
    };
  }, [runResource, scopeKey]);

  const retryResource = useCallback((resource) => {
    const statusKey = `${resource}Status`;
    const errorKey = `${resource}Error`;
    const currentState = stateRef.current;
    if (
      !mountedRef.current
      ||
      currentState.scopeKey !== scopeKey
      || currentState[statusKey] !== 'error'
      || inFlightRef.current[resource]
    ) {
      return;
    }

    if (resource === 'codex') {
      invalidateCodex();
    } else {
      invalidateConfig('varie');
    }

    const scopeGeneration = scopeGenerationRef.current;
    setState((previous) => {
      if (previous.scopeKey !== scopeKey) return previous;
      return {
        ...previous,
        [statusKey]: 'loading',
        [errorKey]: null,
      };
    });
    runResource(
      resource,
      resource === 'codex' ? getCodex : getVarie,
      resource === 'codex' ? classifyCodex : classifyVarie,
      scopeGeneration
    );
  }, [runResource, scopeKey]);

  const retryCodex = useCallback(() => retryResource('codex'), [retryResource]);
  const retryVarie = useCallback(() => retryResource('varie'), [retryResource]);

  const retry = useCallback(() => {
    retryCodex();
  }, [retryCodex]);

  if (state.scopeKey !== scopeKey) {
    return {
      ...createLoadingState(scopeKey),
      status: 'loading',
      data: null,
      error: null,
      retryCodex,
      retryVarie,
      retry,
    };
  }

  const data = {
    codex: state.codex,
    codexStatus: state.codexStatus,
    varie: state.varie,
    varieStatus: state.varieStatus,
  };
  const status = state.codexStatus === 'error'
    ? 'error'
    : state.codexStatus === 'ready'
      || state.codexStatus === 'missing'
      || state.codexStatus === 'malformed'
      ? 'ready'
      : state.codexStatus;

  return {
    ...state,
    status,
    data,
    error: state.codexError,
    retryCodex,
    retryVarie,
    retry,
  };
};

export const classifyCharacterCreationCodex = classifyCodex;
export const classifyCharacterCreationVarie = classifyVarie;
