const childProcess = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');

const [mode, statePath, portValue] = process.argv.slice(2);
const port = Number(portValue);

if (!['no-handler', 'throwing-handler'].includes(mode)) {
  throw new Error(`Unsupported supervisor probe mode: ${mode}`);
}
if (!statePath || !Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error('Supervisor probe requires an owned state path and loopback port.');
}

if (mode === 'throwing-handler') {
  process.on('SIGINT', () => {
    throw new Error('controlled Firebase CLI SIGINT failure');
  });
}

const descendantSource = [
  "const fs = require('node:fs');",
  "const net = require('node:net');",
  'const [statePath, portValue, mode] = process.argv.slice(1);',
  'const port = Number(portValue);',
  "const server = net.createServer(() => {});",
  "server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {",
  '  fs.writeFileSync(statePath, JSON.stringify({',
  '    mode,',
  '    supervisorPid: process.ppid,',
  '    descendantPid: process.pid,',
  '    port,',
  "    ready: true,",
  "  }) + '\\n', 'utf8');",
  '});',
  "setInterval(() => {}, 1000);",
].join('\n');

const descendant = childProcess.spawn(
  process.execPath,
  ['-e', descendantSource, statePath, String(port), mode],
  {
    stdio: 'ignore',
    windowsHide: true,
  }
);

descendant.once('error', (error) => {
  fs.writeFileSync(statePath, JSON.stringify({
    mode,
    supervisorPid: process.pid,
    descendantPid: descendant.pid || null,
    port,
    ready: false,
    error: error.message,
  }) + '\n', 'utf8');
});
