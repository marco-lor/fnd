import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DiceRoller from '../../common/DiceRoller';
import {
  commitConsumable,
  createUserOperationId,
  isDefinitiveUserDataCommandError,
  prepareConsumable,
} from '../../../data/userData/userDataCommands';
import { stableDataJson } from '../../../data/userData/stableDataJson';
import { recordTask08Event } from '../../../performance/task08';

const IDLE_VIEW = Object.freeze({ phase: 'idle', action: null, error: null });
const BEFORE_COMMIT_PHASES = new Set(['preparing', 'rolling', 'retryable-prepare']);

const inventoryIdOf = (item) => (
  item?._task05?.inventoryId || item?._instance?.instanceId || null
);

const inventoryVersionOf = (item) => {
  const inventoryId = inventoryIdOf(item);
  if (!inventoryId || !item || typeof item !== 'object') return null;
  return stableDataJson({
    inventoryId,
    revision: item?._task05?.revision ?? null,
    quantity: item.qty ?? item.quantity ?? null,
    catalogItemId: item?._task05?.catalogItemId ?? item.id ?? null,
    General: item.General ?? null,
    Specific: item.Specific ?? null,
    Parametri: item.Parametri ?? null,
  });
};

const publicErrorMessage = (error) => {
  const code = String(error?.code || '').replace(/^functions\//, '');
  if (code === 'failed-precondition' || code === 'not-found') {
    return 'Il consumabile non è più disponibile nello stato preparato.';
  }
  return 'Impossibile confermare l’esito. Riprova la stessa operazione.';
};

const actionTags = (action, extra = {}) => ({
  actionId: action.actionId,
  resource: action.resource || 'none',
  ...extra,
});

export const getBonusCreazione = (item) => {
  const raw = item?.Specific?.['Bonus Creazione'];
  if (raw == null) return 0;
  const cleaned = String(raw).trim().replace(/^\+/, '');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
};

export const computeFinalGain = (rawTotal, bonusCreazione, diceCount) => {
  const bonus = Number.isFinite(bonusCreazione) ? bonusCreazione : 0;
  const count = Number.isFinite(diceCount) ? diceCount : 0;
  return rawTotal + (bonus * count);
};

export const applyCapToStat = (current, gain, total) => {
  const currentValue = Number(current) || 0;
  const gainValue = Number(gain) || 0;
  const totalValue = Number(total) || 0;
  return totalValue > 0
    ? Math.min(totalValue, currentValue + gainValue)
    : currentValue + gainValue;
};

export const useConsumableAction = ({
  inventory = [],
  mutationsReady,
  repositoryAccessGeneration = 0,
  user,
}) => {
  const scopeKey = user?.uid && mutationsReady
    ? `${user.uid}:${repositoryAccessGeneration}`
    : null;
  const inventoryVersions = useMemo(() => new Map(
    (Array.isArray(inventory) ? inventory : []).map((entry) => [
      inventoryIdOf(entry),
      inventoryVersionOf(entry),
    ]).filter(([inventoryId, version]) => inventoryId && version)
  ), [inventory]);
  const latestScopeRef = useRef(scopeKey);
  const latestInventoryVersionsRef = useRef(inventoryVersions);
  const mountedRef = useRef(true);
  const actionRef = useRef(null);
  const [view, setView] = useState(IDLE_VIEW);

  latestScopeRef.current = scopeKey;
  latestInventoryVersionsRef.current = inventoryVersions;

  const actionMatchesCurrentScope = useCallback((action, { allowInventoryChange = false } = {}) => (
    Boolean(
      action
      && mountedRef.current
      && actionRef.current === action
      && latestScopeRef.current
      && latestScopeRef.current === action.scopeKey
      && (allowInventoryChange
        || latestInventoryVersionsRef.current.get(action.inventoryId) === action.inventoryVersion)
    )
  ), []);

  const publish = useCallback((action, nextView, options) => {
    if (!actionMatchesCurrentScope(action, options)) return false;
    setView(nextView);
    return true;
  }, [actionMatchesCurrentScope]);

  const finishWithError = useCallback((action, stage, error) => {
    if (!actionMatchesCurrentScope(action, { allowInventoryChange: action.commitDispatched })) return;
    const definitive = isDefinitiveUserDataCommandError(error);
    recordTask08Event({
      metric: 'consumable-action-terminal',
      tags: actionTags(action, {
        outcome: definitive ? 'definitive-failure' : 'ambiguous',
        stage,
      }),
    });
    if (definitive) {
      actionRef.current = null;
      setView({
        phase: 'error',
        action: null,
        error: publicErrorMessage(error),
        scopeKey: action.scopeKey,
      });
      return;
    }
    action.phase = stage === 'prepare' ? 'retryable-prepare' : 'retryable-commit';
    publish(action, {
      phase: action.phase,
      action,
      error: publicErrorMessage(error),
    }, { allowInventoryChange: action.commitDispatched });
  }, [actionMatchesCurrentScope, publish]);

  const dispatchCommit = useCallback(async (action) => {
    if (!actionMatchesCurrentScope(action, {
      allowInventoryChange: action?.commitDispatched,
    })) return;
    action.commitDispatched = true;
    action.phase = 'committing';
    publish(action, { phase: 'committing', action, error: null }, { allowInventoryChange: true });
    recordTask08Event({
      metric: 'consumable-commit-dispatched',
      tags: actionTags(action),
    });
    try {
      const result = await commitConsumable({
        preparationId: action.preparation.preparationId,
        resource: action.resource,
        operationId: action.commitOperationId,
        retryKey: `${action.actionId}:commit`,
      });
      if (!actionMatchesCurrentScope(action, { allowInventoryChange: true })) return;
      recordTask08Event({
        metric: 'consumable-action-terminal',
        tags: actionTags(action, {
          outcome: result?.replayed === true ? 'replayed' : 'applied',
          stage: 'commit',
        }),
      });
      actionRef.current = null;
      setView(IDLE_VIEW);
    } catch (error) {
      finishWithError(action, 'commit', error);
    }
  }, [actionMatchesCurrentScope, finishWithError, publish]);

  const runPrepare = useCallback(async (action) => {
    if (!actionMatchesCurrentScope(action)) return;
    action.phase = 'preparing';
    publish(action, { phase: 'preparing', action, error: null });
    try {
      const preparation = await prepareConsumable({
        inventoryId: action.inventoryId,
        resource: action.resource,
        operationId: action.prepareOperationId,
        retryKey: `${action.actionId}:prepare`,
      });
      if (!actionMatchesCurrentScope(action)) return;
      if (!preparation?.preparationId || !Array.isArray(preparation.rolls)) {
        throw Object.assign(new Error('Consumable preparation response is invalid.'), {
          code: 'functions/failed-precondition',
        });
      }
      action.preparation = preparation;
      if (preparation.rolls.length > 0) {
        action.phase = 'rolling';
        publish(action, { phase: 'rolling', action, error: null });
      } else {
        await dispatchCommit(action);
      }
    } catch (error) {
      finishWithError(action, 'prepare', error);
    }
  }, [actionMatchesCurrentScope, dispatchCommit, finishWithError, publish]);

  const begin = useCallback(({ item, mode }) => {
    const resource = mode === 'hp' || mode === 'mana' ? mode : null;
    const inventoryId = inventoryIdOf(item);
    const inventoryVersion = inventoryVersionOf(item);
    if (!scopeKey || !inventoryId || !inventoryVersion || actionRef.current) return false;
    if (latestInventoryVersionsRef.current.get(inventoryId) !== inventoryVersion) return false;
    const action = {
      actionId: createUserOperationId('consume-action'),
      prepareOperationId: createUserOperationId('consume-prepare'),
      commitOperationId: createUserOperationId('consume-commit'),
      scopeKey,
      user,
      inventoryId,
      inventoryVersion,
      resource,
      item,
      preparation: null,
      phase: 'preparing',
      commitDispatched: false,
    };
    actionRef.current = action;
    setView({ phase: 'preparing', action, error: null });
    recordTask08Event({ metric: 'consumable-action-start', tags: actionTags(action) });
    runPrepare(action);
    return true;
  }, [runPrepare, scopeKey, user]);

  const cancel = useCallback(() => {
    const action = actionRef.current;
    if (!action || action.commitDispatched || !BEFORE_COMMIT_PHASES.has(action.phase)) return false;
    actionRef.current = null;
    recordTask08Event({
      metric: 'consumable-action-cancelled',
      tags: actionTags(action, { stage: action.phase }),
    });
    if (mountedRef.current) setView(IDLE_VIEW);
    return true;
  }, []);

  const retry = useCallback(() => {
    const action = actionRef.current;
    if (!actionMatchesCurrentScope(action, { allowInventoryChange: action?.commitDispatched })) return false;
    if (action.phase === 'retryable-prepare') {
      runPrepare(action);
      return true;
    }
    if (action.phase === 'retryable-commit') {
      dispatchCommit(action);
      return true;
    }
    return false;
  }, [actionMatchesCurrentScope, dispatchCommit, runPrepare]);

  const completeAnimation = useCallback(() => {
    const action = actionRef.current;
    if (!actionMatchesCurrentScope(action) || action.phase !== 'rolling') return false;
    recordTask08Event({ metric: 'consumable-animation-complete', tags: actionTags(action) });
    dispatchCommit(action);
    return true;
  }, [actionMatchesCurrentScope, dispatchCommit]);

  const dismissError = useCallback(() => {
    setView((current) => current.phase === 'error' ? IDLE_VIEW : current);
  }, []);

  useEffect(() => {
    const action = actionRef.current;
    if (!action) return;
    const scopeMatches = Boolean(scopeKey && action.scopeKey === scopeKey);
    const inventoryMatches = inventoryVersions.get(action.inventoryId) === action.inventoryVersion;
    if (scopeMatches && (action.commitDispatched || inventoryMatches)) return;
    actionRef.current = null;
    if (!action.commitDispatched) {
      recordTask08Event({
        metric: 'consumable-action-cancelled',
        tags: actionTags(action, { stage: scopeMatches ? 'inventory-replaced' : 'scope-changed' }),
      });
    }
    setView(IDLE_VIEW);
  }, [inventoryVersions, scopeKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const action = actionRef.current;
      if (action && !action.commitDispatched) {
        recordTask08Event({
          metric: 'consumable-action-cancelled',
          tags: actionTags(action, { stage: 'unmount' }),
        });
      }
      actionRef.current = null;
    };
  }, []);

  const visibleView = view.action
    && (!scopeKey
      || view.action.scopeKey !== scopeKey
      || (!view.action.commitDispatched
        && inventoryVersions.get(view.action.inventoryId) !== view.action.inventoryVersion))
    ? IDLE_VIEW
    : view;

  return useMemo(() => ({
    begin,
    cancel,
    completeAnimation,
    dismissError,
    isBusy: Boolean(visibleView.action),
    retry,
    view: visibleView,
  }), [begin, cancel, completeAnimation, dismissError, retry, visibleView]);
};

