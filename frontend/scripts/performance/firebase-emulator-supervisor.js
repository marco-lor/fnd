#!/usr/bin/env node

const childProcess = require('node:child_process');

const FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE = 'fnd-performance-emulator-shutdown-request';
const FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE = 'fnd-performance-emulator-shutdown-ack';
const OWNED_SUPERVISOR_TREE_TERMINATION_TIMEOUT_MS = 10 * 1000;
const OWNED_SUPERVISOR_ROOT_RETENTION_INTERVAL_MS = 60 * 1000;

const sendMessage = (processImpl, message, { onDeliveryFailure } = {}) => {
  if (typeof processImpl.send !== 'function' || processImpl.connected === false) return false;
  try {
    processImpl.send(message, (error) => {
      if (error) onDeliveryFailure?.(error);
    });
    return true;
  } catch (error) {
    onDeliveryFailure?.(error);
    return false;
  }
};

const retainExactSupervisorRootOwnership = ({
  processImpl = process,
  rootPid = processImpl?.pid,
  reason = 'exact-tree-termination-failed',
  diagnostic = 'exact-tree termination did not complete',
  setIntervalImpl = setInterval,
  retentionIntervalMs = OWNED_SUPERVISOR_ROOT_RETENTION_INTERVAL_MS,
} = {}) => {
  processImpl.exitCode = 1;
  const retainer = setIntervalImpl(() => {}, retentionIntervalMs);
  retainer.ref?.();
  return { diagnostic, reason, retainer, rootPid };
};

