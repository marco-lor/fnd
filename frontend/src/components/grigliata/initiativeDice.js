import { getParamDisplayName } from '../common/paramMetadata';

export const resolveAnimaDieLabel = (dadiAnimaByLevel, level) => {
  if (!level) return '';

  if (Array.isArray(dadiAnimaByLevel)) {
    return typeof dadiAnimaByLevel[level] === 'string' ? dadiAnimaByLevel[level] : '';
  }

  if (dadiAnimaByLevel && typeof dadiAnimaByLevel === 'object') {
    const value = dadiAnimaByLevel[level] || dadiAnimaByLevel[String(level)];
    return typeof value === 'string' ? value : '';
  }

  return '';
};

export const parseDiceFaces = (diceLabel) => {
  const match = /^d(\d+)$/i.exec(typeof diceLabel === 'string' ? diceLabel.trim() : '');
  if (!match) return 0;

  const faces = Number.parseInt(match[1], 10);
  return Number.isFinite(faces) && faces > 0 ? faces : 0;
};

export const formatSpacedModifier = (modifier) => {
  const value = Number(modifier) || 0;
  return `${value >= 0 ? '+' : '-'} ${Math.abs(value)}`;
};

export const formatParameterFormula = (dieLabel, modifier) => (
  `${dieLabel || 'd?'} ${formatSpacedModifier(modifier)}`
);

const normalizeAssignedNumber = (value) => {
  if (typeof value === 'string' && !value.trim()) return null;

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

export const resolveBaseParameterTotal = (Parametri, parameterName) => {
  const baseParameters = Parametri?.Base;
  if (!baseParameters || typeof baseParameters !== 'object' || Array.isArray(baseParameters)) {
    return null;
  }

  const normalizedParameterName = String(parameterName || '').trim().toLocaleLowerCase();
  const matchingKey = Object.keys(baseParameters).find((key) => (
    key.trim().toLocaleLowerCase() === normalizedParameterName
  ));

  if (!matchingKey) return null;
  return normalizeAssignedNumber(baseParameters[matchingKey]?.Tot);
};

export const buildParameterRollConfig = ({
  parameterName,
  parameterTotal,
  dieLabel,
}) => {
  const faces = parseDiceFaces(dieLabel);
  const modifier = normalizeAssignedNumber(parameterTotal);
  if (!faces || modifier === null) return null;

  const displayName = getParamDisplayName(parameterName);
  const formula = formatParameterFormula(dieLabel.trim(), modifier);

  return {
    faces,
    count: 1,
    modifier,
    formula,
    description: `${displayName} (${formula})`,
  };
};

export const buildDestrezzaInitiativeRollConfig = ({ Parametri, dieLabel }) => {
  const modifier = resolveBaseParameterTotal(Parametri, 'Destrezza');
  if (!Number.isInteger(modifier)) return null;

  return buildParameterRollConfig({
    parameterName: 'Destrezza',
    parameterTotal: modifier,
    dieLabel,
  });
};
