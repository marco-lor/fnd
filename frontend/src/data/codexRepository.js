import { db } from '../components/firebaseConfig';
import { getCallable } from './functions/callableRegistry';
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  labelFirestoreTarget,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  updateDoc,
  runTransaction,
  FieldPath,
  deleteField,
} from '../performance/firestore';
import {
  getCached,
  invalidate,
  invalidatePrefix,
  RepositorySessionChangedError,
  subscribeShared,
} from './repositoryRuntime';
const {
  CODEX_PAGE_SIZE, normalizeControl, normalizeCategory,
  projectLegacyCodex, createPage, validatePageRequest,
} = require('./codexModel');

const CODEX_DOCUMENT_ID = 'codex';
const CODEX_GET_INSTANCE_KEY = 'codex:document:get';
const CODEX_SUBSCRIPTION_INSTANCE_KEY = 'codex:document:subscribe';
const MAX_CODEX_ATTEMPTS_ACROSS_SESSION_TRANSITIONS = 3;

const METRIC_KEYS = Object.freeze({
  get: 'codex.document.get.v1',
  subscribe: 'codex.document.subscribe.v1',
  patch: 'codex.document.patch.v1',
});

const normalizeCodexSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot.exists !== 'function' || !snapshot.exists()) return null;
  const data = typeof snapshot.data === 'function' ? snapshot.data() : null;
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
};

const codexTarget = (metricKey) => labelFirestoreTarget(
  doc(db, 'utils', CODEX_DOCUMENT_ID),
  metricKey
);

export const getCodex = async () => {
  for (let attempt = 1; attempt <= MAX_CODEX_ATTEMPTS_ACROSS_SESSION_TRANSITIONS; attempt += 1) {
    try {
      return await getCached({
        metricKey: METRIC_KEYS.get,
        instanceKey: CODEX_GET_INSTANCE_KEY,
        load: async () => normalizeCodexSnapshot(await getDoc(codexTarget(METRIC_KEYS.get))),
      });
    } catch (error) {
      if (
        !(error instanceof RepositorySessionChangedError)
        || !error.retryableTransition
        || attempt === MAX_CODEX_ATTEMPTS_ACROSS_SESSION_TRANSITIONS
      ) throw error;
    }
  }
  throw new Error('Unreachable Codex retry state.');
};

export const subscribeCodex = (observer) => subscribeShared({
  metricKey: METRIC_KEYS.subscribe,
  instanceKey: CODEX_SUBSCRIPTION_INSTANCE_KEY,
  listen: ({ next, error }) => onSnapshot(
    codexTarget(METRIC_KEYS.subscribe),
    (snapshot) => next(normalizeCodexSnapshot(snapshot)),
    error
  ),
}, observer);

export const patchCodex = async (fields) => {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new TypeError('Codex patches must be Firestore field maps.');
  }

  const result = await updateDoc(codexTarget(METRIC_KEYS.patch), fields);
  invalidatePrefix('codex:');
  return result;
};

export const invalidateCodex = () => invalidatePrefix('codex:');

const V2_KEYS = Object.freeze({ control: 'codex.control.get.v2', controlSubscribe: 'codex.control.subscribe.v2',
  metadata: 'codex.categories.page.v2', items: 'codex.items.page.v2', category: 'codex.category.get.v2',
  options: 'codex.options.get.v2' });
const controlTarget = key => labelFirestoreTarget(doc(db, 'utils', 'codex_control'), key);
const categoriesPath = control => ['codex_versions', control.generation, 'categories'];
const categoryTarget = (control, id) => labelFirestoreTarget(doc(db, ...categoriesPath(control), id), V2_KEYS.category);
const observerOf = observer => typeof observer === 'function' ? { next: observer } : observer;
const stale = () => Object.assign(new Error('Codex changed while reading; reload the first page.'), { code: 'codex-stale-snapshot' });
const controlFromSnapshot = snapshot => normalizeControl(snapshot?.exists() ? snapshot.data() : null);
const getLegacyForControl = control => getCached({ metricKey: METRIC_KEYS.get,
  instanceKey: `codex:legacy:${control.epoch}`, load: async () => normalizeCodexSnapshot(await getDoc(codexTarget(METRIC_KEYS.get))) });
const sameControl = (left, right) => ['epoch', 'generation', 'mode', 'metadataRevision'].every(key => left[key] === right[key]);

