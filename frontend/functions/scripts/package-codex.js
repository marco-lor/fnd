'use strict';
// The deployed package must not read the sibling frontend source at runtime.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const [source, destination] of [
  ['../src/data/codexModel.js', 'lib/codexModel.js'],
  ['src/codexCore.js', 'lib/codexCore.js'],
]) {
  const bytes = fs.readFileSync(path.resolve(root, source));
  fs.writeFileSync(path.join(root, destination), bytes);
  if (!bytes.equals(fs.readFileSync(path.join(root, destination)))) throw Error('Codex package parity failure.');
}
