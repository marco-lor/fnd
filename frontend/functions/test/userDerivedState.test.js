const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  classifyUserDerivedChange,
  planUserDerivedState,
  resolveTask06BackendConfig,
  resolveTask06DerivedOwnerMode,
} = require('../lib/userDerivedState');

const applyDottedUpdate = (source, update) => {
  const result = structuredClone(source);
  Object.entries(update).forEach(([field, value]) => {
    const parts = field.split('.');
    let target = result;
    parts.slice(0, -1).forEach((part) => {
      if (!target[part] || typeof target[part] !== 'object') {
        target[part] = {};
      }
      target = target[part];
    });
    target[parts.at(-1)] = value;
  });
  return result;
};

const hasUndefined = (value) => {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(hasUndefined);
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(hasUndefined);
};

test('Task 06 owner config fails safely to legacy mode', () => {
  assert.deepEqual(resolveTask06BackendConfig(undefined), {
    schemaVersion: 1,
    derivedOwnerMode: 'legacy',
    enabledOperationKinds: [],
  });
  assert.equal(resolveTask06DerivedOwnerMode({
    schemaVersion: 2,
    derivedOwnerMode: 'authoritative',
    enabledOperationKinds: [],
  }), 'legacy');
  assert.deepEqual(resolveTask06BackendConfig({
    schemaVersion: 1,
    derivedOwnerMode: 'shadow',
    enabledOperationKinds: ['level-up-all'],
  }), {
    schemaVersion: 1,
    derivedOwnerMode: 'shadow',
    enabledOperationKinds: ['level-up-all'],
  });
});

test('plans Anima, totals, resources, and barrier in dependency order', () => {
  const before = {
    characterId: 'Hero',
    role: 'player',
    stats: {
      level: 3,
      hpTotal: 1,
      manaTotal: 2,
      barrieraCurrent: 9,
      barrieraTotal: 10,
    },
    AltriParametri: {},
    Parametri: {
      Base: {
        Forza: {Base: 2, Anima: 0, Equip: 1, Mod: 0, Tot: 3},
      },
      Combattimento: {
        Salute: {Base: 3, Anima: 0, Equip: 1, Mod: 0, Tot: 4},
        Disciplina: {Base: 2, Anima: 0, Equip: 0, Mod: 0, Tot: 2},
      },
      Special: {
        Fortuna: {Base: 1, Anima: 0, Equip: 0, Mod: 2, Tot: 99},
      },
    },
    active_turn_effect: {
      barriera: {remainingTurns: 1, totalTurns: 2},
    },
  };
  const after = structuredClone(before);
  after.stats.level = 4;
  after.AltriParametri = {Anima_1: 'Lupo'};
  after.active_turn_effect.barriera.remainingTurns = 0;

  const plan = planUserDerivedState({
    beforeData: before,
    afterData: after,
    utils: {
      modAnima: {Lupo: {Forza: 2}},
      levelUpAnimaBonus: {
        Lupo: {Salute: 1, Disciplina: 2},
      },
      hpMultByLevel: {'4': 6},
      manaMultByLevel: {'4': 8},
    },
  });

  assert.equal(plan.classification.needsUtils, true);
  assert.deepEqual(plan.directoryMutation, {type: 'none'});
  assert.deepEqual(plan.rootUpdate, {
    'Parametri.Base.Forza.Anima': 2,
    'Parametri.Base.Forza.Tot': 5,
    'Parametri.Combattimento.Salute.Anima': 3,
    'Parametri.Combattimento.Salute.Tot': 7,
    'Parametri.Combattimento.Disciplina.Anima': 6,
    'Parametri.Combattimento.Disciplina.Tot': 8,
    'Parametri.Special.Fortuna.Tot': 3,
    'stats.hpTotal': 50,
    'stats.manaTotal': 69,
    'stats.barrieraCurrent': 0,
    'stats.barrieraTotal': 0,
    'active_turn_effect.barriera.totalTurns': 0,
  });
  assert.equal(hasUndefined(plan.rootUpdate), false);
  assert.equal(Object.hasOwn(plan.rootUpdate, 'Parametri'), false);
});

test('derived follow-up event is a zero-write no-op', () => {
  const before = {
    stats: {level: 3, hpTotal: 1, manaTotal: 2},
    AltriParametri: {},
    Parametri: {
      Base: {Forza: {Base: 2, Anima: 0, Tot: 2}},
      Combattimento: {
        Salute: {Base: 3, Anima: 0, Tot: 3},
        Disciplina: {Base: 2, Anima: 0, Tot: 2},
      },
    },
  };
  const after = structuredClone(before);
  after.stats.level = 4;
  after.AltriParametri = {Anima_1: 'Lupo'};
  const utils = {
    modAnima: {Lupo: {Forza: 2}},
    levelUpAnimaBonus: {Lupo: {Salute: 1, Disciplina: 2}},
    hpMultByLevel: {'4': 6},
    manaMultByLevel: {'4': 8},
  };
  const first = planUserDerivedState({
    beforeData: before,
    afterData: after,
    utils,
  });
  const derived = applyDottedUpdate(after, first.rootUpdate);
  const followUp = planUserDerivedState({
    beforeData: after,
    afterData: derived,
    utils,
  });

  assert.ok(Object.keys(first.rootUpdate).length > 0);
  assert.deepEqual(followUp.rootUpdate, {});
  assert.deepEqual(followUp.directoryMutation, {type: 'none'});
});