// Share concurrent acquisitions, but do not retain control/metadata across
// acquisitions: a stopped listener must not leave a cached cutover decision.
const fresh = async (metricKey, instanceKey, load) => {
  try { return await getCached({ metricKey, instanceKey, load }); }
  finally { invalidate(instanceKey); }
};

export const getCodexControl = () => fresh(V2_KEYS.control, 'codex:control:get', async () => (
  controlFromSnapshot(await getDoc(controlTarget(V2_KEYS.control)))
));

export const subscribeCodexControl = observer => subscribeShared({
  metricKey: V2_KEYS.controlSubscribe, instanceKey: 'codex:control:subscribe',
  listen: ({ next, error }) => onSnapshot(controlTarget(V2_KEYS.controlSubscribe), snapshot => {
    try { next(controlFromSnapshot(snapshot)); } catch (failure) { error(failure); }
  }, error),
}, observer);

const pageKey = request => JSON.stringify({ control: request.control, category: request.category || null,
  order: request.order || 'display', pageSize: request.pageSize || CODEX_PAGE_SIZE, cursor: request.cursor || null });
const pageTarget = request => {
  const scope = validatePageRequest(request);
  const path = categoriesPath(request.control);
  if (request.category) path.push(request.category.id, 'items');
  const constraints = [orderBy(scope.rankField), orderBy(documentId())];
  if (request.cursor) constraints.push(startAfter(request.cursor.rank, request.cursor.id));
  constraints.push(limit(scope.pageSize + 1));
  return labelFirestoreTarget(query(collection(db, ...path), ...constraints), request.category ? V2_KEYS.items : V2_KEYS.metadata);
};
const pageFromSnapshot = (snapshot, request) => {
  if (!Array.isArray(snapshot?.docs)) throw new TypeError('Invalid Codex query snapshot.');
  return createPage(snapshot.docs.map(document => ({ ...document.data(), id: document.id })), request);
};
const readCategory = async (control, id) => {
  const data = normalizeCodexSnapshot(await getDoc(categoryTarget(control, id)));
  if (!data) throw stale();
  return normalizeCategory({ ...data, id });
};

export const getCodexMetadataPage = async (options = {}) => {
  const control = options.control || await getCodexControl();
  if (control.source === 'legacy' || control.mode === 'legacy' || control.mode === 'frozen') {
    const source = await getLegacyForControl(control);
    if (!sameControl(control, await getCodexControl())) throw stale();
    return legacyPage(source, { ...options, control });
  }
  const request = { ...options, control };
  return fresh(V2_KEYS.metadata, `codex:metadata:${pageKey(request)}`, async () => (
    pageFromSnapshot(await getDocs(pageTarget(request)), request)
  ));
};

export const getCodexItemsPage = async request => {
  validatePageRequest(request);
  if (!request.category) throw new TypeError('Codex items require category metadata.');
  return getCached({ metricKey: V2_KEYS.items,
    instanceKey: `codex:items:${request.control.generation}:${request.category.id}:${pageKey(request)}`,
    load: async () => pageFromSnapshot(await getDocs(pageTarget(request)), request) });
};

// Compatible maps for secondary consumers. Every page of only the requested
// category is collected. Never silently truncate option lists to the UI page.
export const getCodexCategories = async categoryKeys => {
  if (!Array.isArray(categoryKeys) || !categoryKeys.length || categoryKeys.some(key => typeof key !== 'string' || !key)) {
    throw new TypeError('Codex category keys must be a non-empty string array.');
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fresh(V2_KEYS.options, `codex:acquire:${JSON.stringify(categoryKeys)}`, async () => {
        const control = await getCodexControl();
        if (control.source === 'legacy') {
          const source = await getLegacyForControl(control);
          if (!sameControl(control, await getCodexControl())) throw stale();
          return source === null ? null : Object.fromEntries(categoryKeys.filter(key => Object.prototype.hasOwnProperty.call(source, key)).map(key => [key, source[key]]));
        }
        const selected = [];
        let cursor = null;
        do {
          const page = await getCodexMetadataPage({ control, order: 'source', cursor, pageSize: 50 });
          selected.push(...page.items.filter(category => categoryKeys.includes(category.legacyKey)));
          cursor = page.cursor;
        } while (cursor);
        const entries = [];
        for (const category of selected) {
          const value = await getCached({ metricKey: V2_KEYS.options,
            instanceKey: `codex:options:${control.generation}:${control.epoch}:${category.id}:${category.revision}`,
            load: async () => {
              const rows = [];
              let itemCursor = null;
              do {
                const page = await getCodexItemsPage({ control, category, order: 'source', cursor: itemCursor });
                rows.push(...page.items);
                itemCursor = page.cursor;
              } while (itemCursor);
              if (rows.length !== category.itemCount || new Set(rows.map(x => x.legacyKey)).size !== rows.length
                || (await readCategory(control, category.id)).revision !== category.revision) throw stale();
              return Object.fromEntries(rows.map(item => [item.legacyKey, item.value]));
            } });
          entries.push([category.legacyKey, value]);
        }
        if (!sameControl(control, await getCodexControl())) throw stale();
        return Object.fromEntries(entries);
      });
    } catch (error) {
      if (attempt === 2 || !(error.code === 'codex-stale-snapshot'
        || (error instanceof RepositorySessionChangedError && error.retryableTransition))) throw error;
      invalidateCodex();
    }
  }
  throw stale();
};