const PendingLayer = ({ children, cancellable, onCancel }) => (
  <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
    <div className="w-full max-w-md rounded-2xl border border-emerald-600/40 bg-slate-900/95 p-5 text-slate-200 shadow-2xl">
      <p className="text-sm">{children}</p>
      {cancellable && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            aria-label="Cancel consumable"
            onClick={onCancel}
            className="rounded-xl border border-slate-600/60 px-4 py-2 text-sm hover:border-slate-400/70"
          >
            Annulla
          </button>
        </div>
      )}
    </div>
  </div>
);

const ConsumableActionContent = ({ controller }) => {
  const { view } = controller;
  const action = view?.action;
  if (view?.phase === 'rolling' && action?.preparation) {
    const { preparation } = action;
    const rolls = preparation.rolls;
    const faces = Number(preparation.faces) || Math.max(10, ...rolls);
    const modifier = Number(preparation.modifier) || 0;
    const label = action.resource === 'hp' ? 'HP' : 'Mana';
    return (
      <DiceRoller
        key={action.actionId}
        faces={faces}
        count={rolls.length}
        modifier={modifier}
        description={`Lancio ${rolls.length}d${faces}${modifier ? `${modifier > 0 ? '+' : ''}${modifier}` : ''} Anima per ${label}`}
        onComplete={controller.completeAnimation}
        user={action.user}
        finalRolls={rolls}
      />
    );
  }
  if (view?.phase === 'preparing') {
    return <PendingLayer cancellable onCancel={controller.cancel}>Preparazione consumabile…</PendingLayer>;
  }
  if (view?.phase === 'committing') {
    return <PendingLayer>Applicazione autorevole in corso…</PendingLayer>;
  }
  if (view?.phase === 'retryable-prepare' || view?.phase === 'retryable-commit') {
    return (
      <PendingLayer>
        <span>{view.error}</span>
        <button
          type="button"
          aria-label="Retry consumable"
          onClick={controller.retry}
          className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-sm text-white"
        >
          Riprova
        </button>
      </PendingLayer>
    );
  }
  if (view?.phase === 'error' && view.scopeKey) {
    return (
      <PendingLayer>
        <span>{view.error}</span>
        <button
          type="button"
          aria-label="Dismiss consumable error"
          onClick={controller.dismissError}
          className="mt-4 rounded-xl border border-slate-600/60 px-4 py-2 text-sm"
        >
          Chiudi
        </button>
      </PendingLayer>
    );
  }
  return null;
};

export default useConsumableAction;

export const ConsumableActionLayer = ({ controller }) => createPortal(
  <ConsumableActionContent controller={controller} />,
  document.body
);
