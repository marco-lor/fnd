import React, { useEffect, useMemo, useState } from "react";
import { db } from "../../firebaseConfig";
import { useAuth } from "../../../AuthContext";
import {
    collection,
    onSnapshot,
    doc,
    serverTimestamp,
    setDoc,
    writeBatch,
    getDocs,
} from "firebase/firestore";
import DiceRoller from "../../common/DiceRoller";
import { Button } from "./ui";

const EncounterDetails = ({ encounter, isDM }) => {
    const { user, userData } = useAuth();
    const [participantsMap, setParticipantsMap] = useState({}); // { uid: full participant doc }
    const [roller, setRoller] = useState({ visible: false, faces: 0, modifier: 0 });
    const [dadiAnimaByLevel, setDadiAnimaByLevel] = useState([]);
    const [selfState, setSelfState] = useState({ hpCurrent: "", hpTemp: "", manaCurrent: "", conditions: "", notes: "" });
    const [myDocKey, setMyDocKey] = useState(null);

    const isParticipant = useMemo(() => {
        if (!user) return false;
        const cid = userData?.characterId;
        const keys = Object.keys(participantsMap || {});
        return keys.includes(user.uid) || (cid ? keys.includes(cid) : false);
    }, [user, userData?.characterId, participantsMap]);

    useEffect(() => {
        (async () => {
            try {
                const snap = await import("firebase/firestore").then(({ doc, getDoc }) =>
                    getDoc(doc(db, "utils", "varie"))
                );
                if (snap.exists()) setDadiAnimaByLevel(snap.data().dadiAnimaByLevel || []);
            } catch {}
        })();
    }, []);

    useEffect(() => {
        let active = true;
        const coll = collection(db, "encounters", encounter.id, "participants");
        const unsub = onSnapshot(coll, (snap) => {
            if (!active) return;
            const pmap = {};
            snap.forEach((d) => {
                const data = d.data() || {};
                pmap[d.id] = data;
            });
            setParticipantsMap(pmap);
        });
        return () => {
            active = false;
            unsub();
        };
    }, [encounter.id]);

    useEffect(() => {
        if (!user) return;
        const cid = userData?.characterId;
        const candidate = participantsMap[user.uid] || (cid ? participantsMap[cid] : null);
        if (candidate) {
            setMyDocKey(participantsMap[user.uid] ? user.uid : cid || null);
            setSelfState({
                hpCurrent: candidate?.hp?.current ?? "",
                hpTemp: candidate?.hp?.temp ?? "",
                manaCurrent: candidate?.mana?.current ?? "",
                conditions: Array.isArray(candidate?.conditions) ? candidate.conditions.join(", ") : "",
                notes: candidate?.notes ?? "",
            });
        }
    }, [participantsMap, user, userData?.characterId]);

    const getDexTot = () => {
        const base = userData?.Parametri?.Base || {};
        const key = Object.keys(base).find((k) => k.toLowerCase() === "destrezza");
        return Number(base?.[key]?.Tot) || 0;
    };

    const computeFaces = () => {
        const lvl = Number(userData?.stats?.level) || 0;
        const diceStr = dadiAnimaByLevel[(lvl - 1) | 0] || dadiAnimaByLevel[lvl] || "";
        const faces = parseInt(String(diceStr).replace(/^d/i, ""), 10);
        return Number.isFinite(faces) && faces > 0 ? faces : 0;
    };

    const startRoll = () => {
        const faces = computeFaces();
        const modifier = getDexTot();
        if (!faces) return alert("Impossibile determinare il Dado Anima.");
        setRoller({ visible: true, faces, modifier });
    };

    const saveInitiative = async (total, faces, modifier) => {
        if (!user) return;
        try {
            const key = myDocKey || user.uid;
            await setDoc(
                doc(db, "encounters", encounter.id, "participants", key),
                {
                    uid: user.uid,
                    characterId: userData?.characterId || null,
                    email: user?.email || null,
                    initiative: {
                        value: total,
                        faces,
                        modifier,
                        rolledAt: serverTimestamp(),
                    },
                    updatedAt: serverTimestamp(),
                },
                { merge: true }
            );
        } catch (e) {
            console.error("Failed to save initiative", e);
            alert("Non hai i permessi per salvare l'iniziativa. Contatta il DM.");
        }
    };

    const saveSelfState = async () => {
        if (!user) return;
        const conditions = selfState.conditions
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        try {
            const key = myDocKey || user.uid;
            await setDoc(
                doc(db, "encounters", encounter.id, "participants", key),
                {
                    uid: user.uid,
                    hp: { current: selfState.hpCurrent === "" ? null : Number(selfState.hpCurrent), temp: selfState.hpTemp === "" ? 0 : Number(selfState.hpTemp) },
                    mana: { current: selfState.manaCurrent === "" ? null : Number(selfState.manaCurrent) },
                    conditions,
                    notes: selfState.notes,
                    updatedAt: serverTimestamp(),
                },
                { merge: true }
            );
        } catch (e) {
            console.error("Failed to save player state", e);
            alert("Non hai i permessi per aggiornare il tuo stato. Contatta il DM.");
        }
    };

    const rows = Object.entries(participantsMap).map(([docKey, data]) => {
        const initiativeVal = data?.initiative?.value ?? (typeof data?.initiative === "number" ? data.initiative : null);
        return {
            key: docKey,
            uid: data?.uid || docKey,
            label: data?.characterId || data?.email || data?.uid || docKey,
            initiative: initiativeVal,
            meta: data && typeof data.initiative === "object" ? data.initiative : initiativeVal != null ? { value: initiativeVal } : null,
        };
    });
    rows.sort((a, b) => (b.initiative ?? -Infinity) - (a.initiative ?? -Infinity));

    return (
        <div className="mt-2 rounded-xl border border-slate-700/50 bg-slate-900/50 p-3">
            <div className="flex items-center justify-between mb-2 gap-2">
                <div className="text-sm text-slate-300">Dettagli Incontro</div>
                <div className="flex flex-wrap gap-2 justify-end">
                    {isParticipant && (
                        <Button kind="primary" onClick={startRoll}>Tira Iniziativa (Dado Anima + Destrezza)</Button>
                    )}
                    {isDM && (
                        <Button
                            kind="danger"
                            onClick={async () => {
                                const ok = window.confirm(
                                    `Sei sicuro di voler eliminare l'incontro${encounter.name ? ` "${encounter.name}"` : ""}?\nQuesta azione eliminerà definitivamente il documento e i partecipanti.`
                                );
                                if (!ok) return;
                                try {
                                    const encRef = doc(db, "encounters", encounter.id);
                                    const participantsRef = collection(db, "encounters", encounter.id, "participants");
                                    const batch = writeBatch(db);
                                    // Delete all participants docs first
                                    const partSnap = await getDocs(participantsRef);
                                    partSnap.forEach((d) => batch.delete(d.ref));
                                    // Delete the encounter doc itself
                                    batch.delete(encRef);
                                    await batch.commit();
                                } catch (e) {
                                    console.error(e);
                                    alert("Failed to delete encounter.");
                                }
                            }}
                        >
                            Delete
                        </Button>
                    )}
                </div>
            </div>

            {isParticipant && (
                <div className="mb-3 grid gap-2 md:grid-cols-2">
                    <div className="text-xs text-slate-400 md:col-span-2">Aggiorna il tuo stato</div>
                    <div className="flex gap-2">
                        <input
                            type="number"
                            value={selfState.hpCurrent}
                            onChange={(e) => setSelfState((s) => ({ ...s, hpCurrent: e.target.value }))}
                            placeholder="HP attuali"
                            className="w-full px-3 py-2 rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        />
                        <input
                            type="number"
                            value={selfState.hpTemp}
                            onChange={(e) => setSelfState((s) => ({ ...s, hpTemp: e.target.value }))}
                            placeholder="HP temporanei"
                            className="w-full px-3 py-2 rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        />
                    </div>
                    <div className="flex gap-2">
                        <input
                            type="number"
                            value={selfState.manaCurrent}
                            onChange={(e) => setSelfState((s) => ({ ...s, manaCurrent: e.target.value }))}
                            placeholder="Mana attuale"
                            className="w-full px-3 py-2 rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        />
                        <input
                            value={selfState.conditions}
                            onChange={(e) => setSelfState((s) => ({ ...s, conditions: e.target.value }))}
                            placeholder="Condizioni (separate da virgola)"
                            className="w-full px-3 py-2 rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        />
                    </div>
                    <textarea
                        rows={2}
                        value={selfState.notes}
                        onChange={(e) => setSelfState((s) => ({ ...s, notes: e.target.value }))}
                        placeholder="Note personali per il combattimento"
                        className="w-full px-3 py-2 rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                    <div>
                        <Button kind="secondary" onClick={saveSelfState}>Salva Stato</Button>
                    </div>
                </div>
            )}

            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-slate-300">
                    <thead className="text-[11px] uppercase tracking-wider text-slate-400/80 bg-white/5">
                        <tr>
                            <th className="px-3 py-2 font-medium">Giocatore</th>
                            <th className="px-3 py-2 text-center font-medium">Iniziativa</th>
                            <th className="px-3 py-2 text-center font-medium">Dettagli</th>
                            {isDM && (
                                <th className="px-3 py-2 text-center font-medium">HP/Mana</th>
                            )}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {rows.map((r) => (
                            <tr key={r.key} className="odd:bg-transparent even:bg-white/[0.02]">
                                <td className="px-3 py-2 text-white">{r.label}</td>
                                <td className="px-3 py-2 text-center">
                                    {r.initiative !== null ? (
                                        <span className="inline-flex min-w-[2.25rem] justify-center rounded-md bg-indigo-500/10 px-2 py-0.5 text-indigo-300 ring-1 ring-inset ring-indigo-400/30 tabular-nums">
                                            {r.initiative}
                                        </span>
                                    ) : (
                                        <span className="text-slate-500">—</span>
                                    )}
                                </td>
                                <td className="px-3 py-2 text-center text-xs text-slate-400">
                                    {r.meta ? `d${r.meta.faces} ${r.meta.modifier ? "+ " + r.meta.modifier : ""}` : ""}
                                </td>
                                {isDM && (
                                    <td className="px-3 py-2 text-center text-xs text-slate-400">
                                        {(() => {
                                            const p = participantsMap[r.key] || {};
                                            const hp = p.hp || {};
                                            const mana = p.mana || {};
                                            return `HP ${hp.current ?? "?"}${hp.temp ? ` (+${hp.temp})` : ""} / Mana ${mana.current ?? "?"}`;
                                        })()}
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {roller.visible && (
                <DiceRoller
                    faces={roller.faces}
                    count={1}
                    modifier={roller.modifier}
                    description={`Iniziativa (d${roller.faces} + ${roller.modifier})`}
                    onComplete={(total) => {
                        saveInitiative(total, roller.faces, roller.modifier);
                        setRoller({ visible: false, faces: 0, modifier: 0 });
                    }}
                />
            )}
        </div>
    );
};

export default EncounterDetails;
