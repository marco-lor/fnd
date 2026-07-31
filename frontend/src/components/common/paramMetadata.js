export const SPECIAL_PARAM_SCHEMA_IDS = [
  'schema_weapon',
  'schema_armatura',
  'schema_accessorio',
  'schema_consumabile',
];

const PARAM_NAME_OVERRIDES = {
  RiduzioneDanni: 'Riduz Danni',
  ridCostoSpell: 'Rid. Costo Spell',
  ridCostoTec: 'Rid. Costo Tec',
};

export const getParamDisplayName = (key) => PARAM_NAME_OVERRIDES[key] || key;