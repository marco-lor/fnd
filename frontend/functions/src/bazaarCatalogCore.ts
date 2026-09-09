import {scanTask07MediaTargetReferences} from './mediaAssetLifecycleCore';
/** Version 1 uses the runtime's en-US ICU collation, pinned in activation metadata. */
export const VERSION = 1;
export const COLLATION = 'en-US';
export type Row = Record<string, any>;
const meaningful = (v: any): boolean => Array.isArray(v) ? v.some(meaningful) : v && typeof v === 'object' ? Object.values(v).some(meaningful) : typeof v === 'number' ? !Number.isNaN(v) : typeof v === 'boolean' ? v : v != null && String(v).trim() !== '';
const number = (v: any) => typeof v === 'number' ? (Number.isFinite(v) ? v : 0) : parseFloat(v) || 0;
const levelOne = (v: Row = {}) => Object.fromEntries(Object.entries(v).map(([k, d]) => [k, number(d?.['1'])]));
export const isItem = (d: Row, id: string) => !!(d.item_type && d.General && d.Specific && d.Parametri && !id.startsWith('schema_'));
export const visible = (d: Row, uid: string, role: string) => role === 'dm' || d.visibility === 'all' || (d.visibility === 'custom' && Array.isArray(d.allowed_users) && d.allowed_users.includes(uid));
// Match the legacy card resolver without embedding the original item payload.
const legacyImageUrl = (d: Row): string => {
    const allowed = (v: any) => typeof v === 'string' && /^(https?:\/\/|blob:|data:image\/|\/(?!\/))/i.test(v.trim()) ? v.trim() : '';
    const explicit = allowed(d.General?.image_url);
    if (explicit) return explicit;
    for (const source of [d, d.General || {}]) {
        for (const key of ['url','downloadUrl','imageUrl','image_url']) {
            const value = allowed(source[key]);
            if (value) return value;
        }
    }
    return '';
};
export function projectSummary(d: Row, version: number, rank: number): Row {
    const raw = d.General?.prezzo;
    const media = catalogItemMedia(d).media;
    // Copy only card/confirmation derivatives; never originals, videos or embedded bindings.
    const variants = Object.fromEntries(['thumbnail', 'thumbnail2x', 'card', 'card2x'].filter(k => media?.variants?.[k]).map(k => [k, media.variants[k]]));
    return { schemaVersion: VERSION, id: d.id, name: d.General?.Nome || 'Oggetto Sconosciuto', searchName: String(d.General?.Nome || '').toLowerCase(),
        price: typeof raw === 'number' ? number(raw) : parseInt(raw, 10) || 0,
        slot: d.General?.Slot ?? null, hands: d.Specific?.Hands ?? null, tipo: d.Specific?.Tipo ?? null,
        item_type: d.item_type, visibility: d.visibility || 'none', allowed_users: Array.isArray(d.allowed_users) ? d.allowed_users : [],
        special: Object.keys(d.Parametri?.Special || {}).filter(k => meaningful(d.Parametri.Special[k])),
        base: levelOne(d.Parametri?.Base), combat: levelOne(d.Parametri?.Combattimento),
        imageUrl: legacyImageUrl(d),
        media: Object.keys(variants).length ? { assetId: media.assetId, kind: 'item', state: media.state || 'legacy', schemaVersion: media.schemaVersion || 1, variants } : null,
        catalogVersion: version, rank };
}
export const compareNames = (a: Row, b: Row) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), COLLATION) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export function allocateRank(rows: Row[], next: Row): number {
    const ordered = rows.filter(r => r.id !== next.id).sort(compareNames);
    const rightIndex = ordered.findIndex(r => compareNames(next, r) < 0);
    const right = rightIndex < 0 ? null : ordered[rightIndex];
    const left = rightIndex < 0 ? ordered[ordered.length - 1] : ordered[rightIndex - 1];
    const rank = left && right ? left.rank + (right.rank - left.rank) / 2 : left ? left.rank + 1024 : right ? right.rank - 1024 : 0;
    if (!Number.isFinite(rank) || (left && rank <= left.rank) || (right && rank >= right.rank))
        throw new Error('Catalog rank exhausted; rebuild required.');
    return rank;
}
const selected = (v: any) => Array.isArray(v) && v.length && !v.includes('All') ? v : [];
export function evaluateSummaries(rows: Row[], f: Row): Row[] {
    const matches = (key: string, v: any) => !selected(f[key]).length || selected(f[key]).includes(v);
    const score = (r: Row) => selected(f.selectedBaseParams).reduce((s: number, k: string) => s + (r.base[k] || 0), 0) + selected(f.selectedCombatParams).reduce((s: number, k: string) => s + (r.combat[k] || 0), 0);
    return rows.filter(r => (!String(f.searchTerm || '').trim() || r.searchName.includes(String(f.searchTerm).toLowerCase())) && matches('selectedSlot', r.slot) && matches('selectedHands', r.hands == null ? undefined : String(r.hands)) && matches('selectedTipo', r.tipo) && matches('selectedItemType', r.item_type) && (!selected(f.selectedSpecialParams).length || selected(f.selectedSpecialParams).some((k: string) => r.special.includes(k))) && (!f.onlyAffordable || r.price <= number(f.userGold))).sort((a, b) => score(b) - score(a) || compareNames(a, b));
}
export const advanced = (f: Row) => !!String(f.searchTerm || '').trim() || !!f.onlyAffordable || ['selectedSlot', 'selectedHands', 'selectedTipo', 'selectedItemType', 'selectedSpecialParams', 'selectedBaseParams', 'selectedCombatParams'].some(k => selected(f[k]).length);
export function facetValues(rows: Row[]): Row {
    const unique = (values: any[]) => Array.from(new Set(values)).sort((a, b) => String(a).localeCompare(String(b), COLLATION));
    return { slots: unique(rows.map(r => r.slot).filter(Boolean)), hands: unique(rows.map(r => r.hands).filter(h => h != null)).sort((a, b) => Number(a) - Number(b)).map(String), tipos: unique(rows.map(r => r.tipo).filter(Boolean)), itemTypes: unique(rows.map(r => r.item_type).filter(Boolean)), special: unique(rows.flatMap(r => r.special)), base: unique(rows.flatMap(r => Object.keys(r.base))), combat: unique(rows.flatMap(r => Object.keys(r.combat))) };
}

