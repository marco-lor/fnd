import * as admin from 'firebase-admin';
import { createHash, createHmac, randomBytes } from 'crypto';
import { FieldPath, FieldValue, Filter } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { VERSION, COLLATION, Row, catalogItemMedia, isItem, visible, projectSummary, compareNames, allocateRank, evaluateSummaries, advanced, facetValues, validSummary } from './bazaarCatalogCore';
import { reconcileCatalogEdit } from './bazaarCatalogEdit';
export const META = 'catalogControl/bazaar';
export const SUMMARIES = 'catalogSummaries';
const region = 'europe-west8';
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const digest = (v: any) => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const signature = (v: any, key: string) => createHmac('sha256', key).update(JSON.stringify(canonical(v))).digest('hex');
const fail = (s: string): never => { throw new HttpsError('failed-precondition', s); };
const id = (v: any) => typeof v === 'string' && v.length > 0 && v.length < 1500 && !v.includes('/') ? v : fail('Invalid catalog ID.');
const active = (m: Row) => { if (m.state !== 'active' || m.schemaVersion !== VERSION || m.collation !== COLLATION || m.icu !== process.versions.icu)
    fail('Catalog migration is incomplete or incompatible.'); };
async function actor(tx: admin.firestore.Transaction, db: admin.firestore.Firestore, uid: string) {
    const [u, t] = await tx.getAll(db.doc(`users/${uid}`), db.doc(`user_deletion_jobs/${uid}`));
    if (!u.exists || t.exists || u.get('deletionState') === 'pending')
        throw new HttpsError('permission-denied', 'Inactive user.');
    return String(u.get('role') || '');
}
const uidOf = (r: any) => r.auth?.uid || (() => { throw new HttpsError('unauthenticated', 'Sign in required.'); })();
const visibleQuery = (db: admin.firestore.Firestore, uid: string, role: string, generation: string) => {
    const q = db.collection(SUMMARIES).where('generation', '==', generation);
    return role === 'dm' ? q : q.where(Filter.or(Filter.where('visibility', '==', 'all'), Filter.and(Filter.where('visibility', '==', 'custom'), Filter.where('allowed_users', 'array-contains', uid))));
};
export const task09CatalogPage = onCall({ region }, async (r) => {
    const uid = uidOf(r), db = admin.firestore();
    const input = r.data || {}, filters = input.filters || {};
    if (JSON.stringify(input).length > 16000)
        throw new HttpsError('invalid-argument', 'Query too large.');
    const started = Date.now();
    return db.runTransaction(async (tx) => {
        const role = await actor(tx, db, uid);
        const meta = (await tx.get(db.doc(META))).data() || {};
        active(meta);
        if (input.revision !== meta.revision)
            fail('Catalog revision changed.');
        const secret = (await tx.get(db.doc('catalogPrivate/bazaar'))).get('cursorSecret');
        if (typeof secret !== 'string')
            fail('Catalog signing key missing.');
        const queryKey = digest({ uid, role, generation: meta.generation, revision: meta.revision, accessGeneration: input.accessGeneration || 0, filters });
        const cursor = input.cursor;
        if (cursor && cursor.signature !== signature({ key: cursor.key, offset: cursor.offset, rank: cursor.rank }, secret))
            fail("Invalid cursor signature.");
        if (cursor && (cursor.key !== queryKey || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || !Number.isFinite(cursor.rank)))
            fail('Invalid or stale catalog cursor.');
        const scan = advanced(filters) || input.facets === true;
        let q = visibleQuery(db, uid, role, meta.generation).orderBy('rank');
        if (!scan) {
            if (cursor)
                q = q.startAfter(cursor.rank);
            q = q.limit(50);
        }
        const snap = await tx.get(q);
        const evaluationStart = process.cpuUsage();
        const rows: Row[] = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        if (rows.some((d, i) => !validSummary(d) || (i > 0 && rows[i - 1].rank >= d.rank)))
            fail('Invalid catalog projection.');
        const evaluated = scan ? evaluateSummaries(rows, filters) : rows;
        const offset = scan ? (cursor?.offset || 0) : 0;
        const page = evaluated.slice(offset, offset + 50);
        const more = scan ? offset + 50 < evaluated.length : page.length === 50;
        const nextCursor = more && page.length ? { key: queryKey, offset: (cursor?.offset || 0) + page.length, rank: page[page.length - 1].rank } : null;
        const facets = input.facets ? facetValues(rows) : null;
        const summaryJsonBytes = Buffer.byteLength(JSON.stringify(rows));
        const cpu = process.cpuUsage(evaluationStart);
        return { rows: page, revision: meta.revision, queryKey, facets,
            cursor: nextCursor ? { ...nextCursor, signature: signature(nextCursor, secret) } : null,
            costs: { mode: scan ? 'advanced-scan' : 'default-page', summaryDocuments: snap.size, summaryJsonBytes, evaluationCpuMicros: cpu.user + cpu.system, returnedDocuments: page.length, metadataDocuments: 4, cpuAndReadMs: Date.now() - started } };
    });
});
// Readers never obtain full catalog payloads from the summary endpoint.
export const task09CatalogDetail = onCall({ region }, async (r) => {
    const uid = uidOf(r), db = admin.firestore(), itemId = id(r.data?.itemId);
    return db.runTransaction(async (tx) => {
        const role = await actor(tx, db, uid);
        const meta = (await tx.get(db.doc(META))).data() || {};
        active(meta);
        if (r.data?.revision !== meta.revision)
            fail('Catalog revision changed.');
        const d = await tx.get(db.doc(`items/${itemId}`));
        if (!d.exists || !isItem(d.data() || {}, d.id) || !visible(d.data() || {}, uid, role))
            throw new HttpsError('permission-denied', 'Item unavailable.');
        return { ...d.data(), id: d.id };
    });
});
export const task09WriteCatalogItem = onCall({ region }, async (r) => {
    const uid = uidOf(r), db = admin.firestore(), itemId = id(r.data?.itemId), operationId = id(r.data?.operationId);
    const input = r.data || {}, hash = digest(input);
    return db.runTransaction(async (tx) => {
        const role = await actor(tx, db, uid);
        if (!['dm', 'webmaster'].includes(role))
            throw new HttpsError('permission-denied', 'Catalog editor required.');
        const ref = db.doc(`items/${itemId}`), receipt = db.doc(`catalogOperations/${uid}_${digest(operationId)}`);
        const [metaSnap, old, prior] = await tx.getAll(db.doc(META), ref, receipt);
        if (prior.exists) {
            if (prior.get('hash') !== hash)
                fail('Operation ID reused.');
            return prior.get('result');
        }
        const m = metaSnap.data() || {};
        if (m.state === 'building')
            fail('Catalog migration in progress; retry after activation.');
        if (m.state !== 'active')
            fail('Catalog must be activated before editing.');
        active(m);
        const summaries = await tx.get(db.collection(SUMMARIES).where('generation', '==', m.generation));
        const version = (old.get('catalogVersion') || 0) + 1;
        if (input.action === 'delete') {
            tx.delete(ref);
            tx.delete(db.doc(`${SUMMARIES}/${itemId}`));
            tx.delete(db.doc(`catalogMedia/${itemId}`));
        }
        else {
            const next = reconcileCatalogEdit(old.data() || {}, input.item || {}, input.replace === true);
            delete next.id;
            next.catalogVersion = version;
            if (!isItem(next, itemId))
                fail('Invalid item shape.');
            const summary = projectSummary({ ...next, id: itemId }, version, 0);
            try {
                summary.rank = allocateRank(summaries.docs.map(d => d.data()), summary);
            }
            catch (e) {
                fail(String(e));
            }
            tx.set(ref, next);
            if (!old.exists) tx.set(db.doc(`catalogMedia/${itemId}`), catalogItemMedia({...next, id: itemId}));
            tx.set(db.doc(`${SUMMARIES}/${itemId}`), { ...summary, generation: m.generation });
        }
        const result = { itemId, catalogVersion: version };
        tx.update(db.doc(META), { revision: m.revision + 1 });
        tx.set(receipt, { hash, result });
        return result;
    });
});
/** Called before any transaction writes in the Task07 catalog mutation paths. */
export async function synchronizeCatalogMedia(tx: admin.firestore.Transaction, db: admin.firestore.Firestore, ref: admin.firestore.DocumentReference, current: Row, patch: Row) {
    if (ref.parent.id !== 'items' || ref.id.startsWith('schema_'))
        return;
    const [meta, s] = await tx.getAll(db.doc(META), db.doc(`${SUMMARIES}/${ref.id}`));
    const m = meta.data() || {};
    if (m.state === 'building')
        fail('Catalog migration in progress.');
    const next: Row = {...current, ...patch, id: ref.id, General: {...(current.General || {}), ...(patch.General || {})}};
    for (const [key, value] of Object.entries(patch)) {
        if (key.startsWith('General.')) {
            const field = key.slice('General.'.length);
            if (value instanceof FieldValue) delete next.General[field];
            else next.General[field] = value;
            delete next[key];
        } else if (value instanceof FieldValue) delete next[key];
    }
    if (patch.media !== undefined || patch['General.media'] !== undefined || patch.General?.media !== undefined)
        tx.set(db.doc(`catalogMedia/${ref.id}`), catalogItemMedia(next));
    if (m.state !== 'active')
        return; // preactivation media remains compatible; migration reads current source.
    active(m);
    if (!s.exists || s.get('generation') !== m.generation)
        fail('Catalog projection missing.');
    const version = (current.catalogVersion || 0) + 1;
    const summary = projectSummary(next, version, s.get('rank'));
    tx.set(db.doc(`${SUMMARIES}/${ref.id}`), { ...summary, generation: m.generation });
    tx.update(ref, { catalogVersion: version });
    tx.update(db.doc(META), { revision: m.revision + 1 });
}
/** Offline operator entrypoint: each transaction is resumable; source writers freeze. */
export async function migrateCatalog(db: admin.firestore.Firestore, action: 'begin' | 'step' | 'activate' | 'rollback') {
    return db.runTransaction(async (tx) => {
        const ref = db.doc(META), m = (await tx.get(ref)).data() || {};
        if (action === 'rollback') {
            tx.set(ref, { ...m, state: 'inactive', revision: (m.revision || 0) + 1 });
            return { state: 'inactive' };
        }
        if (action === 'begin') {
            if (m.state === 'building')
                return m;
            const next = { schemaVersion: VERSION, collation: COLLATION, icu: process.versions.icu, state: 'building', generation: String((m.revision || 0) + 1), revision: (m.revision || 0) + 1, offset: 0 };
            tx.set(ref, next);

            tx.set(db.doc('catalogPrivate/bazaar'), { cursorSecret: randomBytes(32).toString('hex') });
            return next;
        }
        if (action === 'activate' && m.state === 'active') {
            active(m);
            return { state: 'active', total: m.total };
        }
        if (m.state !== 'building')
            fail('Begin migration first.');
        const source = await tx.get(db.collection('items').orderBy(FieldPath.documentId()));
        const rows = source.docs.filter(d => isItem(d.data(), d.id)).map(d => projectSummary({ ...d.data(), id: d.id }, d.get('catalogVersion') || 1, 0)).sort(compareNames);
        rows.forEach((d, i) => { d.rank = i * 1024; });
        const mediaRows = await tx.get(db.collection('catalogMedia'));
        const liveIds = new Set(rows.map(d => d.id));
        const orphans = mediaRows.docs.filter(d => !liveIds.has(d.id));
        if (action === 'step') {
            const page = rows.slice(m.offset, m.offset + 150);
            for (const d of page) {
                tx.set(db.doc(`${SUMMARIES}/${d.id}`), { ...d, generation: m.generation });
                tx.update(db.doc(`items/${d.id}`), { catalogVersion: d.catalogVersion });
                const full = source.docs.find(v => v.id === d.id)!;
                tx.set(db.doc(`catalogMedia/${d.id}`), catalogItemMedia({...full.data(), id: d.id}));
            }
            const removed = orphans.slice(0, 499 - page.length * 3);
            for (const d of removed)
                tx.delete(d.ref);
            tx.update(ref, { offset: m.offset + page.length, total: rows.length });
            return { processed: page.length, offset: m.offset + page.length, total: rows.length, cleanupRemaining: orphans.length - removed.length };
        }
        const summaries = await tx.get(db.collection(SUMMARIES).where('generation', '==', m.generation));
        const actual = summaries.docs.map(d => d.data()).sort(compareNames).map(({ generation, ...d }) => d);
        if (rows.some(d => !validSummary(d)) || orphans.length || mediaRows.size !== rows.length || m.offset !== rows.length || digest(actual) !== digest(rows))
            fail('Projection incomplete or source changed; restart migration.');
        tx.update(ref, { state: 'active', revision: m.revision + 1, total: rows.length });
        return { state: 'active', total: rows.length };
    });
}
