import React, { useContext, useEffect, useState } from 'react';
import { AuthContext, useAuthSession } from '../../../AuthContext';
import { getSchema, getCommonSpells, getCommonTechniques, subscribeConfigInvalidation } from '../../../data/configRepository';
import { getUserDirectoryPage } from '../../../data/userDirectoryRepository';
import VisibilitySelector from '../../common/VisibilitySelector';

const MemoVisibilitySelector = React.memo(VisibilitySelector);
const EMPTY_USERS = Object.freeze([]);

// The authoritative generation changes for both account and access-scope changes.
function useEditorScope() {
    const { user, userData } = useContext(AuthContext);
    const { repositoryAccessGeneration } = useAuthSession();
    return { enabled: Boolean(user?.uid), key: JSON.stringify([user?.uid, userData?.role, repositoryAccessGeneration]) };
}

export function useEditorConfiguration(schemaId) {
    const scope = useEditorScope();
    const [revision, setRevision] = useState(0);
    const [state, setState] = useState(null);
    const retry = () => setRevision(value => value + 1);
    useEffect(() => subscribeConfigInvalidation(documentId => {
        if ([schemaId, 'schema_spell', 'spells_common', 'tecniche_common', 'utils'].includes(documentId)) {
            setRevision(value => value + 1);
        }
    }), [schemaId]);
    useEffect(() => {
        let canceled = false;
        const key = scope.key;
        setState({ key, schemaId, loading: scope.enabled });
        if (scope.enabled) {
            Promise.all([getSchema(schemaId), getSchema('schema_spell'), getCommonSpells(), getCommonTechniques({legacyFirst: true})])
                .then(([schema, spellSchema, commonSpells, commonTechniques]) => {
                    if (!schema || !spellSchema) throw new Error('Schema non disponibile.');
                    if (!canceled) setState({key, schemaId, schema, spellSchema, commonSpells: commonSpells || {}, commonTechniques: commonTechniques || {}, loading: false});
                })
                .catch(error => { if (!canceled) setState({key, schemaId, error, loading: false}); });
        }
        return () => { canceled = true; };
    }, [schemaId, scope.key, scope.enabled, revision]);
    const current = state?.key === scope.key && state?.schemaId === schemaId ? state : null;
    return { ...current, loading: current ? current.loading : scope.enabled, retry };
}

export function EditorConfigurationStatus({ configuration }) {
    return configuration.error ? <div role="alert" className="text-red-300 p-3">
        Impossibile caricare i dati dell'editor. <button type="button" onClick={configuration.retry}>Riprova</button>
    </div> : null;
}

// Keep selection intact even when projections disappear or a page fails to load.
export function EditorVisibilitySelector(props) {
    const scope = useEditorScope();
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState(null);
    const active = props.visibility === 'custom' && scope.enabled;
    useEffect(() => {
        let canceled = false;
        if (!active) return undefined;
        const key = scope.key;
        setState({key, loading: true, users: []});
        const load = async () => {
            const users = new Map();
            const cursors = new Set();
            let cursor = null;
            do {
                const page = await getUserDirectoryPage({cursor});
                if (canceled) return;
                (page.items || []).forEach(entry => users.set(entry.id, {id: entry.id, characterId: entry.label, role: entry.role}));
                if (!page.hasMore) break;
                const cursorKey = JSON.stringify(page.cursor);
                if (!page.cursor || cursors.has(cursorKey)) throw new Error('Paginazione utenti non valida.');
                cursors.add(cursorKey);
                cursor = page.cursor;
            } while (true);
            if (!canceled) setState({key, loading: false, users: [...users.values()]});
        };
        load().catch(error => { if (!canceled) setState({key, loading: false, users: [], error}); });
        return () => { canceled = true; };
    }, [active, scope.key, attempt]);
    const current = state?.key === scope.key ? state : null;
    return <>
        <MemoVisibilitySelector {...props} users={current?.users || EMPTY_USERS}/>
        {active && (!current || current.loading) && <div role="status">Caricamento utenti...</div>}
        {active && current?.error && <div role="alert">Impossibile caricare gli utenti. <button type="button" onClick={() => setAttempt(value => value + 1)}>Riprova utenti</button></div>}
    </>;
}
