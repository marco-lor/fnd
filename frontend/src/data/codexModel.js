/* Task 12 cross-runtime contract. CommonJS intentionally supports browser,
 * migration scripts and backend contract tests without a second schema.
 *
 * utils/codex_control: schemaVersion, mode, epoch, generation,
 * metadataRevision, collationLocale. Missing document means legacy.
 * codex_versions/{generation}/categories/{id}: category projection below.
 * .../categories/{id}/items/{id}: item projection below. IDs never change.
 * category/sourceRank preserves the captured Object.entries order;
 * displayRank preserves lowercased localeCompare in collationLocale, with
 * source order breaking equal comparisons. No text normalization changes keys.
 *
 * Backend B MUST fence direct legacy writes (including webmaster) outside
 * legacy and deny direct v2 writes. Freeze -> fixed source digest -> resumable
 * backfill -> exact key/value/order/count verification -> atomic v2 control.
 * Only the backend writer may transact v2 changes, checking control epoch,
 * generation and expected category/item revision. Value edits update one item
 * plus its category revision; never global control or other category bodies.
 * Insertions allocate a display-rank midpoint; exhausted precision must reject
 * or perform an explicitly fenced category-local rebalance. Deletion retains
 * other IDs/ranks. New source ranks append; preserve map integer-key semantics.
 * Category changes increment metadataRevision; item changes do not.
 *
 * Rollback: freeze v2 writers and reconstruct CURRENT v2. Reject order that
 * cannot survive Firestore's UTF-8 map-key sorting, and preflight encoded size.
 * Three separately reviewed checkpoints persist a private candidate, verify it
 * and persist legacy while still frozen, then verify persisted legacy and
 * atomically switch control WITHOUT rewriting legacy. Unsafe/corrupt data stays
 * frozen or explicitly resumes v2; never restore the stale backup over edits.
 * Retain original legacy and generation documents until explicit retirement.
 * Old clients receive write-denied after freeze; no client dual writing.
 */
const CODEX_SCHEMA_VERSION = 2;
const CODEX_PAGE_SIZE = 25;
const CODEX_MAX_PAGE_SIZE = 50;
const CODEX_RANK_GAP = 1024;
const MODES = ['legacy', 'frozen', 'v2', 'rollback-frozen'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = message => { throw new TypeError(`Invalid Codex ${message}`); };
const natural = value => Number.isSafeInteger(value) && value >= 0;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const normalizeName = value => value.normalize('NFC').toLowerCase();

const assertValue = (value, path = 'value', depth = 0) => {
  if (depth > 18) fail(`${path}: nesting too deep`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (Array.isArray(entry)) fail(`${path}[${index}]: nested arrays unsupported by Firestore`);
      assertValue(entry, `${path}[${index}]`, depth + 1);
    });
    return;
  }
  if (record(value)) {
    Object.entries(value).forEach(([key, entry]) => assertValue(entry, `${path}.${key}`, depth + 1));
    return;
  }
  fail(`${path}: only losslessly supported Firestore JSON values are accepted`);
};

const normalizeControl = value => {
  if (value === null) return Object.freeze({ schemaVersion: 2, mode: 'legacy', epoch: 0,
    generation: null, metadataRevision: 0, collationLocale: 'en-US', source: 'legacy', readOnly: false });
  if (!record(value) || value.schemaVersion !== 2 || !MODES.includes(value.mode)
    || !natural(value.epoch) || !natural(value.metadataRevision)
    || (value.generation !== null && !validId(value.generation))
    || (['v2', 'rollback-frozen'].includes(value.mode) && !validId(value.generation))
    || typeof value.collationLocale !== 'string' || !value.collationLocale) fail('control');
  try { new Intl.Collator(value.collationLocale); } catch (_) { fail('collationLocale'); }
  return Object.freeze({ ...value, source: ['v2', 'rollback-frozen'].includes(value.mode) ? 'v2' : 'legacy',
    readOnly: value.mode === 'frozen' || value.mode === 'rollback-frozen' });
};

const COMMON_FIELDS = ['id', 'schemaVersion', 'legacyKey', 'normalizedName', 'sourceRank', 'displayRank', 'revision', 'visibility', 'ownerUid'];
const normalizeEntity = (value, kind) => {
  const fields = [...COMMON_FIELDS, ...(kind === 'category' ? ['itemCount'] : ['value'])];
  if (!record(value) || Object.keys(value).some(key => !fields.includes(key))
    || !validId(value.id) || value.schemaVersion !== 2 || typeof value.legacyKey !== 'string'
    || !value.legacyKey || value.normalizedName !== normalizeName(value.legacyKey)
    || !natural(value.sourceRank) || !Number.isFinite(value.displayRank)
    || value.displayRank < 0 || !natural(value.revision) || value.revision < 1
    || value.visibility !== 'authenticated' || value.ownerUid !== null) fail(kind);
  if (kind === 'category') { if (!natural(value.itemCount)) fail('itemCount'); }
  else { if (!Object.prototype.hasOwnProperty.call(value, 'value')) fail('missing item value'); assertValue(value.value); }
  return Object.freeze({ ...value });
};
const normalizeCategory = value => normalizeEntity(value, 'category');
const normalizeItem = value => normalizeEntity(value, 'item');

