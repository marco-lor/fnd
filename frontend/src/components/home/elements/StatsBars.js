// file: ./frontend/src/components/home/elements/StatsBars.js
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuthSession } from '../../../AuthContext';
import { useResources } from '../../../data/userData/userDataHooks';
import {
  createUserOperationId,
  isDefinitiveUserDataCommandError,
  updateResource,
} from '../../../data/userData/userDataCommands';
import { FaAngleRight, FaAngleLeft, FaAnglesRight, FaAnglesLeft, FaDroplet } from 'react-icons/fa6';
import { FaRedo, FaBan } from 'react-icons/fa';
import { GiHearts, GiMagicSwirl, GiShield } from 'react-icons/gi';
import { usePerformanceRenderProbe } from '../../../performance/PerformanceProfiler';
import { getTask08ResourceHoldId, recordTask08Event } from '../../../performance/task08';

const StatsBars = () => {
  usePerformanceRenderProbe('StatsBars');
  const { user, repositoryAccessGeneration = 0 } = useAuthSession();
  const actionScopeKey = `${user?.uid || 'anonymous'}:${repositoryAccessGeneration}`;
  const actionScopeRef = useRef(actionScopeKey);
  actionScopeRef.current = actionScopeKey;
  const {
    data: userData,
    status: resourcesStatus,
  } = useResources(user?.uid);
  const mutationsReady = resourcesStatus === 'fresh'
    && userData !== null;
  const lifecycleRef = useRef({scopeKey: actionScopeKey, ready: mutationsReady, generation: 0});
  if (lifecycleRef.current.scopeKey !== actionScopeKey || lifecycleRef.current.ready !== mutationsReady) {
    lifecycleRef.current = {
      scopeKey: actionScopeKey,
      ready: mutationsReady,
      generation: lifecycleRef.current.generation + 1,
    };
  }
  const executeResourceMutation = (payload) => updateResource(payload);
  const authoritativeStatsRef = useRef(userData?.stats || {});
  authoritativeStatsRef.current = userData?.stats || {};
  const [pendingGestures, setPendingGestures] = useState({});
  const activeGestureRef = useRef(null);
  const gestureMetadataRef = useRef({});
  const gestureSequenceRef = useRef(0);
  const mountedRef = useRef(true);
  // State for custom input modal
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customInputValue, setCustomInputValue] = useState('');
  const [customAction, setCustomAction] = useState(null);
  const [customFeedbackMessage, setCustomFeedbackMessage] = useState('');
  const [customActionScopeKey, setCustomActionScopeKey] = useState(null);

  const resourceRevision = Number.isFinite(Number(userData?.revision))
    ? Number(userData.revision)
    : 0;
  const resourceRevisionRef = useRef(resourceRevision);
  resourceRevisionRef.current = resourceRevision;
  const optimisticResourceValue = useCallback((resource, authoritativeValue, excludeId) => {
    const gestures = Object.values(gestureMetadataRef.current)
      .filter((gesture) => gesture.resource === resource
        && gesture.scopeKey === actionScopeRef.current && gesture.id !== excludeId);
    const acknowledgedGesture = gestures
      .filter((gesture) => gesture.phase === 'awaiting-source-ack'
        && Number.isFinite(gesture.newRevision)
        && gesture.newRevision > resourceRevisionRef.current)
      .sort((left, right) => right.newRevision - left.newRevision)[0];
    const unresolvedGesture = gestures.find((gesture) => (
      (gesture.phase === 'committing' || gesture.phase === 'retryable')
      && Number.isFinite(gesture.frozenValue)
    ));
    let visibleValue = unresolvedGesture
      ? unresolvedGesture.frozenValue
      : acknowledgedGesture
      ? acknowledgedGesture.newValue
      : Number(authoritativeValue || 0);
    gestures.forEach((gesture) => {
      const metadata = gestureMetadataRef.current[gesture.id] || gesture;
      const phase = metadata.phase || gesture.phase;
      if (phase === 'active' || phase === 'queued') {
        visibleValue += gesture.delta;
      }
    });
    if (resource === 'barriera') {
      const stats = authoritativeStatsRef.current || {};
      const total = Number(stats.barrieraTotal ?? stats.barriera ?? 0);
      return Math.max(0, Math.min(Math.max(0, total), visibleValue));
    }
    return visibleValue;
  }, []);

  const clearGestureTimer = (gesture) => {
    if (gesture?.timer) clearInterval(gesture.timer);
    if (gesture) gesture.timer = null;
  };
  const discardGesture = useCallback((gesture) => {
    clearGestureTimer(gesture);
    if (activeGestureRef.current?.id === gesture?.id) activeGestureRef.current = null;
    if (gesture?.id) delete gestureMetadataRef.current[gesture.id];
    if (gesture?.id && mountedRef.current) {
      setPendingGestures((previous) => {
        if (!previous[gesture.id]) return previous;
        const next = { ...previous };
        delete next[gesture.id];
        return next;
      });
    }
  }, []);

  const cancelAllGestures = useCallback(() => {
    const capturedGestures = Object.values(gestureMetadataRef.current);
    // Releasing capture can synchronously fire lostpointercapture. Invalidate
    // all ownership before that browser callback has a chance to finalize.
    activeGestureRef.current = null;
    gestureMetadataRef.current = {};
    capturedGestures.forEach((gesture) => {
      clearGestureTimer(gesture);
      try {
        if (gesture.element?.hasPointerCapture?.(gesture.pointerId)) {
          gesture.element.releasePointerCapture(gesture.pointerId);
        }
      } catch (_) {}
    });
    if (mountedRef.current) setPendingGestures({});
  }, []);

  useEffect(() => {
    if (mutationsReady) return;
    cancelAllGestures();
  }, [cancelAllGestures, mutationsReady]);

  const updateGesture = useCallback((gesture, patch) => {
    if (!gesture?.id || !mountedRef.current) return;
    setPendingGestures((previous) => {
      const current = previous[gesture.id];
      if (!current) return previous;
      return {
        ...previous,
        [gesture.id]: {...current, ...patch},
      };
    });
  }, []);

  const canApplyGestureTick = useCallback((gesture) => {
    if (gesture.resource !== 'barriera') return true;
    const stats = authoritativeStatsRef.current || {};
    const current = Number(stats.barrieraCurrent ?? stats.barriera ?? 0);
    const total = Number(stats.barrieraTotal ?? stats.barriera ?? 0);
    const next = optimisticResourceValue('barriera', current, gesture.id) + gesture.delta + gesture.direction;
    return total > 0 && next >= 0 && next <= total;
  }, [optimisticResourceValue]);
  const applyGestureTick = useCallback((gesture) => {
    if (!gesture || activeGestureRef.current?.id !== gesture.id
      || !lifecycleRef.current.ready || lifecycleRef.current.scopeKey !== gesture.scopeKey
      || lifecycleRef.current.generation !== gesture.lifecycleGeneration
      || !canApplyGestureTick(gesture)) return false;
    gesture.delta += gesture.direction;
    setPendingGestures((previous) => ({
      ...previous,
      [gesture.id]: {
        id: gesture.id,
        resource: gesture.resource,
        delta: gesture.delta,
        scopeKey: gesture.scopeKey,
        phase: gesture.phase,
        startRevision: gesture.startRevision,
        operationId: gesture.operationId,
      },
    }));
    return true;
  }, [canApplyGestureTick]);
  const commitGesture = useCallback(function commitGesture(gesture, canRetry = true) {
    const drainQueue = (confirmedValue) => {
      const next = Object.values(gestureMetadataRef.current).find((candidate) => (
        candidate.resource === gesture.resource && candidate.phase === 'queued'
      ));
      if (!next) return;
      const stats = authoritativeStatsRef.current || {};
      const acknowledged = Object.values(gestureMetadataRef.current)
        .filter((candidate) => candidate.resource === next.resource
          && candidate.phase === 'awaiting-source-ack'
          && candidate.newRevision > resourceRevisionRef.current)
        .sort((left, right) => right.newRevision - left.newRevision)[0];
      const baseline = Number.isFinite(confirmedValue) ? confirmedValue
        : Number(acknowledged?.newValue ?? stats[`${next.resource}Current`] ?? stats[next.resource] ?? 0);
      if (next.resource === 'barriera') {
        const total = Math.max(0, Number(stats.barrieraTotal ?? stats.barriera ?? 0));
        next.delta = Math.max(0, Math.min(total, baseline + next.delta)) - baseline;
      }
      if (next.delta === 0) {
        discardGesture(next);
        drainQueue(baseline);
        return;
      }
      next.phase = 'committing';
      next.frozenValue = baseline + next.delta;
      updateGesture(next, {phase: next.phase, frozenValue: next.frozenValue, delta: next.delta});
      commitGesture(next);
    };
    executeResourceMutation({
      resource: gesture.resource,
      mode: 'delta',
      value: gesture.delta,
      operationId: gesture.operationId,
      retryKey: gesture.retryKey,
      retryScope: gesture.scopeKey,
      task08HoldId: gesture.holdId,
      task08LocalSequence: gesture.sequence,
    }).then((result) => {
      if (!mountedRef.current || !lifecycleRef.current.ready || lifecycleRef.current.scopeKey !== gesture.scopeKey || lifecycleRef.current.generation !== gesture.lifecycleGeneration) return;
      const newValue = Number(result?.newValue);
      const newRevision = Number(result?.newRevision);
      if (Number.isFinite(newValue) && Number.isFinite(newRevision)) {
        gesture.phase = 'awaiting-source-ack';
        gesture.newValue = newValue;
        gesture.newRevision = newRevision;
        gestureMetadataRef.current[gesture.id] = gesture;
        updateGesture(gesture, {phase: 'awaiting-source-ack', newValue, newRevision});
        drainQueue(newValue);
        return;
      }
      discardGesture(gesture);
      drainQueue(newValue);
    }).catch((error) => {
      if (!mountedRef.current || !lifecycleRef.current.ready || lifecycleRef.current.scopeKey !== gesture.scopeKey || lifecycleRef.current.generation !== gesture.lifecycleGeneration) return;
      if (isDefinitiveUserDataCommandError(error)) {
        discardGesture(gesture);
        drainQueue();
      }
      else if (canRetry) {
        // A transport failure may have committed after the response path broke.
        // Reuse the exact operation ID once so the receipt prevents a second write.
        commitGesture(gesture, false);
      } else {
        gesture.phase = 'retryable';
        gestureMetadataRef.current[gesture.id] = gesture;
        updateGesture(gesture, {phase: 'retryable'});
      }
      console.error(`Error updating ${gesture.resource}:`, error);
    });
  }, [discardGesture, updateGesture]);
  const finalizeGesture = useCallback((pointerId, terminal = 'pointerup') => {
    const gesture = activeGestureRef.current;
    if (!gesture || gesture.pointerId !== pointerId || gesture.finalized
      || !mountedRef.current
      || !lifecycleRef.current.ready
      || lifecycleRef.current.scopeKey !== gesture.scopeKey
      || lifecycleRef.current.generation !== gesture.lifecycleGeneration) return;
    gesture.finalized = true;
    clearGestureTimer(gesture);
    try {
      if (gesture.element?.hasPointerCapture?.(pointerId)) gesture.element.releasePointerCapture(pointerId);
    } catch (_) {
      // Pointer capture can already have been released by a terminal browser event.
    }
    if (activeGestureRef.current?.id === gesture.id) activeGestureRef.current = null;
    const stats = authoritativeStatsRef.current || {};
    const currentField = {
      hp: 'hpCurrent', mana: 'manaCurrent', essenza: 'essenzaCurrent', barriera: 'barrieraCurrent',
    }[gesture.resource];
    const currentValue = optimisticResourceValue(gesture.resource,
      stats[currentField] ?? (gesture.resource === 'barriera' ? stats.barriera : 0), gesture.id);
    if (gesture.resource === 'barriera') {
      const total = Math.max(0, Number(stats.barrieraTotal ?? stats.barriera ?? 0));
      gesture.delta = Math.max(0, Math.min(total, currentValue + gesture.delta)) - currentValue;
    }
    recordTask08Event({ metric: 'resource-gesture-terminal', tags: {
      terminal,
      resource: gesture.resource,
      effectiveDelta: gesture.delta,
      localSequence: gesture.sequence,
      ...(gesture.holdId ? {holdId: gesture.holdId} : {}),
    } });
    if (gesture.delta === 0) {
      discardGesture(gesture);
      return;
    }
    // Only one command per resource can be unresolved. Later gestures remain
    // optimistic, then use the preceding receipt as their confirmed baseline.
    const waiting = Object.values(gestureMetadataRef.current).some((candidate) => (
      candidate.id !== gesture.id && candidate.resource === gesture.resource
      && (candidate.phase === 'committing' || candidate.phase === 'retryable')
    ));
    gesture.phase = waiting ? 'queued' : 'committing';
    gesture.frozenValue = currentValue + gesture.delta;
    gestureMetadataRef.current[gesture.id] = gesture;
    updateGesture(gesture, {phase: gesture.phase, frozenValue: gesture.frozenValue, delta: gesture.delta});
    if (!waiting) commitGesture(gesture);
  }, [commitGesture, discardGesture, optimisticResourceValue, updateGesture]);
  const retryableGesture = Object.values(pendingGestures).find((gesture) => gesture.phase === 'retryable'
    && gesture.scopeKey === actionScopeKey);
  const retryUnresolvedGesture = useCallback(() => {
    const gesture = retryableGesture && gestureMetadataRef.current[retryableGesture.id];
    if (!gesture || !lifecycleRef.current.ready || lifecycleRef.current.scopeKey !== gesture.scopeKey
      || lifecycleRef.current.generation !== gesture.lifecycleGeneration) return;
    gesture.phase = 'committing';
    updateGesture(gesture, {phase: 'committing'});
    commitGesture(gesture, false);
  }, [commitGesture, retryableGesture, updateGesture]);
  const startGesture = useCallback((resource, direction, event) => {
    if (!mutationsReady || retryableGesture || activeGestureRef.current || event?.isPrimary === false || event?.button > 0) return;
    // JSDOM's PointerEvent shim omits pointerId; browsers always provide it.
    const pointerId = Number.isFinite(event?.pointerId) && event.pointerId > 0 ? event.pointerId : 1;
    const scopeKey = actionScopeRef.current;
    const sequence = ++gestureSequenceRef.current;
    const gesture = {
      id: `gesture-${sequence}-${createUserOperationId('resource')}`,
      operationId: createUserOperationId('resource-gesture'),
      retryKey: `resource-gesture:${scopeKey}:${sequence}`,
      resource,
      direction,
      delta: 0,
      pointerId,
      scopeKey,
      element: event.currentTarget,
      timer: null,
      finalized: false,
      phase: 'active',
      startRevision: resourceRevision,
      sequence,
      lifecycleGeneration: lifecycleRef.current.generation,
      holdId: getTask08ResourceHoldId(),
    };
    gestureMetadataRef.current[gesture.id] = gesture;
    try {
      event.currentTarget?.setPointerCapture?.(pointerId);
    } catch (_) {
      delete gestureMetadataRef.current[gesture.id];
      return;
    }
    activeGestureRef.current = gesture;
    event.preventDefault?.();
    applyGestureTick(gesture);
    gesture.timer = setInterval(() => applyGestureTick(gesture), 200);
  }, [applyGestureTick, mutationsReady, resourceRevision, retryableGesture]);
  const keyboardGesture = useCallback((resource, direction, event) => {
    if (event.detail !== 0 || !mutationsReady || retryableGesture || activeGestureRef.current) return;
    const scopeKey = actionScopeRef.current;
    const sequence = ++gestureSequenceRef.current;
    const gesture = {
      id: `keyboard-${sequence}-${createUserOperationId('resource')}`,
      operationId: createUserOperationId('resource-gesture'),
      retryKey: `resource-gesture:${scopeKey}:${sequence}`,
      resource,
      direction,
      delta: 0,
      pointerId: `keyboard-${sequence}`,
      scopeKey,
      finalized: false,
      phase: 'active',
      startRevision: resourceRevision,
      sequence,
      lifecycleGeneration: lifecycleRef.current.generation,
      holdId: getTask08ResourceHoldId(),
    };
    activeGestureRef.current = gesture;
    applyGestureTick(gesture);
    finalizeGesture(gesture.pointerId, 'keyboard');
  }, [applyGestureTick, finalizeGesture, mutationsReady, resourceRevision, retryableGesture]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
    mountedRef.current = false;
    cancelAllGestures();
    };
  }, [cancelAllGestures]);

  useEffect(() => {
    if (!mountedRef.current) return;
    setPendingGestures((previous) => {
      let changed = false;
      const next = {...previous};
      Object.entries(previous).forEach(([id, gesture]) => {
        if (gesture.scopeKey === actionScopeKey
          && gesture.phase === 'awaiting-source-ack'
          && resourceRevision >= gesture.newRevision) {
          delete next[id];
          delete gestureMetadataRef.current[id];
          changed = true;
        }
      });
      return changed ? next : previous;
    });
  }, [actionScopeKey, resourceRevision]);
  // Activation overlay state for Barriera
  const [showBarrieraActivate, setShowBarrieraActivate] = useState(false);
  const [barrieraActionScopeKey, setBarrieraActionScopeKey] = useState(null);
  const [barrieraActivateValue, setBarrieraActivateValue] = useState('');
  // Turns for barriera duration
  const [barrieraActivateTurns, setBarrieraActivateTurns] = useState('');

  useEffect(() => {
    setShowCustomInput(false);
    setCustomActionScopeKey(null);
    setCustomAction(null);
    setCustomInputValue('');
    setCustomFeedbackMessage('');
    setShowBarrieraActivate(false);
    setBarrieraActionScopeKey(null);
    setBarrieraActivateValue('');
    setBarrieraActivateTurns('');
    cancelAllGestures();
  }, [actionScopeKey, cancelAllGestures]);

  // --- HP adjustment functions ---
  const handleResetHP = async () => {
    if (user && userData?.stats) {
      try {
        await executeResourceMutation({ resource: 'hp', mode: 'set', value: userData.stats.hpTotal });
      } catch (error) {
        console.error("Error resetting HP:", error);
      }
    }
  };

  const openCustomInput = (action) => {
    if (!mutationsReady) return;
    setCustomAction(action);
    setCustomInputValue('');
    setCustomFeedbackMessage('');
    setCustomActionScopeKey(actionScopeKey);
    setShowCustomInput(true);
  };

  const closeCustomInput = () => {
    setShowCustomInput(false);
    setCustomActionScopeKey(null);
    setCustomAction(null);
    setCustomInputValue('');
    setCustomFeedbackMessage('');
  };

  // Determine Italian prompt message for custom input
  const promptMessage = customAction?.includes('decrement')
    ? 'Inserisci il valore da sottrarre'
    : 'Inserisci il valore da aggiungere';

  // Helper to check if action is a decrement
  const isDecrementAction = (action) => (
    ['hp-decrement', 'mana-decrement', 'essenza-decrement', 'barriera-decrement'].includes(action)
  );

  const handleCustomSubmit = async () => {
    const submissionScopeKey = actionScopeKey;
    if (!mutationsReady || customActionScopeKey !== submissionScopeKey) return;
    const delta = parseInt(customInputValue, 10);
    if (!isNaN(delta) && user && userData?.stats) {
      let resource, newValue, actualDelta = delta;
      if (customAction === 'hp-decrement') {
        resource = 'hp';
        const current = userData.stats.hpCurrent || 0;
        if (delta > current) {
          actualDelta = current;
          newValue = 0;
        } else {
          newValue = current - delta;
        }
      } else if (customAction === 'hp-increment') {
        resource = 'hp';
        newValue = (userData.stats.hpCurrent || 0) + delta;
      } else if (customAction === 'mana-decrement') {
        resource = 'mana';
        const current = userData.stats.manaCurrent || 0;
        if (delta > current) {
          actualDelta = current;
          newValue = 0;
        } else {
          newValue = current - delta;
        }
      } else if (customAction === 'mana-increment') {
        resource = 'mana';
        newValue = (userData.stats.manaCurrent || 0) + delta;
      } else if (customAction === 'essenza-decrement') {
        resource = 'essenza';
        const current = userData.stats.essenzaCurrent || 0;
        if (delta > current) {
          actualDelta = current;
          newValue = 0;
        } else {
          newValue = current - delta;
        }
      } else if (customAction === 'essenza-increment') {
        resource = 'essenza';
        newValue = (userData.stats.essenzaCurrent || 0) + delta;
      } else if (customAction === 'barriera-decrement') {
        resource = 'barriera';
        const current = userData.stats.barrieraCurrent || 0;
        if (delta > current) {
          actualDelta = current;
          newValue = 0;
        } else {
          newValue = current - delta;
        }
      } else if (customAction === 'barriera-increment') {
        resource = 'barriera';
        const current = userData.stats.barrieraCurrent || 0;
        const total = userData.stats.barrieraTotal || 0;
        if (total <= 0) return; // cannot increment if not active
        newValue = current + delta;
        if (newValue > total) newValue = total;
      }
      try {
        await executeResourceMutation({ resource, mode: 'set', value: newValue });
        if (actionScopeRef.current !== submissionScopeKey) return;
        if (isDecrementAction(customAction) && actualDelta !== delta) {
          const msg = `Solo ${actualDelta} punti sono stati sottratti; ${delta} superavano il valore attuale. Valore portato a 0.`;
          setCustomFeedbackMessage(msg);
          return;
        }
        closeCustomInput();
      } catch (error) {
        console.error(`Error custom ${customAction}:`, error);
      }
    }
  };

  // --- Mana adjustment functions ---
  const handleResetMana = async () => {
    if (user && userData?.stats) {
      try {
        await executeResourceMutation({ resource: 'mana', mode: 'set', value: userData.stats.manaTotal });
      } catch (error) {
        console.error("Error resetting Mana:", error);
      }
    }
  };

  // --- Essenza adjustment functions ---
  const handleResetEssenza = async () => {
    if (user && userData?.stats) {
      try {
        await executeResourceMutation({ resource: 'essenza', mode: 'set', value: userData.stats.essenzaTotal || 0 });
      } catch (error) {
        console.error("Error resetting Essenza:", error);
      }
    }
  };

  // Small reusable stat row
  // Keep the row component identity stable: a local optimistic tick must not
  // unmount the captured button before its terminal pointer event arrives.
  const statRowRef = useRef(null);
  if (!statRowRef.current) statRowRef.current = ({
    label,
    icon: Icon,
    colorTrack,
    colorFill,
    colorFillInactive, // optional neutral color when value is 0 (for singleValue rows)
    current,
    total,
    onReset,
    onDecPointerDown,
    onDecPointerEnd,
    onDecKeyboard,
    onIncPointerDown,
    onIncPointerEnd,
    onIncKeyboard,
    onOpenDec,
    onOpenInc,
    singleValue = false,
    onIconClick,
    iconActive = false,
    resetTitle,
    resetIcon: ResetIcon = FaRedo,
    resetClassName,
    resetDisabled = false,
    decDisabled = false,
    incDisabled = false,
    decDisabledTitle,
    incDisabledTitle,
  }) => {
    const pct = total ? Math.max(0, (current / total) * 100) : (singleValue ? 100 : 0);
    const overflowPct = total && current > total ? ((current - total) / total) * 100 : 0;
    const fillClass = ( (singleValue || total === 0) && current === 0 && colorFillInactive) ? colorFillInactive : colorFill;
    return (
      <div className="flex items-center gap-2 w-full">
        <div className="flex items-center gap-2 w-28">
          {onIconClick ? (
            <button
              onClick={onIconClick}
              className={`relative inline-flex items-center justify-center h-8 w-8 rounded-xl border transition-colors ${iconActive ? 'border-amber-400/70 bg-amber-500/20 text-amber-300' : 'border-slate-600/60 bg-slate-800/50 text-slate-300 hover:border-slate-400/70'} focus:outline-none focus:ring-2 focus:ring-amber-400/40`}
              title={iconActive ? 'Barriera attiva - clic per reimpostare' : 'Attiva Barriera'}
            >
              <Icon className="w-4 h-4" />
            </button>
          ) : (
            <div className="relative inline-flex items-center justify-center h-8 w-8 rounded-xl border border-slate-600/60 bg-slate-800/50 text-slate-300">
              <Icon className="w-4 h-4" />
            </div>
          )}
          <span className="text-sm font-medium text-slate-200">{label}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-1">
          <button
            onClick={onReset}
            disabled={resetDisabled}
            className={`relative inline-flex items-center justify-center h-7 w-7 rounded-xl text-white shadow-sm transition-transform focus:outline-none focus:ring-2 disabled:opacity-40 disabled:cursor-not-allowed ${resetClassName || 'bg-gradient-to-br from-emerald-600 to-green-600 hover:scale-105 active:scale-95 focus:ring-emerald-400/40'}`}
            title={resetTitle || `Reset ${label}`}
          >
            <ResetIcon className="w-3.5 h-3.5" />
          </button>
          <button
            onPointerDown={decDisabled ? undefined : onDecPointerDown}
            onPointerUp={decDisabled ? undefined : onDecPointerEnd}
            onPointerCancel={decDisabled ? undefined : onDecPointerEnd}
            onLostPointerCapture={decDisabled ? undefined : onDecPointerEnd}
            onClick={decDisabled ? undefined : onDecKeyboard}
            disabled={decDisabled}
            className={`touch-none inline-flex items-center justify-center h-7 w-7 rounded-xl border  ${decDisabled ? 'border-slate-700/50 bg-slate-800/30 text-slate-500 cursor-not-allowed' : 'border-slate-600/60 bg-slate-800/60 text-slate-200 hover:border-slate-400/70 hover:text-white'}`}
            title={decDisabled ? (decDisabledTitle || 'Non modificabile') : `-1 ${label}`}
          >
            <FaAngleLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={decDisabled ? undefined : onOpenDec}
            disabled={decDisabled}
            className={`inline-flex items-center justify-center h-7 w-7 rounded-xl border ${decDisabled ? 'border-slate-700/50 bg-slate-800/30 text-slate-500 cursor-not-allowed' : 'border-slate-600/60 bg-slate-800/60 text-slate-200 hover:border-slate-400/70 hover:text-white'}`}
            title={decDisabled ? (decDisabledTitle || 'Non modificabile') : `Sottrai ${label} (valore custom)`}
          >
            <FaAnglesLeft className="w-3.5 h-3.5" />
          </button>
          <div className={`relative flex-1 h-5 rounded-lg ${colorTrack} overflow-visible border border-slate-600/50`}>
            {/* fill */}
            <div
              style={{ width: `${Math.min(100, pct)}%` }}
              className={`h-full rounded-md transition-colors duration-200 ${fillClass}`}
            />
            {/* overflow fill */}
            {overflowPct > 0 && (
              <div
                style={{ width: `${overflowPct}%` }}
                className="h-full bg-amber-400 rounded-r-md"
              />
            )}
            {/* subtle stripes */}
            <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.06)_0px,rgba(255,255,255,0.06)_6px,transparent_6px,transparent_12px)] rounded-lg" />
          </div>
          <button
            onClick={incDisabled ? undefined : onOpenInc}
            disabled={incDisabled}
            className={`touch-none inline-flex items-center justify-center h-7 w-7 rounded-xl border ${incDisabled ? 'border-slate-700/50 bg-slate-800/60 text-slate-500 cursor-not-allowed' : 'border-slate-600/60 bg-slate-800/60 text-slate-200 hover:border-slate-400/70 hover:text-white'}`}
            title={incDisabled ? (incDisabledTitle || 'Non modificabile') : `Aggiungi ${label} (valore custom)`}
          >
            <FaAnglesRight className="w-3.5 h-3.5" />
          </button>
          <button
            onPointerDown={incDisabled ? undefined : onIncPointerDown}
            onPointerUp={incDisabled ? undefined : onIncPointerEnd}
            onPointerCancel={incDisabled ? undefined : onIncPointerEnd}
            onLostPointerCapture={incDisabled ? undefined : onIncPointerEnd}
            onClick={incDisabled ? undefined : onIncKeyboard}
            disabled={incDisabled}
            className={`inline-flex items-center justify-center h-7 w-7 rounded-xl border ${incDisabled ? 'border-slate-700/50 bg-slate-800/30 text-slate-500 cursor-not-allowed' : 'border-slate-600/60 bg-slate-800/60 text-slate-200 hover:border-slate-400/70 hover:text-white'}`}
            title={incDisabled ? (incDisabledTitle || 'Non modificabile') : `+1 ${label}`}
          >
            <FaAngleRight className="w-3.5 h-3.5" />
          </button>
          <span className="min-w-[72px] text-right text-sm text-slate-200">
            {singleValue ? current : `${current}/${total}`}
          </span>
        </div>
      </div>
    );
  };
  const StatRow = statRowRef.current;

  // --- Barriera handlers (single value) ---
  const handleResetBarriera = async () => {
    if (!user) return;
    try {
      await executeResourceMutation({
        resource: 'barriera',
        mode: 'set',
        value: 0,
        totalValue: 0,
        remainingTurns: 0,
        totalTurns: 0,
      });
    } catch (e) {
      console.error('Error resetting Barriera:', e);
    }
  };

  // Activate Barriera (sets both current and total)
  const handleActivateBarriera = async () => {
    const submissionScopeKey = actionScopeKey;
    const val = parseInt(barrieraActivateValue, 10);
    const turns = parseInt(barrieraActivateTurns, 10);
    if (
      isNaN(val)
      || val <= 0
      || isNaN(turns)
      || turns <= 0
      || !user
      || !mutationsReady
      || barrieraActionScopeKey !== submissionScopeKey
    ) return;
    try {
      await executeResourceMutation({
        resource: 'barriera',
        mode: 'set',
        value: val,
        totalValue: val,
        totalTurns: turns,
        remainingTurns: turns,
      });
      if (actionScopeRef.current !== submissionScopeKey) return;
      setBarrieraActivateValue('');
      setBarrieraActivateTurns('');
      setShowBarrieraActivate(false);
      setBarrieraActionScopeKey(null);
    } catch (e) {
      console.error('Error activating barriera', e);
    }
  };

  const barrierCurrent = userData?.stats?.barrieraCurrent ?? userData?.stats?.barriera ?? 0;
  const barrierTotal = userData?.stats?.barrieraTotal ?? userData?.stats?.barriera ?? 0;
  // Turn effect data for barriera
  const barrierTurnsTotal = userData?.active_turn_effect?.barriera?.totalTurns || 0;
  const barrierTurnsRemaining = userData?.active_turn_effect?.barriera?.remainingTurns || 0;
  const barrierActive = barrierTotal > 0; // active as long as a total is defined (>0)
  const barrierDepleted = barrierActive && barrierCurrent === 0;
  const barrierFull = barrierActive && barrierCurrent >= barrierTotal && !barrierDepleted;
  const barrierIncDisabledTitle = !barrierActive ? 'Barriera non attiva' : (barrierDepleted ? 'Barriera terminata: ri-attiva con lo scudo' : (barrierFull ? 'Barriera al massimo' : ''));
  const barrierDecDisabledTitle = !barrierActive ? 'Barriera non attiva' : (barrierDepleted ? 'Barriera terminata' : '');

  return (
    <div className="relative backdrop-blur bg-slate-900/70 border border-slate-700/50 rounded-2xl p-5 shadow-lg">
      {/* Decorative glows to match EquippedInventory */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
        <div className="absolute -left-16 -top-16 w-52 h-52 bg-indigo-500/10 rounded-full blur-3xl" />
        <div className="absolute -right-10 -bottom-24 w-64 h-64 bg-fuchsia-500/10 rounded-full blur-3xl" />
      </div>

      {/* Custom Input Modal (full-screen overlay retained via portal to avoid clipping) */}
      {showCustomInput && customActionScopeKey === actionScopeKey && createPortal(
        (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-slate-900/90 border border-slate-700/70 rounded-2xl shadow-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-700/60">
                <h2 className="text-sm font-medium text-slate-200 tracking-wide">{promptMessage}</h2>
              </div>
              <div className="p-4">
                {!customFeedbackMessage ? (
                  <>
                    <input
                      type="number"
                      value={customInputValue}
                      onChange={(e) => setCustomInputValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && mutationsReady) handleCustomSubmit(); }}
                      className="w-full p-2 rounded-lg bg-slate-800/80 text-slate-100 mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 border border-slate-600/60"
                      placeholder="0"
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={closeCustomInput} className="px-4 py-2 rounded-xl border border-slate-600/60 bg-slate-800/60 text-slate-200 hover:border-slate-400/70">Annulla</button>
                  <button onClick={handleCustomSubmit} disabled={!mutationsReady} className="px-4 py-2 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed">OK</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-slate-200 mb-4">{customFeedbackMessage}</p>
                    <div className="flex justify-end">
                      <button onClick={closeCustomInput} className="px-4 py-2 rounded-xl bg-gradient-to-br from-sky-600 to-blue-600 text-white shadow hover:opacity-95">Chiudi</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ),
        document.body
      )}

      {/* Barriera Activation Overlay */}
      {showBarrieraActivate && barrieraActionScopeKey === actionScopeKey && createPortal(
        (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="relative w-full max-w-md rounded-2xl border border-amber-500/30 bg-slate-900/95 shadow-2xl overflow-hidden">
              <div className="absolute -inset-0.5 bg-gradient-to-br from-amber-500/10 via-transparent to-yellow-400/10 pointer-events-none" />
              <div className="relative px-5 py-4 border-b border-slate-700/60 flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl flex items-center justify-center bg-amber-500/20 border border-amber-400/40 text-amber-300">
                  <GiShield className="w-5 h-5" />
                </div>
                <h2 className="text-base font-semibold text-amber-200 tracking-wide">Attiva Barriera</h2>
              </div>
              <div className="relative p-5 space-y-4">
                <p className="text-sm text-slate-300">Inserisci il valore totale della nuova barriera e la durata in turni.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Valore Barriera</label>
                    <input
                      type="number"
                      min="1"
                      value={barrieraActivateValue}
                      onChange={(e) => setBarrieraActivateValue(e.target.value)}
                      onKeyDown={(e)=>{ if(e.key === 'Enter' && mutationsReady) handleActivateBarriera(); }}
                      className="w-full p-2 rounded-lg bg-slate-800/80 text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500 border border-slate-600/60"
                      placeholder="0"
                    />
                    <div className="flex flex-wrap gap-2 mt-2">
                      {[5,10,15,20].map(v => (
                        <button key={v} onClick={()=> setBarrieraActivateValue(String(v))} className="px-2.5 py-1 text-xs rounded-lg bg-slate-800/60 border border-slate-600/60 text-slate-200 hover:border-amber-400/60 hover:text-amber-200 transition">{v}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Turni</label>
                    <input
                      type="number"
                      min="1"
                      value={barrieraActivateTurns}
                      onChange={(e) => setBarrieraActivateTurns(e.target.value)}
                      onKeyDown={(e)=>{ if(e.key === 'Enter' && mutationsReady) handleActivateBarriera(); }}
                      className="w-full p-2 rounded-lg bg-slate-800/80 text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500 border border-slate-600/60"
                      placeholder="0"
                    />
                    <div className="flex flex-wrap gap-2 mt-2">
                      {[1,2,3,5].map(v => (
                        <button key={v} onClick={()=> setBarrieraActivateTurns(String(v))} className="px-2.5 py-1 text-xs rounded-lg bg-slate-800/60 border border-slate-600/60 text-slate-200 hover:border-amber-400/60 hover:text-amber-200 transition">{v}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={()=>{ setShowBarrieraActivate(false); setBarrieraActionScopeKey(null); setBarrieraActivateValue(''); setBarrieraActivateTurns(''); }} className="px-4 py-2 rounded-xl border border-slate-600/60 bg-slate-800/60 text-slate-200 hover:border-slate-400/70">Annulla</button>
                  <button onClick={handleActivateBarriera} disabled={!mutationsReady || !barrieraActivateValue || !barrieraActivateTurns} className="px-4 py-2 rounded-xl bg-gradient-to-br from-amber-500 to-yellow-500 text-slate-900 font-medium shadow disabled:opacity-40 disabled:cursor-not-allowed">Attiva</button>
                </div>
              </div>
            </div>
          </div>
        ),
        document.body
      )}

      <div className="relative flex flex-col gap-4">
        {retryableGesture && (
          <button type="button" onClick={retryUnresolvedGesture} className="self-start text-xs text-amber-200 underline" aria-label="Retry saving resource change">
            Retry save
          </button>
        )}
        <div className="space-y-4">
          <StatRow
            label="HP"
            icon={GiHearts}
            colorTrack="bg-red-900/30"
            colorFill="bg-gradient-to-r from-red-500 to-rose-500"
            current={optimisticResourceValue('hp', userData?.stats?.hpCurrent)}
            total={userData?.stats?.hpTotal || 0}
            onReset={handleResetHP}
            onDecPointerDown={(event) => startGesture('hp', -1, event)}
            onDecPointerEnd={(event) => finalizeGesture(Number.isFinite(event.pointerId) && event.pointerId > 0 ? event.pointerId : activeGestureRef.current?.pointerId, event.type)}
            onDecKeyboard={(event) => keyboardGesture('hp', -1, event)}
            onIncPointerDown={(event) => startGesture('hp', 1, event)}
            onIncPointerEnd={(event) => finalizeGesture(Number.isFinite(event.pointerId) && event.pointerId > 0 ? event.pointerId : activeGestureRef.current?.pointerId, event.type)}
            onIncKeyboard={(event) => keyboardGesture('hp', 1, event)}
            onOpenDec={() => openCustomInput('hp-decrement')}
            onOpenInc={() => openCustomInput('hp-increment')}
            resetDisabled={!mutationsReady}
            decDisabled={!mutationsReady}
            incDisabled={!mutationsReady}
          />

          <StatRow
            label="Mana"
            icon={GiMagicSwirl}
            colorTrack="bg-indigo-900/30"
            colorFill="bg-gradient-to-r from-indigo-600 to-fuchsia-600"
            current={optimisticResourceValue('mana', userData?.stats?.manaCurrent)}
            total={userData?.stats?.manaTotal || 0}
            onReset={handleResetMana}
            onDecPointerDown={(event) => startGesture('mana', -1, event)}
            onDecPointerEnd={(event) => finalizeGesture(Number.isFinite(event.pointerId) && event.pointerId > 0 ? event.pointerId : activeGestureRef.current?.pointerId, event.type)}
            onDecKeyboard={(event) => keyboardGesture('mana', -1, event)}
            onIncPointerDown={(event) => startGesture('mana', 1, event)}
            onIncPointerEnd={(event) => finalizeGesture(Number.isFinite(event.pointerId) && event.pointerId > 0 ? event.pointerId : activeGestureRef.current?.pointerId, event.type)}
            onIncKeyboard={(event) => keyboardGesture('mana', 1, event)}
            onOpenDec={() => openCustomInput('mana-decrement')}
            onOpenInc={() => openCustomInput('mana-increment')}
            resetDisabled={!mutationsReady}
            decDisabled={!mutationsReady}
            incDisabled={!mutationsReady}
          />

          <StatRow
            label="Essenza"
            icon={FaDroplet}
            colorTrack="bg-teal-900/30"
            colorFill="bg-gradient-to-r from-teal-500 to-emerald-400"
            current={optimisticResourceValue('essenza', userData?.stats?.essenzaCurrent)}
            total={userData?.stats?.essenzaTotal || 0}
            onReset={handleResetEssenza}
            onDecPointerDown={(event) => startGesture('essenza', -1, event)}
            onDecPointerEnd={(event) => finalizeGesture(Number.isFinite(event.pointerId) && event.pointerId > 0 ? event.pointerId : activeGestureRef.current?.pointerId, event.type)}
            onDecKeyboard={(event) => keyboardGesture('essenza', -1, event)}
            onIncPointerDown={(event) => startGesture('essenza', 1, event)}
            onIncPointerEnd={(event) => finalizeGesture(Number.isFinite(event.pointerId) && event.pointerId > 0 ? event.pointerId : activeGestureRef.current?.pointerId, event.type)}
            onIncKeyboard={(event) => keyboardGesture('essenza', 1, event)}
            onOpenDec={() => openCustomInput('essenza-decrement')}
            onOpenInc={() => openCustomInput('essenza-increment')}
            resetDisabled={!mutationsReady}
            decDisabled={!mutationsReady}
            incDisabled={!mutationsReady}
          />

          <StatRow
            label="Barriera"
            icon={GiShield}
            colorTrack="bg-amber-900/30"
            colorFill="bg-gradient-to-r from-amber-500 to-yellow-500"
            colorFillInactive="bg-slate-700/40"
            current={optimisticResourceValue('barriera', barrierCurrent)}
            total={barrierTotal}
            onReset={handleResetBarriera}
            onDecPointerDown={(event) => startGesture('barriera', -1, event)}
            onDecPointerEnd={(event) => finalizeGesture(Number.isFinite(event.pointerId) && event.pointerId > 0 ? event.pointerId : activeGestureRef.current?.pointerId, event.type)}
            onDecKeyboard={(event) => keyboardGesture('barriera', -1, event)}
            onIncPointerDown={(event) => startGesture('barriera', 1, event)}
            onIncPointerEnd={(event) => finalizeGesture(Number.isFinite(event.pointerId) && event.pointerId > 0 ? event.pointerId : activeGestureRef.current?.pointerId, event.type)}
            onIncKeyboard={(event) => keyboardGesture('barriera', 1, event)}
            onOpenDec={() => openCustomInput('barriera-decrement')}
            onOpenInc={() => openCustomInput('barriera-increment')}
            onIconClick={mutationsReady ? () => { setBarrieraActionScopeKey(actionScopeKey); setShowBarrieraActivate(true); } : undefined}
            iconActive={barrierActive}
            resetTitle={barrierActive ? (barrierDepleted ? 'Rimuovi Barriera esaurita' : 'Termina Barriera') : 'Nessuna Barriera attiva'}
            resetIcon={FaBan}
            resetClassName={barrierActive ? 'bg-gradient-to-br from-rose-600 to-red-600 hover:scale-105 active:scale-95 focus:ring-red-400/40' : 'bg-slate-700/60'}
            resetDisabled={!mutationsReady || !barrierActive}
            decDisabled={!mutationsReady || barrierDepleted || !barrierActive}
            incDisabled={!mutationsReady || barrierDepleted || !barrierActive || barrierFull}
            incDisabledTitle={barrierIncDisabledTitle}
            decDisabledTitle={barrierDecDisabledTitle}
          />
          {/* Thin turns bar under barrier when active and turns tracked */}
          {barrierActive && barrierTurnsTotal > 0 && (
            <div className="-mt-3 mb-2 px-[4.5rem]">{/* align under main bar content (approx padding to start of bar) */}
              <div className="h-2 rounded-md bg-slate-700/40 overflow-hidden relative border border-slate-600/40">
                <div
                  className="h-full bg-gradient-to-r from-amber-400 via-yellow-400 to-yellow-300 transition-all duration-300"
                  style={{ width: `${Math.min(100, (barrierTurnsRemaining / barrierTurnsTotal) * 100)}%` }}
                />
                <div className="absolute inset-0 text-[10px] leading-4 font-medium text-slate-900/90 flex items-center justify-center pointer-events-none select-none">
                  <span className="px-1 rounded bg-amber-300/70 text-slate-900 tracking-wide">
                    {barrierTurnsRemaining}/{barrierTurnsTotal} turni
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StatsBars;
