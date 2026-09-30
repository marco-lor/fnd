import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth, useAuthSession } from "../../AuthContext";
import TecnicheSide from "./elements/tecniche_side";
import SpellSide from "./elements/spell_side";
import PersonalMediaEditor from "./elements/personalMediaEditor";
import FilterPanel from './FilterPanel';
import { buildSearchEntries, filterSearchEntries } from './searchEntries';
import { getCommonTechniques } from '../../data/configRepository';
import {
  usePersonalSpells,
  usePersonalTechniques,
  useProgression,
  useResources,
} from '../../data/userData/userDataHooks';

const EMPTY_COMMON_TECNICHE = Object.freeze({});

function TecnicheSpell() {
  const { user, userData: authUserData } = useAuth();
  const { repositoryAccessGeneration = 0 } = useAuthSession();
  const contentScopeKey = `${user?.uid || 'anonymous'}:${repositoryAccessGeneration}`;
  const { data: progression, status: progressionStatus } = useProgression(user?.uid);
  const { data: resources, status: resourcesStatus } = useResources(user?.uid);
  const { data: personalTecnicheData, status: techniquesStatus } = usePersonalTechniques(user?.uid);
  const { data: personalSpellsData, status: spellsStatus } = usePersonalSpells(user?.uid);
  const progressionReady = progressionStatus === 'fresh' && progression !== null;
  const resourcesReady = resourcesStatus === 'fresh' && resources !== null;
  const actionDataReady = progressionReady && resourcesReady;
  const userData = useMemo(() => ({
    ...(progression || {}),
    ...(resources || {}),
    uid: actionDataReady ? user?.uid : null,
    characterId: authUserData?.characterId,
    email: user?.email,
    stats: { ...(progression?.stats || {}), ...(resources?.stats || {}) },
  }), [actionDataReady, authUserData?.characterId, progression, resources, user?.email, user?.uid]);
  const personalTecniche = useMemo(
    () => personalTecnicheData || {},
    [personalTecnicheData]
  );
  const [commonTecnicheState, setCommonTecnicheState] = useState({
    scopeKey: null,
    data: EMPTY_COMMON_TECNICHE,
  });
  const commonTecniche = commonTecnicheState.scopeKey === contentScopeKey
    ? commonTecnicheState.data
    : EMPTY_COMMON_TECNICHE;
  const personalSpells = useMemo(
    () => personalSpellsData || {},
    [personalSpellsData]
  );
  const [selectedTecnica, setSelectedTecnica] = useState(null);
  const [selectedSpell, setSelectedSpell] = useState(null);

  // Unified filtering predicate (function(item) => boolean)
  const [predicate, setPredicate] = useState(() => () => true);

  useEffect(() => {
    setSelectedTecnica(null);
    setSelectedSpell(null);
    setPredicate(() => () => true);
    setCommonTecnicheState({ scopeKey: contentScopeKey, data: {} });
  }, [contentScopeKey]);

  // Common config is actor-scoped by the repository runtime. Ignore any
  // in-flight result from the previous UID/access generation.
  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    const fetchCommonTecniche = async () => {
      try {
        const data = await getCommonTechniques();
        if (!active) return;
        if (!data) console.log("No common tecniche document found");
        setCommonTecnicheState({ scopeKey: contentScopeKey, data: data || {} });
      } catch (error) {
        if (!active) return;
        console.error("Error fetching common tecniche:", error);
        setCommonTecnicheState({ scopeKey: contentScopeKey, data: {} });
      }
    };
    fetchCommonTecniche();
    return () => { active = false; };
  }, [contentScopeKey, user]);

  // Normalize and sort only when the domain/config source changes.
  const personalTechniqueEntries = useMemo(() => buildSearchEntries(personalTecniche), [personalTecniche]);
  const commonTechniqueEntries = useMemo(() => buildSearchEntries(commonTecniche), [commonTecniche]);
  const spellEntries = useMemo(() => buildSearchEntries(personalSpells), [personalSpells]);
  const filteredPersonalTecniche = useMemo(() => filterSearchEntries(personalTechniqueEntries, predicate), [personalTechniqueEntries, predicate]);
  const filteredCommonTecniche = useMemo(() => filterSearchEntries(commonTechniqueEntries, predicate), [commonTechniqueEntries, predicate]);
  const filteredPersonalSpells = useMemo(() => filterSearchEntries(spellEntries, predicate), [spellEntries, predicate]);
  const onPredicateChange = useCallback(p => setPredicate(() => p), []);
  const editTecnica = useCallback((name, data) => setSelectedTecnica({ name, data, scopeKey: contentScopeKey }), [contentScopeKey]);
  const editSpell = useCallback((name, data) => setSelectedSpell({ name, data, scopeKey: contentScopeKey }), [contentScopeKey]);

  return (
  <div className="w-full min-h-full relative">
      <div className="relative z-10 w-full min-h-full">
        {[progressionStatus, resourcesStatus, techniquesStatus, spellsStatus].some((status) => status === 'missing' || status === 'error') && (
          <p role="status" className="px-5 pt-4 text-sm text-amber-300">
            Alcuni dati personali non sono disponibili. Le azioni collegate restano disabilitate.
          </p>
        )}
        {/* Unified Filter Panel */}
        <FilterPanel
          personalTecniche={personalTecniche}
          commonTecniche={commonTecniche}
          personalSpells={personalSpells}
          onPredicateChange={onPredicateChange}
        />

        {/* Main content - only render components when data is ready */}
        <main className="flex flex-col items-center p-5 w-full">
          <div className="flex flex-col md:flex-row w-full max-w-[1600px] gap-6 justify-center">
            <TecnicheSide
              key={`techniques:${contentScopeKey}`}
              personalEntries={filteredPersonalTecniche}
              filterKey={predicate}
              commonEntries={filteredCommonTecniche}
              userData={userData}
              onEditPersonalTecnica={editTecnica}
            />

            <SpellSide
              key={`spells:${contentScopeKey}`}
              entries={filteredPersonalSpells}
              filterKey={predicate}
              userData={userData}
              onEditPersonalSpell={editSpell}
            />
          </div>
          {/* Spacer for overlays to extend into */}
          <div className="w-full h-20 mt-6"></div>
        </main>

        {selectedTecnica?.scopeKey === contentScopeKey && userData?.uid && (
          <PersonalMediaEditor
            userId={userData.uid}
            userLabel={userData?.characterId || userData?.email || user?.email}
            itemType="tecnica"
            itemName={selectedTecnica.name}
            itemData={selectedTecnica.data}
            onClose={() => setSelectedTecnica(null)}
          />
        )}

        {selectedSpell?.scopeKey === contentScopeKey && userData?.uid && (
          <PersonalMediaEditor
            userId={userData.uid}
            userLabel={userData?.characterId || userData?.email || user?.email}
            itemType="spell"
            itemName={selectedSpell.name}
            itemData={selectedSpell.data}
            onClose={() => setSelectedSpell(null)}
          />
        )}
      </div>
    </div>
  );
}

export default TecnicheSpell;