const requestOwnedWindowsSupervisorTreeTermination = ({
  platform = process.platform,
  processImpl = process,
  reason = 'firebase-cli-shutdown-unavailable',
  spawnImpl = childProcess.spawn,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  timeoutMs = OWNED_SUPERVISOR_TREE_TERMINATION_TIMEOUT_MS,
  writeDiagnosticImpl = (diagnostic) => processImpl.stderr?.write(`${diagnostic}\n`),
  retainExactRootOwnershipImpl = retainExactSupervisorRootOwnership,
} = {}) => {
  if (platform !== 'win32') {
    throw new Error(`Windows exact-tree taskkill fallback is unavailable on ${platform}.`);
  }
  if (!Number.isInteger(processImpl?.pid) || processImpl.pid <= 0) {
    throw new Error('Firebase emulator supervisor PID is unavailable for exact-tree termination.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Firebase emulator supervisor tree-termination timeout must be positive.');
  }
  const rootPid = processImpl.pid;
  const command = 'taskkill.exe';
  const args = ['/PID', String(rootPid), '/T', '/F'];
  const options = {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  };
  let helper = null;
  let timer = null;
  let settled = false;

  const writeDiagnostic = (diagnostic) => {
    try {
      writeDiagnosticImpl(
        `[firebase-emulator-supervisor] ${diagnostic}; rootPid=${rootPid}; reason=${reason}`
      );
    } catch (_error) {
      // Diagnostics must never prevent the exact-tree fallback or terminal exit.
    }
  };
  const releaseOwnedHelper = ({ terminate = false } = {}) => {
    if (!helper) return '';
    helper.removeListener?.('error', handleHelperError);
    helper.removeListener?.('exit', handleHelperExit);
    let cleanupDiagnostic = '';
    if (terminate && typeof helper.kill === 'function') {
      try {
        if (helper.kill() === false) {
          cleanupDiagnostic = '; exact taskkill helper termination was not confirmed';
        }
      } catch (error) {
        cleanupDiagnostic = `; exact taskkill helper termination failed: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    }
    helper.unref?.();
    return cleanupDiagnostic;
  };
  const retainRootAfterFailure = (diagnostic, { terminateHelper = false } = {}) => {
    if (settled) return;
    settled = true;
    if (timer !== null) clearTimeoutImpl(timer);
    diagnostic += releaseOwnedHelper({ terminate: terminateHelper });
    processImpl.exitCode = 1;
    const ownership = {
      diagnostic,
      processImpl,
      reason,
      rootPid,
    };
    writeDiagnostic(`${diagnostic}; retaining exact supervisor root ownership`);
    retainExactRootOwnershipImpl(ownership);
  };
  const handleHelperError = (error) => retainRootAfterFailure(
    `taskkill failed: ${error instanceof Error ? error.message : String(error)}`,
    { terminateHelper: true }
  );
  const handleHelperExit = (code, signal) => retainRootAfterFailure(
    `taskkill exited with code ${code === null ? 'null' : code}`
    + `${signal ? ` and signal ${signal}` : ''} while the supervisor remained alive`
  );

  writeDiagnostic('launching bounded exact-tree taskkill fallback');
  timer = setTimeoutImpl(() => retainRootAfterFailure(
    `taskkill did not terminate rootPid=${rootPid} within ${timeoutMs} ms`,
    { terminateHelper: true }
  ), timeoutMs);
  timer.ref?.();

  try {
    helper = spawnImpl(command, args, options);
  } catch (error) {
    retainRootAfterFailure(
      `taskkill launch failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return { command, args, rootPid, timeoutMs };
  }
  if (!helper || typeof helper.once !== 'function') {
    retainRootAfterFailure(
      'taskkill launch returned no observable child process',
      { terminateHelper: true }
    );
    return { command, args, rootPid, timeoutMs };
  }
  helper.once('error', handleHelperError);
  helper.once('exit', handleHelperExit);
  helper.ref?.();
  return { command, args, rootPid, timeoutMs };
};

const requestOwnedPosixSupervisorProcessGroupTermination = ({
  platform = process.platform,
  processImpl = process,
  reason = 'firebase-cli-shutdown-unavailable',
  killImpl = process.kill,
  writeDiagnosticImpl = (diagnostic) => processImpl.stderr?.write(`${diagnostic}\n`),
  retainExactRootOwnershipImpl = retainExactSupervisorRootOwnership,
} = {}) => {
  if (platform === 'win32') {
    throw new Error('POSIX exact process-group fallback is unavailable on win32.');
  }
  if (!Number.isInteger(processImpl?.pid) || processImpl.pid <= 0) {
    throw new Error('Firebase emulator supervisor PID is unavailable for exact process-group termination.');
  }

  const rootPid = processImpl.pid;
  const signal = 'SIGKILL';
  const writeDiagnostic = (diagnostic) => {
    try {
      writeDiagnosticImpl(
        `[firebase-emulator-supervisor] ${diagnostic}; rootPid=${rootPid}; reason=${reason}`
      );
    } catch (_error) {
      // Diagnostics must never prevent exact process-group termination or root retention.
    }
  };

  writeDiagnostic(`signalling exact owned process group ${rootPid} with ${signal}`);
  try {
    killImpl(-rootPid, signal);
  } catch (error) {
    const diagnostic = `process-group termination failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
    processImpl.exitCode = 1;
    writeDiagnostic(`${diagnostic}; retaining exact supervisor root ownership`);
    retainExactRootOwnershipImpl({
      diagnostic,
      processImpl,
      reason,
      rootPid,
    });
  }
  return { processGroupId: rootPid, signal };
};

const requestOwnedSupervisorTreeTermination = ({
  platform = process.platform,
  windowsTerminationImpl = requestOwnedWindowsSupervisorTreeTermination,
  posixTerminationImpl = requestOwnedPosixSupervisorProcessGroupTermination,
  ...options
} = {}) => (
  platform === 'win32'
    ? windowsTerminationImpl({ ...options, platform })
    : posixTerminationImpl({ ...options, platform })
);

const runFirebaseEmulatorSupervisor = ({
  argv = process.argv,
  processImpl = process,
  requireImpl = require,
  terminateOwnedTreeImpl = requestOwnedSupervisorTreeTermination,
  retainExactRootOwnershipImpl = retainExactSupervisorRootOwnership,
} = {}) => {
  const [firebaseCli, ...firebaseArguments] = argv.slice(2);
  if (!firebaseCli || !firebaseArguments.length) {
    throw new Error('Firebase emulator supervisor requires a Firebase CLI entrypoint and arguments.');
  }

  let shutdownRequested = false;
  let parentDisconnected = processImpl.connected === false;
  let initializationComplete = false;
  let parentDisconnectResult = null;
  let terminalFallbackRequested = false;
  let rejectedShutdownReason = null;

  const removeSupervisorListeners = () => {
    processImpl.removeListener('message', handleParentMessage);
    processImpl.removeListener('disconnect', handleParentDisconnect);
  };

  const requestTerminalFallback = (reason) => {
    if (terminalFallbackRequested) return;
    terminalFallbackRequested = true;
    removeSupervisorListeners();
    try {
      terminateOwnedTreeImpl({ processImpl, reason });
    } catch (error) {
      const diagnostic = `exact-tree fallback failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      try {
        processImpl.stderr?.write(`[firebase-emulator-supervisor] ${diagnostic}; retaining exact supervisor root ownership\n`);
      } catch (_diagnosticError) {
        // Root retention remains authoritative even if diagnostics cannot be written.
      }
      processImpl.exitCode = 1;
      retainExactRootOwnershipImpl({
        diagnostic,
        processImpl,
        reason,
        rootPid: processImpl.pid,
      });
    }
  };

  const requestFirebaseCliShutdown = () => {
    if (shutdownRequested) {
      return { accepted: false, reason: 'duplicate-request' };
    }

    const signalHandlers = processImpl.listeners('SIGINT').length;
    if (signalHandlers === 0) {
      return { accepted: false, reason: 'firebase-cli-sigint-handler-missing' };
    }

    shutdownRequested = true;
    try {
      const emitted = processImpl.emit('SIGINT');
      if (!emitted) throw new Error('Firebase CLI SIGINT handler did not accept the shutdown event.');
      processImpl.removeListener('disconnect', handleParentDisconnect);
      return { accepted: true, handler: 'firebase-cli-sigint' };
    } catch (error) {
      rejectedShutdownReason = error instanceof Error ? error.message : String(error);
      return {
        accepted: false,
        reason: rejectedShutdownReason,
      };
    }
  };

  const handleParentMessage = (message) => {
    if (message?.type !== FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE) return;
    const requestId = typeof message.requestId === 'string' ? message.requestId : '';
    if (!requestId) {
      sendMessage(processImpl, {
        type: FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
        requestId,
        accepted: false,
        reason: 'invalid-request',
      });
      return;
    }

    const shutdownResult = requestFirebaseCliShutdown();
    const acknowledgement = {
      type: FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
      requestId,
      ...shutdownResult,
    };
    const fallbackReason = rejectedShutdownReason ?? shutdownResult.reason;
    const childOwnsFailedDelivery = shutdownResult.accepted !== true
      && !(shutdownResult.reason === 'duplicate-request' && rejectedShutdownReason === null);
    const delivered = sendMessage(processImpl, acknowledgement, {
      onDeliveryFailure: childOwnsFailedDelivery
        ? () => requestTerminalFallback(fallbackReason)
        : undefined,
    });
    if (!delivered && childOwnsFailedDelivery) {
      requestTerminalFallback(fallbackReason);
    }
  };

  function handleParentDisconnect() {
    parentDisconnected = true;
    parentDisconnectResult = shutdownRequested && rejectedShutdownReason !== null
      ? { accepted: false, reason: rejectedShutdownReason }
      : requestFirebaseCliShutdown();
    if (initializationComplete && parentDisconnectResult.accepted !== true) {
      requestTerminalFallback(parentDisconnectResult.reason);
    }
  }

  processImpl.on('message', handleParentMessage);
  processImpl.on('disconnect', handleParentDisconnect);

  processImpl.argv = [argv[0], firebaseCli, ...firebaseArguments];
  try {
    requireImpl(firebaseCli);
  } catch (error) {
    removeSupervisorListeners();
    throw error;
  }

  initializationComplete = true;
  if (parentDisconnected && parentDisconnectResult?.accepted !== true) {
    if (
      parentDisconnectResult === null
      || parentDisconnectResult.reason === 'firebase-cli-sigint-handler-missing'
    ) {
      parentDisconnectResult = requestFirebaseCliShutdown();
    }
    if (parentDisconnectResult.accepted !== true) {
      requestTerminalFallback(parentDisconnectResult.reason);
    }
  }
};

if (require.main === module) {
  try {
    runFirebaseEmulatorSupervisor();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  FIREBASE_EMULATOR_SHUTDOWN_ACK_TYPE,
  FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,
  OWNED_SUPERVISOR_ROOT_RETENTION_INTERVAL_MS,
  OWNED_SUPERVISOR_TREE_TERMINATION_TIMEOUT_MS,
  requestOwnedPosixSupervisorProcessGroupTermination,
  requestOwnedSupervisorTreeTermination,
  requestOwnedWindowsSupervisorTreeTermination,
  retainExactSupervisorRootOwnership,
  runFirebaseEmulatorSupervisor,
};