const legacyTokens = new WeakMap();
const legacyPage = (source, options) => {
  const control = normalizeControl(options.control);
  // Exact local-only content/order token: stable across identical reacquisitions,
  // no module cache retaining prior sessions, no collision-prone surrogate hash.
  // Legacy already reads the aggregate; v2 never creates or transmits this token.
  let legacyContent = source && legacyTokens.get(source);
  if (!legacyContent) {
    legacyContent = JSON.stringify(source || {});
    if (source) legacyTokens.set(source, legacyContent);
  }
  if (options.cursor && !options.localCursorCheck && options.cursor.legacyContent !== legacyContent) throw stale();
  const groups = projectLegacyCodex(source || {}, control.collationLocale);
  const group = options.categoryKey ? groups.find(x => x.category.legacyKey === options.categoryKey)
    : options.categoryId ? groups.find(x => x.category.id === options.categoryId) : null;
  const category = group?.category || null;
  const order = options.order || 'display';
  const rankField = `${order}Rank`;
  const rows = [...(options.categoryKey || options.categoryId ? group?.items || [] : groups.map(x => x.category))]
    .sort((a, b) => a[rankField] - b[rankField]);
  const request = { ...options, control: { ...control, mode: 'v2', generation: 'legacy' }, category };
  validatePageRequest(request);
  const offset = options.cursor ? rows.findIndex(x => x.id === options.cursor.id) + 1 : 0;
  const page = createPage(rows.slice(offset, offset + (options.pageSize || CODEX_PAGE_SIZE) + 1), request);
  return { ...page, control, legacyContent, cursor: page.cursor ? { ...page.cursor, legacyContent } : null };
};

const listenPage = (request, observer) => onSnapshot(pageTarget(request), snapshot => {
  try { observer.next(pageFromSnapshot(snapshot, request)); } catch (error) { observer.error(error); }
}, observer.error);

// A single shared subscription owns control and child listeners. Tokens fence
// callbacks already queued when mode/generation/revision changes or unmounts.
const followControl = (options, items, observer) => {
  const targetObserver = observerOf(observer);
  const expectedLegacyContent = options.cursor?.legacyContent;
  // Keep full legacy content out of repository instance keys. Validate each
  // consumer's local token after delivery, so shared page listeners stay safe.
  if (options.cursor) {
    const { legacyContent: _localOnly, ...cursor } = options.cursor;
    options = { ...options, cursor };
  }
  return subscribeShared({
  metricKey: items ? V2_KEYS.items : V2_KEYS.metadata,
  instanceKey: `codex:follow:${items ? 'items' : 'metadata'}:${JSON.stringify(options)}`,
  listen: sink => {
    let token = 0;
    let childStop = () => {};
    const stopControl = subscribeCodexControl({ next: control => {
      const current = ++token;
      childStop();
      childStop = () => {};
      const guarded = { next: value => { if (current === token) sink.next(value); },
        error: error => { if (current === token) sink.error(error); } };
      try {
        if (control.source === 'legacy') {
          childStop = subscribeCodex({ next: source => {
            try { guarded.next(legacyPage(source, { ...options, control, localCursorCheck: true })); } catch (error) { guarded.error(error); }
          }, error: guarded.error });
        } else if (!items) {
          childStop = listenPage({ ...options, control }, guarded);
        } else {
          if (!options.categoryId) throw new TypeError('Active Codex page requires categoryId.');
          let pageStop = () => {};
          let revisionToken = 0;
          const categoryStop = onSnapshot(categoryTarget(control, options.categoryId), snapshot => {
            if (current !== token) return;
            const revision = ++revisionToken;
            pageStop();
            pageStop = () => {};
            try {
              const data = normalizeCodexSnapshot(snapshot);
              if (!data) throw stale();
              const category = normalizeCategory({ ...data, id: options.categoryId });
              pageStop = listenPage({ ...options, control, category }, {
                next: value => { if (revision === revisionToken) guarded.next(value); },
                error: error => { if (revision === revisionToken) guarded.error(error); },
              });
            } catch (error) { guarded.error(error); }
          }, guarded.error);
          childStop = () => { revisionToken++; pageStop(); categoryStop(); };
        }
      } catch (error) { guarded.error(error); }
    }, error: sink.error });
    return () => { token++; childStop(); stopControl(); };
  },
}, {
    next: page => {
      if (options.cursor && page.control.source === 'legacy' && expectedLegacyContent !== page.legacyContent) targetObserver.error?.(stale());
      else targetObserver.next?.(page);
    },
    error: error => targetObserver.error?.(error),
  });
};

