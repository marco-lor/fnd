#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { resultsDir } = require('./common');

const editorModules = ['addWeapon', 'addArmatura', 'addAccessorio', 'addConsumabile', 'editorForm'];
const flatten = modules => (modules || []).flatMap(module => [module, ...flatten(module.modules)]);
function assertBazaarEditorBundle(stats) {
  const playerGroups = ['app-shell', 'feature-authenticated-layout', 'route-bazaar'].map(name => {
    const group = stats.namedChunkGroups?.[name];
    assert(group?.chunks?.length, `Missing ordinary player chunk group ${name}`);
    return group;
  });
  const playerChunks = new Set([...playerGroups.flatMap(group => group.chunks), ...(stats.chunks || []).filter(chunk => chunk.initial).map(chunk => chunk.id)]);
  const found = new Set();
  for (const chunk of stats.chunks || []) {
    for (const module of flatten(chunk.modules)) {
      const name = String(module.name || module.identifier || '').replace(/\\/g, '/');
      for (const editor of editorModules) {
        if (!name.includes(`/bazaar/elements/${editor}.js`)) continue;
        found.add(editor);
        assert(!playerChunks.has(chunk.id), `${editor} leaked into player chunk ${chunk.id}`);
      }
    }
  }
  assert.deepEqual([...found].sort(), [...editorModules].sort(), 'Incomplete editor module graph');
  return { playerChunks: [...playerChunks], excludedEditorModules: [...found].sort() };
}
if (require.main === module) {
  const statsPath = process.argv[2] || path.join(resultsDir, 'webpack-stats.json');
  const result = assertBazaarEditorBundle(JSON.parse(fs.readFileSync(statsPath, 'utf8')));
  console.log(`Bazaar editor bundle boundary verified: ${JSON.stringify(result)}`);
}
module.exports = { assertBazaarEditorBundle };
