import {
  buildDestrezzaInitiativeRollConfig,
  buildParameterRollConfig,
  formatParameterFormula,
  parseDiceFaces,
  resolveAnimaDieLabel,
  resolveBaseParameterTotal,
} from './initiativeDice';

describe('Grigliata initiative dice', () => {
  test('resolves Anima dice from array and object level mappings', () => {
    expect(resolveAnimaDieLabel([null, 'd4', 'd6'], 2)).toBe('d6');
    expect(resolveAnimaDieLabel({ 3: 'd8' }, 3)).toBe('d8');
    expect(resolveAnimaDieLabel([null, 'd4'], 0)).toBe('');
  });

  test('parses valid dice labels and rejects malformed dice', () => {
    expect(parseDiceFaces(' d10 ')).toBe(10);
    expect(parseDiceFaces('10')).toBe(0);
    expect(parseDiceFaces('d0')).toBe(0);
  });

  test('finds Destrezza case-insensitively and preserves assigned zero', () => {
    expect(resolveBaseParameterTotal({ Base: { DESTREZZA: { Tot: 0 } } }, 'Destrezza')).toBe(0);
    expect(resolveBaseParameterTotal({ Base: { destrezza: { Tot: '-2' } } }, 'Destrezza')).toBe(-2);
  });

  test('rejects missing, blank, non-numeric, and fractional initiative modifiers', () => {
    expect(buildDestrezzaInitiativeRollConfig({ Parametri: {}, dieLabel: 'd8' })).toBeNull();
    expect(buildDestrezzaInitiativeRollConfig({
      Parametri: { Base: { Destrezza: { Tot: '' } } },
      dieLabel: 'd8',
    })).toBeNull();
    expect(buildDestrezzaInitiativeRollConfig({
      Parametri: { Base: { Destrezza: { Tot: 'fast' } } },
      dieLabel: 'd8',
    })).toBeNull();
    expect(buildDestrezzaInitiativeRollConfig({
      Parametri: { Base: { Destrezza: { Tot: 1.5 } } },
      dieLabel: 'd8',
    })).toBeNull();
  });

  test('builds the same parameter formula used by the dice panel', () => {
    expect(formatParameterFormula('d8', 4)).toBe('d8 + 4');
    expect(formatParameterFormula('d6', -2)).toBe('d6 - 2');
    expect(buildParameterRollConfig({
      parameterName: 'Destrezza',
      parameterTotal: 4,
      dieLabel: 'd8',
    })).toEqual({
      faces: 8,
      count: 1,
      modifier: 4,
      formula: 'd8 + 4',
      description: 'Destrezza (d8 + 4)',
    });
  });

  test('builds valid zero and negative Destrezza initiative rolls', () => {
    expect(buildDestrezzaInitiativeRollConfig({
      Parametri: { Base: { Destrezza: { Tot: 0 } } },
      dieLabel: 'd6',
    })).toMatchObject({ faces: 6, modifier: 0, formula: 'd6 + 0' });
    expect(buildDestrezzaInitiativeRollConfig({
      Parametri: { Base: { Destrezza: { Tot: -3 } } },
      dieLabel: 'd10',
    })).toMatchObject({ faces: 10, modifier: -3, formula: 'd10 - 3' });
  });
});