export const subscribeCodexMetadataPage = (options = {}, observer) => followControl(options, false, observer);
export const subscribeCodexItemsPage = (options, observer) => followControl(options, true, observer);

// The dialog supplies its captured context, never fresh revisions on a retry.
// Legacy remains a single-document writer until the guarded server cutover.
export const mutateCodex = async ({ action, control, category, item, legacyKey, value, legacyContent }, isCurrent = () => true) => {
  const expected = normalizeControl(control);
  const reject = (message, code = 'aborted') => { throw Object.assign(new Error(message), { code }); };
  if (expected.readOnly) reject('Codex temporaneamente in sola lettura.', 'failed-precondition');
  if (!isCurrent()) reject('La sessione o la selezione è cambiata. Riapri il dialogo.');
  if (expected.source === 'v2') {
    const payload = { action, epoch: expected.epoch, generation: expected.generation };
    if (action.startsWith('category-')) payload.metadataRevision = expected.metadataRevision;
    if (category) Object.assign(payload, { categoryId: category.id, categoryRevision: category.revision });
    if (item) Object.assign(payload, { itemId: item.id, itemRevision: item.revision });
    if (action.endsWith('-add')) payload.legacyKey = legacyKey;
    if (action === 'item-add' || action === 'item-edit') payload.value = value;
    const response = await getCallable('task12MutateCodex')(payload);
    invalidateCodex();
    return response.data;
  }
  const result = await runTransaction(db, async transaction => {
    const actual = controlFromSnapshot(await transaction.get(controlTarget(V2_KEYS.control)));
    if (!sameControl(expected, actual) || actual.readOnly || actual.source !== 'legacy' || !isCurrent()) {
      reject('Codex è cambiato. Riapri il dialogo prima di riprovare.');
    }
    const target = codexTarget(METRIC_KEYS.patch);
    const source = normalizeCodexSnapshot(await transaction.get(target)) || {};
    if (legacyContent !== undefined && legacyContent !== JSON.stringify(source)) reject('Codex modificato da un altro editor. Riapri il dialogo.');
    const own = (map, key) => Object.prototype.hasOwnProperty.call(map, key);
    if (action === 'category-add') {
      if (Object.keys(source).some(key => key.toLowerCase() === legacyKey.toLowerCase())) reject('Categoria già esistente.', 'already-exists');
      transaction.update(target, new FieldPath(legacyKey), {});
    } else {
      const entries = source[category.legacyKey];
      if (!own(source, category.legacyKey) || !entries || typeof entries !== 'object') reject('Categoria non più disponibile.');
      if (action === 'category-delete') {
        if (Object.keys(entries).length !== category.itemCount) reject('Categoria modificata da un altro editor.');
        transaction.update(target, new FieldPath(category.legacyKey), deleteField());
      } else if (action === 'item-add') {
        if (own(entries, legacyKey)) reject('Elemento già esistente.', 'already-exists');
        transaction.update(target, new FieldPath(category.legacyKey, legacyKey), value);
      } else if (action === 'item-edit' || action === 'item-delete') {
        if (!own(entries, item.legacyKey) || JSON.stringify(entries[item.legacyKey]) !== JSON.stringify(item.value)) reject('Elemento modificato da un altro editor.');
        transaction.update(target, new FieldPath(category.legacyKey, item.legacyKey), action === 'item-delete' ? deleteField() : value);
      } else reject('Azione Codex non valida.', 'invalid-argument');
    }
    if (!isCurrent()) reject('La sessione o la selezione è cambiata.');
  }, { maxAttempts: 1 });
  invalidateCodex();
  return result;
};