test('partial parameter maps produce defined leaf patches only', () => {
  const before = {
    stats: {level: 1},
    Parametri: {
      Base: {Forza: {Base: 1, Mod: 0, Tot: 1}},
    },
  };
  const after = structuredClone(before);
  after.Parametri.Base.Forza.Base = 2;

  const plan = planUserDerivedState({
    beforeData: before,
    afterData: after,
  });

  assert.equal(plan.classification.needsUtils, false);
  assert.deepEqual(plan.rootUpdate, {
    'Parametri.Base.Forza.Tot': 2,
  });
  assert.equal(
    Object.keys(plan.rootUpdate).some((field) => (
      field.includes('Combattimento') || field.includes('Special')
    )),
    false
  );
  assert.equal(hasUndefined(plan.rootUpdate), false);
});

test('missing utils use legacy resource defaults and preserve zero skips', () => {
  const before = {
    stats: {level: 2, hpTotal: 0, manaTotal: 0},
    Parametri: {
      Combattimento: {
        Salute: {Base: 1, Tot: 1},
        Disciplina: {Base: 1, Tot: 1},
      },
    },
  };
  const after = structuredClone(before);
  after.Parametri.Combattimento.Salute.Base = 2;
  const defaulted = planUserDerivedState({
    beforeData: before,
    afterData: after,
  });
  assert.deepEqual(defaulted.rootUpdate, {
    'Parametri.Combattimento.Salute.Tot': 2,
    'stats.hpTotal': 18,
    'stats.manaTotal': 12,
  });

  const zero = structuredClone(before);
  zero.Parametri.Combattimento.Salute.Base = 0;
  const zeroPlan = planUserDerivedState({
    beforeData: before,
    afterData: zero,
  });
  assert.equal(
    Object.hasOwn(zeroPlan.rootUpdate, 'stats.hpTotal'),
    false
  );
  assert.equal(
    zeroPlan.rootUpdate['Parametri.Combattimento.Salute.Tot'],
    0
  );
});

test('Anima level bonuses stay capped at their legacy level bands', () => {
  const after = {
    stats: {level: 12, hpTotal: 0},
    AltriParametri: {
      Anima_1: 'Prima',
      Anima_4: 'Seconda',
      Anima_7: 'Terza',
    },
    Parametri: {
      Base: {Forza: {Base: 0, Anima: 0, Tot: 0}},
      Combattimento: {
        Salute: {Base: 1, Anima: 0, Tot: 1},
      },
    },
  };
  const before = structuredClone(after);
  before.stats.level = 11;
  const plan = planUserDerivedState({
    beforeData: before,
    afterData: after,
    utils: {
      modAnima: {
        Prima: {Forza: 1},
        Seconda: {Forza: 1},
        Terza: {Forza: 1},
      },
      levelUpAnimaBonus: {
        Prima: {Salute: 1},
        Seconda: {Salute: 1},
        Terza: {Salute: 1},
      },
    },
  });

  assert.equal(plan.rootUpdate['Parametri.Base.Forza.Anima'], 3);
  assert.equal(
    plan.rootUpdate['Parametri.Combattimento.Salute.Anima'],
    9
  );
  assert.equal(plan.rootUpdate['stats.hpTotal'], 58);
});

test('irrelevant resource updates skip utils and derived writes', () => {
  const before = {
    stats: {level: 2, hpCurrent: 4},
    Parametri: {
      Combattimento: {Salute: {Base: 3, Tot: 3}},
    },
  };
  const after = structuredClone(before);
  after.stats.hpCurrent = 2;

  const classification = classifyUserDerivedChange(before, after);
  const plan = planUserDerivedState({
    beforeData: before,
    afterData: after,
  });

  assert.equal(classification.sourceChanged, true);
  assert.equal(classification.needsUtils, false);
  assert.deepEqual(plan.rootUpdate, {});
});

test('directory changes retain exact privacy and deletion semantics', () => {
  const rename = planUserDerivedState({
    beforeData: {characterId: 'Old', role: 'player'},
    afterData: {
      characterId: 'New',
      role: 'dm',
      email: 'private@example.test',
      inventory: [{secret: true}],
    },
  });
  assert.deepEqual(rename.directoryMutation, {
    type: 'set',
    projection: {
      schemaVersion: 1,
      characterId: 'New',
      label: 'New',
      normalizedLabel: 'new',
      role: 'dm',
    },
  });

  const deletion = planUserDerivedState({
    beforeData: {characterId: 'New', role: 'dm'},
    afterData: null,
  });
  assert.deepEqual(deletion.rootUpdate, {});
  assert.deepEqual(deletion.directoryMutation, {type: 'delete'});
});

test('legacy handlers and consolidated owner share explicit fences', () => {
  const source = (name) => fs.readFileSync(
    path.join(__dirname, '..', 'src', name),
    'utf8'
  );
  assert.match(
    source('legacyRootMutationGate.ts'),
    /resolveTask06DerivedOwnerMode\(task06Config\.data\(\)\)/
  );
  assert.match(
    source('syncUserDirectory.ts'),
    /resolveTask06DerivedOwnerMode\(task06Config\.data\(\)\)/
  );
  assert.match(
    source('syncUserDerivedState.ts'),
    /legacyRootMutationBlockReason\(/
  );
  assert.match(
    source('syncUserDerivedState.ts'),
    /reconcileLegacyUserDomains\(/
  );
});