const projectLegacyCodex = (source, locale = 'en-US') => {
  if (!record(source)) fail('legacy root: expected map');
  const projectKeys = (keys, prefix) => {
    const display = [...keys].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), locale));
    const ranks = new Map(display.map((key, index) => [key, (index + 1) * CODEX_RANK_GAP]));
    return keys.map((legacyKey, sourceRank) => ({ id: `${prefix}${String(sourceRank).padStart(10, '0')}`,
      schemaVersion: 2, legacyKey, normalizedName: normalizeName(legacyKey), sourceRank,
      displayRank: ranks.get(legacyKey), revision: 1, visibility: 'authenticated', ownerUid: null }));
  };
  return projectKeys(Object.keys(source), 'c').map(base => {
    const values = source[base.legacyKey];
    if (!record(values)) fail(`category ${JSON.stringify(base.legacyKey)}: expected map`);
    const items = projectKeys(Object.keys(values), 'i').map(item => normalizeItem({ ...item, value: values[item.legacyKey] }));
    return { category: normalizeCategory({ ...base, itemCount: items.length }), items };
  });
};

const restoreLegacyCodex = groups => Object.fromEntries([...groups]
  .sort((a, b) => a.category.sourceRank - b.category.sourceRank)
  .map(({ category, items }) => {
    normalizeCategory(category);
    if (items.length !== category.itemCount || new Set(items.map(x => x.legacyKey)).size !== items.length) fail('category item count/duplicate keys');
    return [category.legacyKey, Object.fromEntries([...items].sort((a, b) => a.sourceRank - b.sourceRank)
      .map(item => { normalizeItem(item); return [item.legacyKey, item.value]; }))];
  }));

const validatePageRequest = ({ control, category = null, order = 'display', pageSize = CODEX_PAGE_SIZE, cursor = null }) => {
  const state = normalizeControl(control);
  if (state.source !== 'v2') fail('page source is not v2');
  if (!['display', 'source'].includes(order) || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > CODEX_MAX_PAGE_SIZE) fail('page size/order');
  if (category) normalizeCategory(category);
  const scope = { version: 1, generation: state.generation, epoch: state.epoch,
    categoryId: category?.id || null, revision: category?.revision ?? state.metadataRevision, order, pageSize };
  if (cursor && (!record(cursor) || Object.entries(scope).some(([key, value]) => cursor[key] !== value)
    || !validId(cursor.id) || !Number.isFinite(cursor.rank) || cursor.rank < 0)) fail('cursor is stale or belongs to another page');
  return { ...scope, rankField: `${order}Rank` };
};

const createPage = (rows, request) => {
  const { rankField, ...scope } = validatePageRequest(request);
  if (!Array.isArray(rows) || rows.length > scope.pageSize + 1) fail('unbounded page');
  const normalize = request.category ? normalizeItem : normalizeCategory;
  const normalized = rows.map(normalize);
  const items = normalized.slice(0, scope.pageSize);
  const hasMore = normalized.length > scope.pageSize;
  const last = items[items.length - 1];
  return Object.freeze({ items: Object.freeze(items), hasMore,
    cursor: hasMore ? Object.freeze({ ...scope, rank: last[rankField], id: last.id }) : null,
    control: normalizeControl(request.control), category: request.category || null });
};

// Insert without touching existing documents. Precision exhaustion is an
// explicit backend recovery condition, not permission to silently reorder.
const allocateDisplayRank = (before = null, after = null) => {
  const rank = before === null ? (after === null ? CODEX_RANK_GAP : after / 2)
    : after === null ? before + CODEX_RANK_GAP : before + (after - before) / 2;
  if (!Number.isFinite(rank) || rank < 0 || (before !== null && rank <= before) || (after !== null && rank >= after)) fail('display rank exhausted; fenced rebalance required');
  return rank;
};

module.exports = { CODEX_SCHEMA_VERSION, CODEX_PAGE_SIZE, CODEX_MAX_PAGE_SIZE, CODEX_RANK_GAP,
  normalizeControl, normalizeCategory, normalizeItem, normalizeName, projectLegacyCodex,
  restoreLegacyCodex, validatePageRequest, createPage, allocateDisplayRank };
