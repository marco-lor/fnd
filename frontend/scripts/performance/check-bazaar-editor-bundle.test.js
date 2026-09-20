const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { assertBazaarEditorBundle } = require('./check-bazaar-editor-bundle');
const fixture = () => ({namedChunkGroups: {'app-shell': {chunks: [5]}, 'feature-authenticated-layout': {chunks: [6]}, 'route-bazaar': {chunks: [2, 3]}}, chunks: [
 {id: 1, initial: true, modules: [{name: './src/App.js'}]},
 {id: 2, modules: [{name: './src/components/bazaar/Bazaar.js'}]},
 {id: 3, modules: []}, {id: 5, modules: []}, {id: 6, modules: []},
 {id: 4, modules: [{name: 'concatenated', modules: ['addWeapon', 'addArmatura', 'addAccessorio', 'addConsumabile', 'editorForm'].map(name => ({name: `./src/components/bazaar/elements/${name}.js`}))}]}
]});
test('built graph keeps all editor implementations out of initial and Bazaar dependency chunks', () => {
 assert.equal(assertBazaarEditorBundle(fixture()).excludedEditorModules.length, 5);
 for (const chunkId of [1, 2, 3, 5, 6]) {
  const graph = fixture(); graph.chunks.find(chunk => chunk.id === chunkId).modules.push({modules: [{name: './src/components/bazaar/elements/addWeapon.js'}]});
  assert.throws(() => assertBazaarEditorBundle(graph), /leaked/);
 }
 const incomplete = fixture(); incomplete.chunks.pop(); assert.throws(() => assertBazaarEditorBundle(incomplete), /Incomplete/);
});
test('all four adapter imports remain dynamic in the Bazaar boundary', () => {
 const source = fs.readFileSync(path.resolve(__dirname, '../../src/components/bazaar/lazyBazaarEditors.js'), 'utf8');
 for (const type of ['Weapon', 'Armatura', 'Accessorio', 'Consumabile']) {
  assert.match(source, new RegExp(`import\\([\\s\\S]*?['"]\\./elements/add${type}['"]\\)`));
 }
});
