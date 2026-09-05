const childProcess = require('node:child_process');

const {
  requestOwnedWindowsSupervisorTreeTermination,
} = require('./firebase-emulator-supervisor');

const probeMode = process.argv[2] || 'helper-exit';
const helperDelayMs = Number(process.argv[3] || 750);
const timeoutMs = Number(process.argv[4] || 5_000);
const startedAt = Date.now();
let helper = null;

const isExactProcessAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
};

const finishAfterOwnedHelperIsGone = ({ diagnostic }) => {
  const checker = setInterval(() => {
    if (isExactProcessAlive(helper.pid)) return;
    clearInterval(checker);
    process.stdout.write(`FALLBACK_${probeMode === 'deadline' ? 'DEADLINE' : 'HELPER_ERROR'} ${JSON.stringify({
      settlement: probeMode,
      diagnostic,
      elapsedMs: Date.now() - startedAt,
      helperPid: helper.pid,
      helperGone: true,
    })}\n`);
    process.exit(probeMode === 'deadline' ? 24 : 25);
  }, 10);
};

requestOwnedWindowsSupervisorTreeTermination({
  platform: 'win32',
  reason: 'controlled-liveness-probe',
  timeoutMs,
  spawnImpl: (_command, _args, options) => {
    helper = childProcess.spawn(
      process.execPath,
      ['-e', `setTimeout(() => process.exit(0), ${helperDelayMs})`],
      options
    );
    if (probeMode === 'helper-error') {
      setImmediate(() => helper.emit('error', new Error('controlled async helper failure')));
    }
    return helper;
  },
  retainExactRootOwnershipImpl: ({ diagnostic }) => {
    if (probeMode !== 'helper-exit') {
      finishAfterOwnedHelperIsGone({ diagnostic });
      return;
    }
    process.stdout.write(`FALLBACK_LIVENESS ${JSON.stringify({
      settlement: 'helper-exit',
      diagnostic,
      elapsedMs: Date.now() - startedAt,
    })}\n`);
    process.exit(23);
  },
});
