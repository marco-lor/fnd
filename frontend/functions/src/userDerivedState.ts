import {
  asFiniteNumber,
  asRecord,
  deriveAnimaParameters,
  deriveParameterTotals,
  deriveResourceTotals,
  hashValue,
} from "./userDataV2";
import {
  planUserDirectoryMutation,
  UserDirectoryMutation,
} from "./userDirectoryProjection";
import {
  resolveTask06BackendConfig,
  Task06BackendConfig,
} from "./backendOperationCore";

export const TASK06_BACKEND_CONFIG_PATH = "app_config/task06_backend";
export {resolveTask06BackendConfig} from "./backendOperationCore";

export type Task06DerivedOwnerMode =
  Task06BackendConfig["derivedOwnerMode"];

type UnknownRecord = Record<string, unknown>;
type UserSourceData = UnknownRecord | null | undefined;

const isRecord = (value: unknown): value is UnknownRecord => (
  value !== null && typeof value === "object" && !Array.isArray(value)
);

const valuesDiffer = (left: unknown, right: unknown): boolean => (
  hashValue(left) !== hashValue(right)
);

export const resolveTask06DerivedOwnerMode = (
  value: unknown
): Task06DerivedOwnerMode => resolveTask06BackendConfig(value)
  .derivedOwnerMode;

const groupHasRecord = (
  parametri: UnknownRecord,
  groupName: string
): boolean => Object.values(asRecord(parametri[groupName])).some(isRecord);

const combatStat = (
  source: UserSourceData,
  name: "Salute" | "Disciplina"
): unknown => asRecord(asRecord(source).Parametri).Combattimento &&
  asRecord(asRecord(asRecord(source).Parametri).Combattimento)[name];

const sourceLevel = (source: UserSourceData): unknown => (
  asRecord(asRecord(source).stats).level
);

const barrierValue = (
  source: UserSourceData,
  field: "remainingTurns" | "totalTurns"
): unknown => asRecord(
  asRecord(asRecord(source).active_turn_effect).barriera
)[field];

export interface UserDerivedChangeClassification {
  sourceChanged: boolean;
  directoryMutation: UserDirectoryMutation;
  animaRelevant: boolean;
  parameterTotalsRelevant: boolean;
  resourceTotalsRelevant: boolean;
  barrierInputChanged: boolean;
  needsUtils: boolean;
}

/**
 * Performs the cheap event-snapshot comparison used before any config or utils
 * read. The authoritative transaction repeats this against the latest source.
 */
export const classifyUserDerivedChange = (
  beforeData: UserSourceData,
  afterData: UserSourceData
): UserDerivedChangeClassification => {
  const before = asRecord(beforeData);
  const after = asRecord(afterData);
  const afterExists = Boolean(afterData);
  const created = !beforeData && afterExists;
  const parametri = asRecord(after.Parametri);
  const levelChanged = valuesDiffer(
    sourceLevel(beforeData),
    sourceLevel(afterData)
  );
  const animaInputsChanged = created ||
    valuesDiffer(before.AltriParametri, after.AltriParametri) ||
    levelChanged;
  const hasAnimaTargets = groupHasRecord(parametri, "Base") ||
    groupHasRecord(parametri, "Combattimento");
  const animaRelevant = afterExists &&
    hasAnimaTargets &&
    animaInputsChanged;
  const parameterInputsChanged = created ||
    valuesDiffer(before.Parametri, after.Parametri);
  const hasParameterTargets = hasAnimaTargets ||
    groupHasRecord(parametri, "Special");
  const parameterTotalsRelevant = afterExists &&
    hasParameterTargets &&
    (parameterInputsChanged || animaRelevant);

  const level = asFiniteNumber(sourceLevel(afterData), Number.NaN);
  const hasUsableLevel = Number.isFinite(level) && level !== 0;
  const hasResourceTargets = isRecord(combatStat(afterData, "Salute")) ||
    isRecord(combatStat(afterData, "Disciplina"));
  const resourceInputsChanged = created ||
    levelChanged ||
    valuesDiffer(
      combatStat(beforeData, "Salute"),
      combatStat(afterData, "Salute")
    ) ||
    valuesDiffer(
      combatStat(beforeData, "Disciplina"),
      combatStat(afterData, "Disciplina")
    ) ||
    animaRelevant;
  const resourceTotalsRelevant = afterExists &&
    hasUsableLevel &&
    hasResourceTargets &&
    resourceInputsChanged;
  const barrierInputChanged = afterExists && valuesDiffer(
    barrierValue(beforeData, "remainingTurns"),
    barrierValue(afterData, "remainingTurns")
  );

  return {
    sourceChanged: valuesDiffer(beforeData, afterData),
    directoryMutation: planUserDirectoryMutation(beforeData, afterData),
    animaRelevant,
    parameterTotalsRelevant,
    resourceTotalsRelevant,
    barrierInputChanged,
    needsUtils: animaRelevant || resourceTotalsRelevant,
  };
};

