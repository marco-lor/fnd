import React, { useEffect, useMemo, useState } from "react";
import { db } from "../../firebaseConfig";
import {
    collection,
    onSnapshot,
    query,
    serverTimestamp,
    where,
    writeBatch,
    doc,
} from "firebase/firestore";
import { Button, Section, TextInput, Chip } from "./ui";

const normalize = (s) => (s || "").trim().toLowerCase();

const EncounterCreator = ({ isDM, currentUid }) => {
    const [name, setName] = useState("");
    const [assignableUsers, setAssignableUsers] = useState([]); // {uid, characterId, email}
    const [selected, setSelected] = useState([]); // same shape as above
    const [singleInput, setSingleInput] = useState("");
    const [notFound, setNotFound] = useState([]);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        if (!isDM) return; // Fetch list only for DM UI
        const usersCol = collection(db, "users");
        const qUsers = query(usersCol, where("role", "in", ["player", "webmaster"]));
        const unsub = onSnapshot(qUsers, (snap) => {
            const list = [];
            snap.forEach((d) => {
                const data = d.data();
                const authUid = data?.uid || d.id;
                list.push({
                    uid: authUid,
                    characterId: data.characterId || "",
                    email: data.email || "",
                });
            });
            setAssignableUsers(list);
        });
        return () => unsub();
    }, [isDM]);

    const byCharId = useMemo(() => {
        const map = new Map();
        for (const u of assignableUsers) {
            if (u.characterId) map.set(normalize(u.characterId), u);
        }
        return map;
    }, [assignableUsers]);

    const addByCharacterId = (cid) => {
        const key = normalize(cid);
        if (!key) return;
        const user = byCharId.get(key);
        if (!user) {
            setNotFound((nf) => Array.from(new Set([...nf, cid])));
            return;
        }
        setSelected((prev) => {
            if (prev.some((p) => p.uid === user.uid)) return prev;
            return [...prev, user];
        });
    };

    const removeSelected = (uid) => setSelected((prev) => prev.filter((p) => p.uid !== uid));

    const onAddSingle = () => {
        addByCharacterId(singleInput);
        setSingleInput("");
    };

    const onAddAll = () => {
        const toAdd = assignableUsers.filter((u) => !selected.some((s) => s.uid === u.uid));
        if (toAdd.length) setSelected((prev) => [...prev, ...toAdd]);
    };

    const canCreate = isDM && name.trim().length > 0 && selected.length > 0 && !creating;

    const createEncounter = async () => {
        if (!canCreate) return;
        try {
            setCreating(true);
            const participants = selected.map((u) => ({ uid: u.uid, characterId: u.characterId || "", email: u.email || "" }));
            const batch = writeBatch(db);
            const encRef = doc(collection(db, "encounters"));
            batch.set(encRef, {
                name: name.trim(),
                status: "published",
                createdAt: serverTimestamp(),
                createdBy: currentUid,
                participants,
                participantIds: participants.map((p) => p.uid),
                participantCharacterIds: participants.map((p) => p.characterId).filter(Boolean),
            });
            for (const p of participants) {
                const pRef = doc(encRef, "participants", p.uid);
                batch.set(pRef, {
                    uid: p.uid,
                    characterId: p.characterId || null,
                    email: p.email || null,
                    initiative: null,
                    hp: { current: null, temp: 0 },
                    mana: { current: null },
                    conditions: [],
                    notes: "",
                    updatedAt: serverTimestamp(),
                });
            }
            await batch.commit();
            setName("");
            setSelected([]);
            setNotFound([]);
        } catch (err) {
            console.error("Failed to create encounter", err);
            alert("Failed to create encounter. Check console for details.");
        } finally {
            setCreating(false);
        }
    };

    if (!isDM) return null;

    return (
        <Section
            title="Create Encounter"
            actions={<Button size="lg" onClick={createEncounter} disabled={!canCreate}>Crea Encounter</Button>}
        >
            <div className="grid grid-cols-1 gap-4">
                <TextInput label="Encounter name" value={name} onChange={setName} placeholder="e.g., Goblin Ambush" />

                <div>
                    <div className="text-xs text-slate-300 mb-1.5">Add player by Character ID</div>
                    <div className="flex flex-wrap gap-2 items-center">
                        <input
                            value={singleInput}
                            onChange={(e) => setSingleInput(e.target.value)}
                            placeholder="Exact characterId"
                            list="characterIdOptions"
                            className="min-w-0 flex-1 px-3 py-2 rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        />
                        <datalist id="characterIdOptions">
                            {assignableUsers
                                .filter((u) => u.characterId)
                                .sort((a, b) => a.characterId.localeCompare(b.characterId))
                                .map((u) => (
                                    <option key={u.uid} value={u.characterId} />
                                ))}
                        </datalist>
                        <div className="shrink-0">
                            <Button size="sm" kind="secondary" onClick={onAddSingle} disabled={!singleInput.trim()}>Add</Button>
                        </div>
                        <div className="shrink-0">
                            <Button
                                size="sm"
                                kind="secondary"
                                onClick={onAddAll}
                                disabled={assignableUsers.filter((u) => !selected.some((s) => s.uid === u.uid)).length === 0}
                                title="Aggiungi tutti i giocatori disponibili"
                            >
                                Aggiungi tutti
                            </Button>
                        </div>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">Suggerimento: inizia a digitare per vedere le opzioni.</div>
                </div>

                {notFound.length > 0 && (
                    <div className="text-xs text-rose-200 bg-rose-900/30 border border-rose-800/60 rounded-md px-2 py-1.5">
                        Unknown characterIds: {notFound.join(", ")}
                    </div>
                )}

                <div>
                    <div className="text-xs text-slate-300 mb-1.5">Selected players</div>
                    <div className="min-h-[2.25rem] rounded-xl border border-slate-700/60 bg-slate-900/40 p-2">
                        {selected.length === 0 && <span className="text-slate-400">None selected yet</span>}
                        {selected.map((u) => (
                            <Chip key={u.uid} onRemove={() => removeSelected(u.uid)}>
                                {u.characterId || u.email || u.uid}
                            </Chip>
                        ))}
                    </div>
                </div>
            </div>
        </Section>
    );
};

export default EncounterCreator;