const SUMMARY_KEYS = new Set(['generation','schemaVersion','id','name','searchName','price','slot','hands','tipo','item_type','visibility','allowed_users','special','base','combat','imageUrl','media','catalogVersion','rank']);
export function validSummary(row: Row): boolean {
    return Object.keys(row).every(key => SUMMARY_KEYS.has(key))
        && row.schemaVersion === VERSION && typeof row.id === 'string'
        && typeof row.name === 'string' && typeof row.searchName === 'string'
        && Number.isFinite(row.rank) && Number.isFinite(row.price)
        && Number.isSafeInteger(row.catalogVersion) && row.catalogVersion > 0
        && Array.isArray(row.allowed_users) && Array.isArray(row.special)
        && row.base != null && typeof row.base === 'object'
        && row.combat != null && typeof row.combat === 'object';
}

/** Same root/General alias identity policy as the Task07 catalog target adapter. */
export function catalogItemMedia(d: Row): Row {
    const scan = scanTask07MediaTargetReferences(d).media;
    const media = !scan.malformed && scan.assetIds.length === 1 ? (d.media || d.General?.media) : null;
    return {
        id: d.id,
        media,
        // Catalog target revisions are root-owned, including legacy General-only media.
        task07MediaRevision: Number.isSafeInteger(d.task07MediaRevision) && d.task07MediaRevision >= 0 ? d.task07MediaRevision : 0,
        mediaUpdatedAt: d.mediaUpdatedAt || null,
    };
}