export interface UserDerivedStatePlan {
  classification: UserDerivedChangeClassification;
  rootUpdate: UnknownRecord;
  directoryMutation: UserDirectoryMutation;
}

const setChangedLeaf = (
  update: UnknownRecord,
  path: string,
  currentValue: unknown,
  nextValue: unknown
): void => {
  if (nextValue !== undefined && valuesDiffer(currentValue, nextValue)) {
    update[path] = nextValue;
  }
};

const addParameterLeafUpdates = (input: {
  update: UnknownRecord;
  current: UnknownRecord;
  derived: UnknownRecord;
  includeAnima: boolean;
  includeTotals: boolean;
}): void => {
  ["Base", "Combattimento", "Special"].forEach((groupName) => {
    const currentGroup = asRecord(input.current[groupName]);
    const derivedGroup = asRecord(input.derived[groupName]);
    Object.entries(currentGroup).forEach(([name, currentStatValue]) => {
      if (!isRecord(currentStatValue)) return;
      const derivedStat = asRecord(derivedGroup[name]);
      if (input.includeAnima && groupName !== "Special") {
        setChangedLeaf(
          input.update,
          `Parametri.${groupName}.${name}.Anima`,
          currentStatValue.Anima,
          derivedStat.Anima
        );
      }
      if (input.includeTotals) {
        setChangedLeaf(
          input.update,
          `Parametri.${groupName}.${name}.Tot`,
          currentStatValue.Tot,
          derivedStat.Tot
        );
      }
    });
  });
};

const addBarrierExpiryUpdates = (
  update: UnknownRecord,
  source: UnknownRecord
): void => {
  const barrier = asRecord(asRecord(source.active_turn_effect).barriera);
  const remaining = asFiniteNumber(barrier.remainingTurns, Number.NaN);
  const totalTurns = asFiniteNumber(barrier.totalTurns, Number.NaN);
  if (
    !Number.isFinite(remaining) ||
    !Number.isFinite(totalTurns) ||
    remaining > 0 ||
    totalTurns <= 0
  ) return;

  const stats = asRecord(source.stats);
  setChangedLeaf(
    update,
    "stats.barrieraCurrent",
    stats.barrieraCurrent ?? 0,
    0
  );
  setChangedLeaf(
    update,
    "stats.barrieraTotal",
    stats.barrieraTotal ?? 0,
    0
  );
  setChangedLeaf(
    update,
    "active_turn_effect.barriera.remainingTurns",
    barrier.remainingTurns,
    0
  );
  setChangedLeaf(
    update,
    "active_turn_effect.barriera.totalTurns",
    barrier.totalTurns,
    0
  );
};

/**
 * Recomputes derived state in dependency order and returns dotted leaf paths.
 * It never replaces a parameter section or emits undefined.
 */
export const planUserDerivedState = (input: {
  beforeData: UserSourceData;
  afterData: UserSourceData;
  utils?: unknown;
}): UserDerivedStatePlan => {
  const classification = classifyUserDerivedChange(
    input.beforeData,
    input.afterData
  );
  const rootUpdate: UnknownRecord = {};
  if (!input.afterData) {
    return {
      classification,
      rootUpdate,
      directoryMutation: classification.directoryMutation,
    };
  }

  const source = asRecord(input.afterData);
  const currentParametri = asRecord(source.Parametri);
  let derivedParametri = currentParametri;
  if (classification.animaRelevant) {
    derivedParametri = deriveAnimaParameters({
      parametri: currentParametri,
      altriParametri: source.AltriParametri,
      level: sourceLevel(source),
      utils: input.utils,
    });
  } else if (classification.parameterTotalsRelevant) {
    derivedParametri = deriveParameterTotals(currentParametri);
  }

  addParameterLeafUpdates({
    update: rootUpdate,
    current: currentParametri,
    derived: derivedParametri,
    includeAnima: classification.animaRelevant,
    includeTotals: classification.parameterTotalsRelevant,
  });

  if (classification.resourceTotalsRelevant) {
    const resourceTotals = deriveResourceTotals({
      parametri: derivedParametri,
      level: sourceLevel(source),
      utils: input.utils,
    });
    const stats = asRecord(source.stats);
    ["hpTotal", "manaTotal"].forEach((field) => {
      if (resourceTotals[field] === undefined) return;
      setChangedLeaf(
        rootUpdate,
        `stats.${field}`,
        stats[field],
        resourceTotals[field]
      );
    });
  }

  if (classification.barrierInputChanged) {
    addBarrierExpiryUpdates(rootUpdate, source);
  }

  return {
    classification,
    rootUpdate,
    directoryMutation: classification.directoryMutation,
  };
};
