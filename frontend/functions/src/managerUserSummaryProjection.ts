type RecordData = Record<string, any>;
const record = (value: unknown): RecordData => (
  value && typeof value === "object" && !Array.isArray(value) ? value : {}
);
const number = (value: unknown, fallback = 0): number => {
  // V2 migration preserves numeric strings from legacy character sheets.
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
};

// This private projection is independent of the safe label/role directory.
// Only fields rendered by the Dashboard cards and lock table belong here.
export const buildManagerUserSummary = (domains: RecordData): RecordData => {
  const progression = record(record(domains.progression).stats);
  const resources = record(record(domains.resources).stats);
  const settings = record(record(domains.settings).settings);
  return {
    schemaVersion: 1,
    stats: {
      level: number(progression.level, 1),
      basePointsAvailable: number(progression.basePointsAvailable),
      basePointsSpent: number(progression.basePointsSpent),
      combatTokensAvailable: number(progression.combatTokensAvailable),
      combatTokensSpent: number(progression.combatTokensSpent),
      gold: number(resources.gold),
      hpCurrent: number(resources.hpCurrent),
      hpTotal: number(resources.hpTotal),
      manaCurrent: number(resources.manaCurrent),
      manaTotal: number(resources.manaTotal),
      essenzaCurrent: number(resources.essenzaCurrent),
      essenzaTotal: number(resources.essenzaTotal),
    },
    settings: {
      lock_param_base: settings.lock_param_base === true,
      lock_param_combat: settings.lock_param_combat === true,
    },
  };
};
