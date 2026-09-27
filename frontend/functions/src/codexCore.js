'use strict';
const crypto = require('node:crypto');
const M = require('./codexModel');
const CONTROL = 'utils/codex_control', LEGACY = 'utils/codex';
const PAGE = 200, MAX_DOCUMENT_BYTES = 1000000;
const error = (code, message) => { throw Object.assign(Error(message), {code}); };
const check = (condition, message, code = 'failed-precondition') => { if (!condition) error(code, message); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
// Include captured map order, independently of content canonicalization.
const sourceHash = source => hash(Object.entries(source).map(([key, items]) => [key, Object.entries(items)]));
const idOK = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
const keyOK = key => typeof key === 'string' && key.isWellFormed() && key.length > 0 && Buffer.byteLength(key) <= 1500 && !/^__.*__$/.test(key);
const runtime = () => ({node: process.versions.node, icu: process.versions.icu});
function encodedSize(path, value) {
  // Firestore documented storage encoding: name components+16, document+32,
  // field UTF8+1, nested maps+32, strings UTF8+1, doubles/int64=8.
  const size = v => v === null || typeof v === 'boolean' ? 1 : typeof v === 'number' ? 8
    : typeof v === 'string' ? Buffer.byteLength(v) + 1 : Array.isArray(v) ? v.reduce((s, x) => s + size(x), 0)
      : 32 + Object.entries(v).reduce((s, [k, x]) => s + Buffer.byteLength(k) + 1 + size(x), 0);
  return 16 + path.split('/').reduce((s, x) => s + Buffer.byteLength(x) + 1, 0) + size(value) + 256;
}
function inspectSource(source, locale = 'en-US') {
  const invalid = [];
  const visit = (value, path) => {
    if (typeof value === 'string' && !value.isWellFormed()) invalid.push({path, reason: 'invalid Unicode string'});
    if (value && typeof value === 'object' && !Array.isArray(value)) for (const [key, child] of Object.entries(value)) {
      if (!keyOK(key)) invalid.push({path: [...path, key], reason: 'empty, reserved or overlong map key'});
      visit(child, [...path, key]);
    } else if (Array.isArray(value)) value.forEach((child, i) => visit(child, [...path, i]));
  };
  visit(source, []);
  let groups = [];
  try { groups = M.projectLegacyCodex(source, locale); } catch (failure) { invalid.push({path: [], reason: failure.message}); }
  if (invalid.length) return {valid: false, invalid};
  for (const group of groups) for (const row of [group.category, ...group.items]) {
    if (encodedSize('codex_versions/g/categories/c/items/i', row) > MAX_DOCUMENT_BYTES) invalid.push({path: [group.category.legacyKey, row.legacyKey], reason: 'document size exceeds conservative limit'});
  }
  return {valid: !invalid.length, invalid, groups, sourceDigest: sourceHash(source),
    categories: groups.length, items: groups.reduce((s, g) => s + g.items.length, 0), jsonBytes: Buffer.byteLength(JSON.stringify(source))};
}
const controlData = value => { const {source, readOnly, ...stored} = M.normalizeControl(value); return stored; };
const categoryPath = (generation, id) => `codex_versions/${generation}/categories/${id}`;
const rows = snapshot => snapshot.docs.map(doc => { const data = doc.data(); check(data.id === doc.id, 'Stored entity ID mismatch.'); return data; });
const normalize = (row, kind) => { try { return kind === 'category' ? M.normalizeCategory(row) : M.normalizeItem(row); } catch (_) { error('failed-precondition', 'Corrupt Codex entity.'); } };
function validateRows(entities, kind, locale) {
  entities.forEach(row => normalize(row, kind));
  for (const field of ['id', 'legacyKey', 'sourceRank', 'displayRank']) check(new Set(entities.map(row => row[field])).size === entities.length, 'Duplicate Codex identity/key/rank.');
  const source = [...entities].sort((a, b) => a.sourceRank - b.sourceRank);
  // sourceRank records insertion order. Reconstruction through Object.fromEntries
  // applies JS integer-key enumeration, just as the legacy map does; these two
  // orders intentionally differ when a numeric key is inserted later.
  const expected = [...source].sort((a, b) => a.legacyKey.toLowerCase().localeCompare(b.legacyKey.toLowerCase(), locale));
  const actual = [...entities].sort((a, b) => a.displayRank - b.displayRank);
  check(hash(expected.map(row => row.id)) === hash(actual.map(row => row.id)), 'Display rank order is corrupt.');
}
function insertion(existing, key, locale) {
  check(keyOK(key), 'Invalid Codex key.', 'invalid-argument');
  check(!existing.some(row => row.legacyKey === key), 'Codex key already exists.', 'already-exists');
  const sorted = [...existing].sort((a, b) => a.displayRank - b.displayRank);
  const afterIndex = sorted.findIndex(row => key.toLowerCase().localeCompare(row.legacyKey.toLowerCase(), locale) < 0);
  const after = afterIndex < 0 ? null : sorted[afterIndex].displayRank;
  const before = afterIndex < 0 ? sorted.at(-1)?.displayRank ?? null : sorted[afterIndex - 1]?.displayRank ?? null;
  let displayRank;
  try { displayRank = M.allocateDisplayRank(before, after); } catch (_) { error('resource-exhausted', 'Display rank exhausted; operator recovery required.'); }
  const sourceRank = existing.reduce((max, row) => Math.max(max, row.sourceRank), -1) + 1;
  check(Number.isSafeInteger(sourceRank), 'Source rank exhausted.', 'resource-exhausted');
  return {sourceRank, displayRank};
}
function validateMutation(input) {
  check(input && typeof input === 'object' && !Array.isArray(input), 'Invalid mutation.', 'invalid-argument');
  const actions = {'category-add': ['legacyKey', 'metadataRevision'], 'category-delete': ['categoryId', 'categoryRevision', 'metadataRevision'],
    'item-add': ['categoryId', 'categoryRevision', 'legacyKey', 'value'], 'item-edit': ['categoryId', 'categoryRevision', 'itemId', 'itemRevision', 'value'],
    'item-delete': ['categoryId', 'categoryRevision', 'itemId', 'itemRevision']};
  const fields = ['action', 'epoch', 'generation', ...(actions[input.action] || [])];
  check(actions[input.action] && Object.keys(input).length === fields.length && fields.every(key => Object.hasOwn(input, key)), 'Unknown/missing mutation fields.', 'invalid-argument');
  check(idOK(input.generation) && Number.isSafeInteger(input.epoch) && input.epoch >= 0, 'Invalid control scope.', 'invalid-argument');
  for (const key of ['categoryRevision', 'itemRevision', 'metadataRevision']) if (Object.hasOwn(input, key)) check(Number.isSafeInteger(input[key]) && input[key] >= (key === 'metadataRevision' ? 0 : 1), 'Invalid revision.', 'invalid-argument');
  for (const key of ['categoryId', 'itemId']) if (Object.hasOwn(input, key)) check(idOK(input[key]), 'Invalid entity ID.', 'invalid-argument');
  if (Object.hasOwn(input, 'legacyKey')) check(keyOK(input.legacyKey), 'Invalid key.', 'invalid-argument');
  return input;
}
async function mutateCodex(db, uid, input) {
  const p = validateMutation(input);
  // Identity is allocated once outside transaction retry; never based on a rank.
  const newId = crypto.randomUUID();
  return db.runTransaction(async tx => {
    const [actor, deletion, controlSnapshot] = await tx.getAll(db.doc(`users/${uid}`), db.doc(`user_deletion_jobs/${uid}`), db.doc(CONTROL));
    check(actor.exists && actor.get('deletionState') !== 'pending' && !deletion.exists && ['dm', 'webmaster'].includes(actor.get('role')), 'Codex editor role required.', 'permission-denied');
    const c = controlData(controlSnapshot.exists ? controlSnapshot.data() : null);
    check(c.mode === 'v2', 'Codex writes are frozen or use legacy mode.');
    check(c.epoch === p.epoch && c.generation === p.generation, 'Codex control changed; reload.', 'aborted');
    const base = db.collection(`codex_versions/${c.generation}/categories`);
    if (p.action === 'category-add' || p.action === 'item-add') {
      const marker = await tx.get(db.doc(`codex_versions/${c.generation}`));
      check(marker.exists && marker.get('status') === 'active' && marker.get('runtime.icu') === process.versions.icu,
        'Codex collation runtime changed; operator reconciliation required.');
    }
    if (p.action.startsWith('category-')) {
      if (p.action === 'category-delete') check(c.metadataRevision === p.metadataRevision, 'Codex metadata changed; reload.', 'aborted');
      check(Number.isSafeInteger(c.metadataRevision + 1), 'Metadata revision exhausted.', 'resource-exhausted');
    }
    if (p.action === 'category-add') {
      const existing = rows(await tx.get(base));
      const deleted = await tx.get(db.collection(`codex_versions/${c.generation}/deleted_categories`));
      validateRows(existing, 'category', c.collationLocale);
      // Check the whole transactional category set, including off-page rows.
      // On a concurrent case-variant retry, report the collision before stale
      // metadata; other stale additions still reject without changing anything.
      check(!existing.some(row => row.legacyKey.toLowerCase() === p.legacyKey.toLowerCase()), 'Codex category already exists.', 'already-exists');
      check(c.metadataRevision === p.metadataRevision, 'Codex metadata changed; reload.', 'aborted');
      const ranks = insertion(existing, p.legacyKey, c.collationLocale);
      ranks.sourceRank = deleted.docs.reduce((max, d) => Math.max(max, d.data().category.sourceRank + 1), ranks.sourceRank);
      const category = normalize({id: newId, schemaVersion: 2, legacyKey: p.legacyKey, normalizedName: M.normalizeName(p.legacyKey), ...ranks, revision: 1, visibility: 'authenticated', ownerUid: null, itemCount: 0}, 'category');
      tx.create(base.doc(newId), category);
      tx.update(db.doc(CONTROL), {metadataRevision: c.metadataRevision + 1});
      return {category};
    }
    const ref = base.doc(p.categoryId), snapshot = await tx.get(ref);
    check(snapshot.exists, 'Category no longer exists.', 'not-found');
    const category = normalize(snapshot.data(), 'category');
    check(category.id === p.categoryId && category.revision === p.categoryRevision, 'Category changed; reload.', 'aborted');
    if (p.action === 'category-delete') {
      // Atomic logical delete: bodies remain unreachable, never partly deleted.
      tx.create(db.doc(`codex_versions/${c.generation}/deleted_categories/${category.id}`), {schemaVersion: 2, category});
      tx.delete(ref); tx.update(db.doc(CONTROL), {metadataRevision: c.metadataRevision + 1});
      return {deleted: true, categoryId: category.id};
    }
    let item, itemRef;
    if (p.action === 'item-add') {
      // Projection reads only compact ordering fields, never unrelated bodies.
      const compact = (await tx.get(ref.collection('items').select('id', 'legacyKey', 'sourceRank', 'displayRank'))).docs.map(d => d.data());
      check(compact.length === category.itemCount, 'Corrupt category item count.');
      item = {id: newId, schemaVersion: 2, legacyKey: p.legacyKey, normalizedName: M.normalizeName(p.legacyKey), ...insertion(compact, p.legacyKey, c.collationLocale), revision: 1, visibility: 'authenticated', ownerUid: null, value: p.value};
      itemRef = ref.collection('items').doc(newId);
    } else {
      itemRef = ref.collection('items').doc(p.itemId);
      const previous = await tx.get(itemRef);
      check(previous.exists, 'Item no longer exists.', 'not-found');
      item = normalize(previous.data(), 'item');
      check(item.id === p.itemId && item.revision === p.itemRevision, 'Item changed; reload.', 'aborted');
      if (p.action === 'item-edit') item = {...item, value: p.value, revision: item.revision + 1};
    }
    if (p.action !== 'item-delete') {
      try { M.normalizeItem(item); } catch (_) { error('invalid-argument', 'Unsupported Codex value.'); }
      check(inspectSource({category: {[item.legacyKey]: item.value}}).valid, 'Invalid keys or oversized value.', 'invalid-argument');
      check(encodedSize(itemRef.path, item) <= MAX_DOCUMENT_BYTES, 'Codex item is too large.', 'resource-exhausted');
    }
    const next = {...category, revision: category.revision + 1, itemCount: category.itemCount + (p.action === 'item-add' ? 1 : p.action === 'item-delete' ? -1 : 0)};
    normalize(next, 'category');
    if (p.action === 'item-delete') tx.delete(itemRef); else tx.set(itemRef, item);
    tx.set(ref, next);
    return {category: next, ...(p.action === 'item-delete' ? {deleted: true, itemId: item.id} : {item})};
  });
}

// Operator inventory includes missing parent documents and all nested paths.
// Only admins can mutate this namespace. Each legitimate migration transaction
// also reads/writes the generation marker/control, fencing concurrent operators.
async function inventory(db, generation) {
  if (!generation) return [];
  const found = [];
  let level = [db.doc(`codex_versions/${generation}`)];
  while (level.length) {
    const next = [];
    for (let start = 0; start < level.length; start += 32) await Promise.all(level.slice(start, start + 32).map(async ref => {
      found.push(ref);
      for (const collection of await ref.listCollections()) next.push(...await collection.listDocuments());
    }));
    level = next;
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}
async function readState(db, generation = null) {
  const refs = await inventory(db, generation);
  return db.runTransaction(async tx => readStateInTransaction(db, tx, refs), {readOnly: true});
}
async function readStateInTransaction(db, tx, refs) {
  const [source, control] = await tx.getAll(db.doc(LEGACY), db.doc(CONTROL));
  const documents = [];
  for (let start = 0; start < refs.length; start += PAGE) {
    for (const snapshot of await tx.getAll(...refs.slice(start, start + PAGE))) if (snapshot.exists) documents.push({path: snapshot.ref.path, data: snapshot.data()});
  }
  return {source: source.exists ? source.data() : null, control: control.exists ? control.data() : null, documents};
}
function targetRows(state, generation, locale, {partial = false} = {}) {
  const root = `codex_versions/${generation}`, groups = [], deleted = [];
  const map = new Map(state.documents.map(d => [d.path, d.data]));
  const marker = map.get(root); map.delete(root);
  for (const [p, data] of [...map]) if (new RegExp(`^${root}/categories/[^/]+$`).test(p)) {
    check(p === `${root}/categories/${data.id}`, 'Category identity mismatch.');
    groups.push({category: data, items: []}); map.delete(p);
  }
  for (const [p, data] of [...map]) if (new RegExp(`^${root}/deleted_categories/[^/]+$`).test(p)) {
    check(data.schemaVersion === 2 && Object.keys(data).length === 2 && p === `${root}/deleted_categories/${data.category?.id}`, 'Corrupt deletion marker.');
    deleted.push({category: data.category, items: []}); map.delete(p);
  }
  check(!groups.some(g => deleted.some(d => d.category.id === g.category.id)), 'Deleted category resurrected.');
  for (const group of [...groups, ...deleted]) {
    const prefix = `${root}/categories/${group.category.id}/items/`;
    for (const [p, data] of [...map]) if (p.startsWith(prefix) && p === prefix + data.id) { group.items.push(data); map.delete(p); }
    if (!partial) check(group.items.length === group.category.itemCount, 'Missing/extra category items.');
    validateRows(group.items, 'item', locale); normalize(group.category, 'category');
  }
  check(map.size === 0, 'Unexpected or orphaned Codex documents.');
  validateRows(groups.map(g => g.category), 'category', locale);
  for (const field of ['id', 'sourceRank']) check(new Set([...groups, ...deleted].map(g => g.category[field])).size === groups.length + deleted.length, 'Reused deleted category identity/rank.');
  return {groups, deleted, marker};
}
function expectedDocuments(source, generation, locale) {
  const checked = inspectSource(source, locale); check(checked.valid, 'Invalid legacy source; inspect invalid-key report.');
  return checked.groups.flatMap(({category, items}) => [{path: categoryPath(generation, category.id), data: category}, ...items.map(item => ({path: `${categoryPath(generation, category.id)}/items/${item.id}`, data: item}))]);
}
function verifyMigration(state, generation, locale, complete = true) {
  const expected = expectedDocuments(state.source, generation, locale);
  const root = `codex_versions/${generation}`;
  const actual = new Map(state.documents.filter(d => d.path !== root).map(d => [d.path, d.data]));
  for (const d of expected) {
    if (actual.has(d.path)) { check(hash(actual.get(d.path)) === hash(d.data), 'Corrupt target projection.'); actual.delete(d.path); }
    else check(!complete, 'Missing target projection.');
  }
  check(actual.size === 0, 'Unexpected target projection.');
  if (complete) check(sourceHash(M.restoreLegacyCodex(targetRows(state, generation, locale).groups)) === sourceHash(state.source), 'Reconstructed source/order mismatch.');
  return expected;
}
const ACTIONS = ['freeze', 'backfill', 'verify', 'activate', 'rollback-freeze', 'rollback', 'resume-v2'];
function makePlan(state, action, generation, scope = {}) {
  check(ACTIONS.includes(action) && idOK(generation), 'Invalid migration action/generation.');
  const c = controlData(state.control), source = inspectSource(state.source, c.collationLocale);
  const root = `codex_versions/${generation}`;
  const target = {documents: state.documents.length,
    categories: state.documents.filter(d => new RegExp(`^${root}/categories/[^/]+$`).test(d.path)).length,
    items: state.documents.filter(d => new RegExp(`^${root}/categories/[^/]+/items/[^/]+$`).test(d.path)).length,
    deletionMarkers: state.documents.filter(d => new RegExp(`^${root}/deleted_categories/[^/]+$`).test(d.path)).length,
    digest: hash(state.documents)};
  let rollback = null;
  if (['v2', 'rollback-frozen'].includes(c.mode)) {
    try {
      const {groups} = targetRows(state, generation, c.collationLocale), restored = M.restoreLegacyCodex(groups);
      const encodedBytes = encodedSize(LEGACY, restored);
      rollback = {valid: true, digest: sourceHash(restored), encodedBytes, fits: encodedBytes <= MAX_DOCUMENT_BYTES,
        categories: groups.length, items: groups.reduce((sum, group) => sum + group.items.length, 0)};
    } catch (_) { rollback = {valid: false, fits: false, reason: 'Current generation integrity verification failed.'}; }
  }
  const body = {schemaVersion: 2, action, generation, scope, runtime: runtime(), stateDigest: hash(state),
    control: c, source: {...source, groups: undefined}, target,
    checkpoint: state.documents.find(d => d.path === root)?.data || null, rollback};
  return {...body, fingerprint: hash(body)};
}
function validatePlan(plan, fingerprint, state, action, generation, scope) {
  const {fingerprint: stored, ...body} = plan || {};
  check(stored === fingerprint && stored === hash(body) && stored === makePlan(state, action, generation, scope).fingerprint, 'Reviewed migration plan is stale or mismatched.');
}
async function applyPlan(db, plan, fingerprint, scope = {}) {
  const {generation, action} = plan, refs = await inventory(db, generation);
  return db.runTransaction(async tx => {
    const state = await readStateInTransaction(db, tx, refs);
    validatePlan(plan, fingerprint, state, action, generation, scope);
    const c = controlData(state.control), root = `codex_versions/${generation}`, ref = db.doc(root);
    const marker = state.documents.find(d => d.path === root)?.data;
    const source = inspectSource(state.source, c.collationLocale);
    const transition = (mode, extra = {}) => {
      check(Number.isSafeInteger(c.epoch + 1), 'Control epoch exhausted.', 'resource-exhausted');
      tx.set(db.doc(CONTROL), {...c, mode, epoch: c.epoch + 1, ...extra});
    };
    if (action === 'rollback' && c.mode === 'legacy' && !marker && state.documents.length === 0) return {mode: 'legacy', replayed: true};
    if (action === 'freeze') {
      check(c.mode === 'legacy' && source.valid && state.documents.length === 0, 'Freeze requires valid legacy source and unused generation.');
      tx.create(ref, {schemaVersion: 2, generation, sourceDigest: source.sourceDigest, categories: source.categories, items: source.items,
        runtime: runtime(), offset: 0, status: 'building'});
      transition('frozen', {generation}); return {mode: 'frozen', offset: 0};
    }
    check(c.generation === generation && marker?.generation === generation && marker.schemaVersion === 2, 'Migration generation mismatch.');
    if (['backfill', 'verify', 'activate'].includes(action)) {
      check(c.mode === 'frozen' && ['building', 'verified'].includes(marker.status) && source.valid && marker.sourceDigest === source.sourceDigest && hash(marker.runtime) === hash(runtime()), 'Frozen source/control/runtime changed.');
      const expected = verifyMigration(state, generation, c.collationLocale, action !== 'backfill');
      check(Number.isSafeInteger(marker.offset) && marker.offset >= 0 && marker.offset <= expected.length && marker.categories === source.categories && marker.items === source.items, 'Corrupt migration checkpoint.');
      const actual = new Map(state.documents.map(d => [d.path, d.data]));
      for (const d of expected.slice(0, marker.offset)) check(actual.has(d.path), 'Completed checkpoint document missing.');
      if (action === 'backfill') {
        const end = Math.min(expected.length, marker.offset + PAGE);
        for (const d of expected.slice(marker.offset, end)) if (!actual.has(d.path)) tx.create(db.doc(d.path), d.data);
        tx.set(ref, {...marker, offset: end, status: 'building'});
        return {mode: 'frozen', offset: end, total: expected.length, complete: end === expected.length};
      }
      check(marker.offset === expected.length, 'Backfill checkpoint incomplete.');
      if (action === 'verify') { tx.set(ref, {...marker, status: 'verified'}); return {verified: true, categories: source.categories, items: source.items}; }
      check(marker.status === 'verified', 'Verify before activation.');
      tx.set(ref, {...marker, status: 'active'}); transition('v2'); return {mode: 'v2'};
    }
    if (action === 'rollback-freeze') {
      check(c.mode === 'v2' && marker.status === 'active', 'Rollback freeze requires active v2.');
      transition('rollback-frozen'); return {mode: 'rollback-frozen'};
    }
    if (action === 'resume-v2') {
      check(c.mode === 'rollback-frozen' && marker.status === 'active', 'Only active v2 rollback freeze can resume.');
      targetRows(state, generation, c.collationLocale);
      transition('v2'); return {mode: 'v2'};
    }
    check(action === 'rollback', 'Invalid rollback action.');
    if (c.mode === 'legacy' && marker.status === 'rolled-back') return {mode: 'legacy', replayed: true};
    if (c.mode === 'frozen') {
      check(source.valid && marker.sourceDigest === source.sourceDigest, 'Frozen legacy source changed.');
      verifyMigration(state, generation, c.collationLocale, false);
      transition('legacy'); tx.set(ref, {...marker, status: 'rolled-back'}); return {mode: 'legacy'};
    }
    check(c.mode === 'rollback-frozen' && marker.status === 'active', 'Freeze v2 before reconstructing rollback.');
    const {groups} = targetRows(state, generation, c.collationLocale);
    const restored = M.restoreLegacyCodex(groups), checked = inspectSource(restored, c.collationLocale);
    check(checked.valid && hash(M.restoreLegacyCodex(checked.groups)) === hash(restored), 'Rollback reconstruction mismatch.');
    const bytes = encodedSize(LEGACY, restored);
    check(bytes <= MAX_DOCUMENT_BYTES, 'Rollback aggregate exceeds conservative Firestore limit; remain frozen or resume-v2.', 'resource-exhausted');
    tx.set(db.doc(LEGACY), restored);
    transition('legacy'); tx.set(ref, {...marker, status: 'rolled-back', rollbackDigest: sourceHash(restored), rollbackEncodedBytes: bytes});
    return {mode: 'legacy', categories: checked.categories, items: checked.items, encodedBytes: bytes, digest: sourceHash(restored)};
  });
}
module.exports = {M, CONTROL, LEGACY, PAGE, MAX_DOCUMENT_BYTES, hash, sourceHash, runtime, encodedSize, inspectSource, validateRows, insertion,
  validateMutation, mutateCodex, inventory, readState, targetRows, verifyMigration, makePlan, validatePlan, applyPlan, ACTIONS};
