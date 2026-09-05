import { computeValue } from '../components/common/computeFormula';
import {
  applyCapToStat,
  computeFinalGain,
  getBonusCreazione,
} from '../components/home/elements/useConsumable';

describe('Task 08 gameplay regression contracts', () => {
  test('formula composition and resource caps remain authoritative', () => {
    const userParams = {
      Base: { Forza: { Tot: 4 } },
      Combattimento: { Attacco: { Tot: 3 } },
    };

    expect(computeValue('Forza + Attacco * 2', userParams)).toBe(10);
    expect(computeValue('MAX(Forza; 10)', userParams)).toBe(10);
    expect(applyCapToStat(48, 5, 50)).toBe(50);
    expect(applyCapToStat(48, 5, 0)).toBe(53);
  });

  test('consumable dice bonus semantics use the authoritative roll count and cap', () => {
    const item = { Specific: { 'Bonus Creazione': '+2' } };
    const bonus = getBonusCreazione(item);
    const gain = computeFinalGain(7, bonus, 3);
    expect(bonus).toBe(2);
    expect(gain).toBe(13);
    expect(applyCapToStat(42, gain, 50)).toBe(50);
  });
});
