const {spawnSync} = require('node:child_process');

const playwrightCli = require.resolve('@playwright/test/cli');
const result = spawnSync(process.execPath, [
  playwrightCli,
  'test',
  '--config',
  'performance/playwright.config.js',
  '--project',
  'task07-chromium',
  '--workers',
  '1',
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    FND_TASK07_MEDIA_INTEGRATION: '1',
    JAVA_TOOL_OPTIONS: process.env.JAVA_TOOL_OPTIONS || '-Xmx512m',
    NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=768',
  },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = Number.isInteger(result.status) ? result.status : 1;
