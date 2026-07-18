#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { frontendRoot, resolvePortableJavaHome } = require('./common');

const skipJava = process.argv.includes('--skip-java');
const skipBrowser = process.argv.includes('--skip-browser');
const problems = [];

const majorVersion = (versionText) => Number(String(versionText).match(/(\d+)/)?.[1] || 0);

if (majorVersion(process.versions.node) < 22) {
  problems.push(`Node 22+ is required; found ${process.versions.node}.`);
}

if (!skipJava) {
  const portableJavaHome = resolvePortableJavaHome();
  const javaExecutable = portableJavaHome
    ? path.join(portableJavaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java';
  const java = childProcess.spawnSync(javaExecutable, ['-version'], { encoding: 'utf8', shell: false });
  const javaOutput = `${java.stdout || ''}\n${java.stderr || ''}`;
  if (java.error || java.status !== 0) {
    problems.push('Java 21+ is required for the Firestore emulator, but java was not found.');
  } else if (majorVersion(javaOutput.replace(/^java version ["']1\./, '')) < 21) {
    problems.push(`Java 21+ is required for the Firestore emulator; found: ${javaOutput.trim().split(/\r?\n/)[0]}.`);
  }
}

const firebaseCli = path.join(frontendRoot, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
if (!fs.existsSync(firebaseCli)) {
  problems.push('firebase-tools is not installed. Run npm install in frontend/.');
}

if (!skipBrowser) {
  try {
    const { chromium } = require('@playwright/test');
    if (!fs.existsSync(chromium.executablePath())) {
      problems.push('Playwright Chromium is missing. Run: npx playwright install chromium');
    }
  } catch (error) {
    problems.push(`Playwright is not installed: ${error.message}`);
  }
}

if (problems.length) {
  console.error('Performance preflight failed:');
  problems.forEach((problem) => console.error(` - ${problem}`));
  process.exit(1);
}

console.log(`Performance preflight passed (Node ${process.versions.node}${resolvePortableJavaHome() ? ', portable Java 21+' : ''}).`);
