import { Row } from './bazaarCatalogCore';
import { stripUntrustedTask07InventoryMedia } from './task07ServerBoundary';
/** Keep the stable identity of retained spell entries; registry/slots remain server-owned. */
export function reconcileCatalogEdit(current: Row, input: Row, replace = false): Row {
    const clean = stripUntrustedTask07InventoryMedia(input) as Row;
    const next = replace ? clean : { ...current, ...clean };
    for (const k of ['media', 'videoMedia', 'task07MediaRevision', 'task07VideoMediaRevision', 'mediaUpdatedAt', 'videoMediaUpdatedAt', 'task07EmbeddedMedia']) {
        if (current[k] !== undefined)
            next[k] = current[k];
        else
            delete next[k];
    }
    // Generic text edits cannot erase or forge the legacy canonical alias.
    // Controlled Task07 attach/retire owns normalization into root slots.
    if (current.General) {
        next.General = {...(next.General || {})};
        for (const key of ['media', 'videoMedia', 'task07MediaRevision', 'task07VideoMediaRevision', 'mediaUpdatedAt', 'videoMediaUpdatedAt']) {
            if (current.General[key] !== undefined) next.General[key] = current.General[key];
            else delete next.General[key];
        }
    }
    const oldSpells = current.General?.spells || {};
    const trustedIds = new Set(Object.values(oldSpells).map((v: any) => v?.task07MediaEntryId).filter(Boolean));
    const usedIds = new Set<string>();
    for (const [name, entry] of Object.entries(input.General?.spells || {}) as [
        string,
        Row
    ][]) {
        if (!entry || typeof entry !== 'object' || !next.General?.spells?.[name])
            continue;
        const supplied = entry.task07MediaEntryId;
        const previous = oldSpells[name]?.task07MediaEntryId;
        const identity = supplied || previous;
        if (!identity)
            continue;
        if (typeof identity !== 'string' || !/^[-_A-Za-z0-9]{1,128}$/.test(identity))
            throw new Error('Invalid embedded media identity.');
        // Existing bindings can only be retained via a trusted existing entry identity.
        if (current.task07EmbeddedMedia?.[identity] && !trustedIds.has(identity))
            throw new Error('Untrusted embedded media binding.');
        if (usedIds.has(identity))
            throw new Error('Duplicate embedded media identity.');
        usedIds.add(identity);
        next.General.spells[name].task07MediaEntryId = identity;
    }
    return next;
}
