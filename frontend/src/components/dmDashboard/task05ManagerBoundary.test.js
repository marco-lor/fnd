import fs from 'fs';
import path from 'path';

const OWNED_COMPONENTS = [
  'DMDashboard.js',
  'elements/LockSettingsTable.js',
  'elements/playerInfo.js',
  'elements/buttons/addConoscenzaPersonale.js',
  'elements/buttons/addLinguaPersonale.js',
  'elements/buttons/addProfessionePersonale.js',
  'elements/buttons/delConoscenzaPersonale.js',
  'elements/buttons/delLinguaPersonale.js',
  'elements/buttons/delProfessionePersonale.js',
  'elements/buttons/editConoscenzaPersonale.js',
  'elements/buttons/editProfessionePersonale.js',
  'elements/buttons/addSpell.js',
  'elements/buttons/editSpell.js',
  'elements/buttons/delSpell.js',
  'elements/buttons/addTecnicaPersonale.js',
  'elements/buttons/editTecnicaPersonale.js',
  'elements/buttons/delTecnicaPersonale.js',
];

describe('DM dashboard Task05 boundary', () => {
  test.each(OWNED_COMPONENTS)('%s does not access a root users aggregate', (relativePath) => {
    const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
    expect(source).not.toMatch(
      /\b(?:collection|doc)\s*\(\s*db\s*,\s*["']users["']/
    );
  });
});
