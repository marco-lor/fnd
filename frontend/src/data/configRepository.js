import { db } from '../components/firebaseConfig';
import {
  doc,
  getDoc,
  labelFirestoreTarget,
} from '../performance/firestore';
import {
  getCached,
  invalidate,
  RepositorySessionChangedError,
} from './repositoryRuntime';

const CONFIG_DOCUMENT_IDS = Object.freeze({
  VARIE: 'varie',
  POSSIBLE_LISTS: 'possible_lists',
  COMMON_SPELLS: 'spells_common',
  COMMON_TECHNIQUES: 'tecniche_common',
  LEGACY_UTILS: 'utils',
});

export const CONFIG_SCHEMA_IDS = Object.freeze([
  'schema_pg',
  'schema_weapon',
  'schema_armatura',
  'schema_accessorio',
  'schema_consumabile',
  'schema_spell',
  'schema_tecnica',
]);

const CONFIG_SCHEMA_ID_SET = new Set(CONFIG_SCHEMA_IDS);

const METRIC_KEYS = Object.freeze({
  varie: 'config.varie.get.v1',
  schema: 'config.schema.get.v1',
  possibleLists: 'config.possible-lists.get.v1',
  commonSpells: 'config.common-spells.get.v1',
  commonTechniques: 'config.common-techniques.get.v1',
});

const INSTANCE_KEYS = Object.freeze({
  varie: 'config:varie',
  possibleLists: 'config:possible-lists',
  commonSpells: 'config:common-spells',
  commonTechniques: 'config:common-techniques:standalone',
  commonTechniquesLegacyFirst: 'config:common-techniques:legacy-first',
  schemaPrefix: 'config:schema:',
});

const normalizeDocumentData = (snapshot) => {
  if (!snapshot || typeof snapshot.exists !== 'function' || !snapshot.exists()) return null;
  const data = typeof snapshot.data === 'function' ? snapshot.data() : null;
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
};

// Deliberately private: callers may only request the reviewed shared-config
// documents through the narrow functions exported below.
const readUtilsDocument = async (documentId, metricKey) => {
  const target = labelFirestoreTarget(
    doc(db, 'utils', documentId),
    metricKey
  );
  return normalizeDocumentData(await getDoc(target));
};

const MAX_CONFIG_ATTEMPTS_ACROSS_SESSION_TRANSITIONS = 3;

// Signup can legitimately cross two authoritative generations: the auth user
// becomes available, then the first profile snapshot establishes its access
// scope. Retry only those transition errors while keeping successful values
// actor-scoped so logout and account changes cannot reuse them.
const getConfigCached = async (options) => {
  for (let attempt = 1; attempt <= MAX_CONFIG_ATTEMPTS_ACROSS_SESSION_TRANSITIONS; attempt += 1) {
    try {
      return await getCached(options);
    } catch (error) {
      if (
        !(error instanceof RepositorySessionChangedError)
        || !error.retryableTransition
        || attempt === MAX_CONFIG_ATTEMPTS_ACROSS_SESSION_TRANSITIONS
      ) throw error;
    }
  }
  throw new Error('Unreachable config retry state.');
};

export const getVarie = () => getConfigCached({
  metricKey: METRIC_KEYS.varie,
  instanceKey: INSTANCE_KEYS.varie,
  load: () => readUtilsDocument(CONFIG_DOCUMENT_IDS.VARIE, METRIC_KEYS.varie),
});

export const getSchema = (schemaId) => {
  if (!CONFIG_SCHEMA_ID_SET.has(schemaId)) {
    throw new TypeError(`Unsupported shared schema: ${String(schemaId)}`);
  }

  return getConfigCached({
    metricKey: METRIC_KEYS.schema,
    instanceKey: `${INSTANCE_KEYS.schemaPrefix}${schemaId}`,
    load: () => readUtilsDocument(schemaId, METRIC_KEYS.schema),
  });
};

export const getPossibleLists = () => getConfigCached({
  metricKey: METRIC_KEYS.possibleLists,
  instanceKey: INSTANCE_KEYS.possibleLists,
  load: () => readUtilsDocument(
    CONFIG_DOCUMENT_IDS.POSSIBLE_LISTS,
    METRIC_KEYS.possibleLists
  ),
});

export const getCommonSpells = () => getConfigCached({
  metricKey: METRIC_KEYS.commonSpells,
  instanceKey: INSTANCE_KEYS.commonSpells,
  load: () => readUtilsDocument(
    CONFIG_DOCUMENT_IDS.COMMON_SPELLS,
    METRIC_KEYS.commonSpells
  ),
});

export const getCommonTechniques = ({ legacyFirst = false } = {}) => {
  if (typeof legacyFirst !== 'boolean') {
    throw new TypeError('legacyFirst must be a boolean.');
  }
  return getConfigCached({
    metricKey: METRIC_KEYS.commonTechniques,
    instanceKey: legacyFirst
      ? INSTANCE_KEYS.commonTechniquesLegacyFirst
      : INSTANCE_KEYS.commonTechniques,
    load: async () => {
      if (legacyFirst) {
        const legacyUtils = await readUtilsDocument(
          CONFIG_DOCUMENT_IDS.LEGACY_UTILS,
          METRIC_KEYS.commonTechniques
        );
        if (legacyUtils?.tecniche_common) return legacyUtils.tecniche_common;
      }

      return readUtilsDocument(
        CONFIG_DOCUMENT_IDS.COMMON_TECHNIQUES,
        METRIC_KEYS.commonTechniques
      );
    },
  });
};

export const invalidateConfig = (documentId) => {
  if (CONFIG_SCHEMA_ID_SET.has(documentId)) {
    return invalidate(`${INSTANCE_KEYS.schemaPrefix}${documentId}`);
  }

  if (documentId === CONFIG_DOCUMENT_IDS.COMMON_TECHNIQUES) {
    const direct = invalidate(INSTANCE_KEYS.commonTechniques);
    const legacyFallback = invalidate(INSTANCE_KEYS.commonTechniquesLegacyFirst);
    return direct || legacyFallback;
  }
  if (documentId === CONFIG_DOCUMENT_IDS.LEGACY_UTILS) {
    return invalidate(INSTANCE_KEYS.commonTechniquesLegacyFirst);
  }

  const instanceKeyByDocumentId = {
    [CONFIG_DOCUMENT_IDS.VARIE]: INSTANCE_KEYS.varie,
    [CONFIG_DOCUMENT_IDS.POSSIBLE_LISTS]: INSTANCE_KEYS.possibleLists,
    [CONFIG_DOCUMENT_IDS.COMMON_SPELLS]: INSTANCE_KEYS.commonSpells,
  };
  const instanceKey = instanceKeyByDocumentId[documentId];
  if (!instanceKey) {
    throw new TypeError(`Unsupported shared config document: ${String(documentId)}`);
  }
  return invalidate(instanceKey);
};
