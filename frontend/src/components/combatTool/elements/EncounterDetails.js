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
    addDoc,
    runTransaction,
} from "firebase/firestore";
import DiceRoller from "../../common/DiceRoller";
import { Button } from "./ui";

const EncounterDetails = ({ encounter, isDM }) => {
    const { user, userData } = useAuth();
    const [participantsMap, setParticipantsMap] = useState({}); // { uid: full participant doc }
    const [roller, setRoller] = useState({ visible: false, faces: 0, modifier: 0 });
    const [dadiAnimaByLevel, setDadiAnimaByLevel] = useState([]);
    // Only keep a personal note for the encounter; HP/Mana are now auto-fetched from user profile
    const [selfNote, setSelfNote] = useState("");
    const [myDocKey, setMyDocKey] = useState(null);
    // Live encounter meta (link mode)
    const [encMeta, setEncMeta] = useState({});
    // Live users map (uid -> user doc) when encounter is linked to user parameters
    const [liveUsersMap, setLiveUsersMap] = useState({});

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

    // Listen to encounter meta (to know if it's detached from user params)
    useEffect(() => {
        let active = true;
        const encRef = doc(db, "encounters", encounter.id);
        const unsub = onSnapshot(encRef, (snap) => {
            if (!active) return;
            setEncMeta(snap.data() || {});
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
            setSelfNote(candidate?.notes ?? "");
        }
    }, [participantsMap, user, userData?.characterId]);

    // Determine if current player has already rolled initiative
    const myParticipant = useMemo(() => {
        return (
            (myDocKey && participantsMap[myDocKey]) ||
            (user?.uid ? participantsMap[user.uid] : null) ||
            (userData?.characterId ? participantsMap[userData.characterId] : null) ||
            null
        );
    }, [participantsMap, myDocKey, user?.uid, userData?.characterId]);

    const hasRolledInitiative = useMemo(() => {
        const ids = new Set([user?.uid, userData?.characterId].filter(Boolean));
        for (const [k, data] of Object.entries(participantsMap)) {
            if (ids.has(k) || ids.has(data?.uid) || ids.has(data?.characterId)) {
                const init = data?.initiative;
                if (init != null && (typeof init === "number" || init?.value != null)) return true;
            }
        }
        return false;
    }, [participantsMap, user?.uid, userData?.characterId]);

    // Subscribe to user docs for all participants (only when linked to user params)
    // IMPORTANT: Only DMs should subscribe to other users' docs (players/webmasters shouldn't to avoid permission errors).
    useEffect(() => {
        // Only allow DM to read other users' docs
        if (!isDM) {
            setLiveUsersMap({});
            return;
        }

        const linkMode = encMeta?.linkMode || "live"; // default live
        const unsubs = [];
        if (linkMode !== "detached") {
            const uids = Object.values(participantsMap)
                .map((p) => p?.uid)
                .filter(Boolean);
            const unique = Array.from(new Set(uids));
            unique.forEach((uid) => {
                const uRef = doc(db, "users", uid);
                const unsub = onSnapshot(
                    uRef,
                    (snap) => {
                        setLiveUsersMap((prev) => ({ ...prev, [uid]: snap.data() || null }));
                    },
                    // Swallow permission errors gracefully
                    (err) => {
                        if (typeof process !== "undefined" && process.env && process.env.NODE_ENV !== "production") {
                            // eslint-disable-next-line no-console
                            console.warn("users doc subscription error", uid, err?.message || err);
                        }
                    }
                );
                unsubs.push(unsub);
            });
        } else {
            setLiveUsersMap({});
        }
        return () => {
            unsubs.forEach((u) => u());
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDM, encMeta?.linkMode, JSON.stringify(Object.values(participantsMap).map((p) => p?.uid).sort())]);

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
        if (hasRolledInitiative) {
            alert("Hai già tirato l'iniziativa per questo incontro.");
            return;
        }
        const faces = computeFaces();
        const modifier = getDexTot();
        if (!faces) return alert("Impossibile determinare il Dado Anima.");
        setRoller({ visible: true, faces, modifier });
    };

    const saveInitiative = async (total, faces, modifier, details) => {
        if (!user) return;
        if (hasRolledInitiative) {
            alert("Hai già tirato l'iniziativa per questo incontro.");
            return;
        }
        try {
            const key = myDocKey || user.uid;
            const pRef = doc(db, "encounters", encounter.id, "participants", key);

            // Atomic guard: only set initiative if not already present
            await runTransaction(db, async (tx) => {
                const snap = await tx.get(pRef);
                const data = snap.exists() ? snap.data() : {};
                const alreadyHere = data?.initiative != null && (typeof data.initiative === "number" || data.initiative?.value != null);
                // Also guard against an alt participant doc (uid vs characterId)
                const altKeys = [];
                if (userData?.characterId && userData.characterId !== key) altKeys.push(userData.characterId);
                if (user?.uid && user.uid !== key) altKeys.push(user.uid);
                let alreadyAlt = false;
                for (const ak of altKeys) {
                    const aRef = doc(db, "encounters", encounter.id, "participants", ak);
                    const aSnap = await tx.get(aRef);
                    const aData = aSnap.exists() ? aSnap.data() : {};
                    const init = aData?.initiative;
                    if (init != null && (typeof init === "number" || init?.value != null)) {
                        alreadyAlt = true;
                        break;
                    }
                }
                if (alreadyHere || alreadyAlt) {
                    throw new Error("already-rolled");
                }
                tx.set(
                    pRef,
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
            });

            // Write to shared log
            try {
                const display = userData?.characterId || user?.email || user.uid;
                const expr = `d${faces}${modifier ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : ""}`;
                await addDoc(collection(db, "encounters", encounter.id, "logs"), {
                    type: "roll",
                    kind: "initiative",
                    by: display,
                    uid: user.uid,
                    description: `Iniziativa (Destrezza ${modifier >= 0 ? "+" : ""}${modifier})`,
                    expression: expr,
                    total,
                    rolls: details?.rolls || [],
                    modifier,
                    faces,
                    createdAt: serverTimestamp(),
                });
            } catch (logErr) {
                console.warn("Failed to write roll log", logErr);
            }
        } catch (e) {
            if (e && e.message === "already-rolled") {
                alert("Hai già tirato l'iniziativa per questo incontro.");
                setRoller({ visible: false, faces: 0, modifier: 0 });
                return;
            }
            console.error("Failed to save initiative", e);
            alert("Non hai i permessi per salvare l'iniziativa. Contatta il DM.");
        }
    };

    const saveSelfNote = async () => {
        if (!user) return;
        try {
            const key = myDocKey || user.uid;
            await setDoc(
                doc(db, "encounters", encounter.id, "participants", key),
                {
                    uid: user.uid,
                    notes: selfNote,
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
                        <Button
                            kind="primary"
                            onClick={startRoll}
                            disabled={hasRolledInitiative}
                            title={hasRolledInitiative ? "Hai già tirato l'iniziativa" : undefined}
                        >
                            {hasRolledInitiative ? "Iniziativa già tirata" : "Tira Iniziativa (Dado Anima + Destrezza)"}
                        </Button>
                    )}
                    {isDM && (
                        <>
                        <Button
                            kind="secondary"
                            onClick={async () => {
                                if (encMeta?.linkMode === "detached") return; // already detached
                                const ok = window.confirm("Staccare l'incontro dai parametri utente? Verranno salvati gli HP/Mana attuali come istantanea.");
                                if (!ok) return;
                                try {
                                    const batch = writeBatch(db);
                                    // Snapshot current stats into participant docs
                                    for (const [pKey, pdata] of Object.entries(participantsMap)) {
                                        const uid = pdata?.uid || pKey;
                                        const u = liveUsersMap[uid];
                                        const hpC = u?.stats?.hpCurrent ?? null;
                                        const manaC = u?.stats?.manaCurrent ?? null;
                                        const pRef = doc(db, "encounters", encounter.id, "participants", pKey);
                                        batch.set(pRef, { hp: { current: hpC, temp: 0 }, mana: { current: manaC } }, { merge: true });
                                    }
                                    // Mark encounter as detached
                                    const encRef = doc(db, "encounters", encounter.id);
                                    batch.set(encRef, { linkMode: "detached", detachedAt: serverTimestamp() }, { merge: true });
                                    await batch.commit();
                                } catch (e) {
                                    console.error(e);
                                    alert("Impossibile staccare l'incontro.");
                                }
                            }}
                            disabled={encMeta?.linkMode === "detached"}
                            title={encMeta?.linkMode === "detached" ? "Già staccato" : "Stacca dai parametri utente"}
                        >
                            {encMeta?.linkMode === "detached" ? "Staccato" : "Stacca (HP/Mana)"}
                        </Button>
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
                        </>
                    )}
                </div>
            </div>

            {isParticipant && (
                <div className="mb-3 grid gap-2">
                    <div className="text-xs text-slate-400">Note personali per il combattimento</div>
                    <textarea
                        rows={2}
                        value={selfNote}
                        onChange={(e) => setSelfNote(e.target.value)}
                        placeholder="Aggiungi note utili per questo incontro"
                        className="w-full px-3 py-2 rounded-md border border-slate-700/60 bg-slate-900/60 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                    <div>
                        <Button kind="secondary" onClick={saveSelfNote}>Salva Note</Button>
                    </div>
                </div>
            )}

            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-slate-300">
                    <thead className="text-[11px] uppercase tracking-wider text-slate-400/80 bg-white/5">
                        <tr>
                            <th className="px-3 py-2 font-medium">Giocatore</th>
                            <th className="px-3 py-2 text-center font-medium">Iniziativa</th>
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
                                {isDM && (
                                    <td className="px-3 py-2 text-center text-xs text-slate-400">
                                        {(() => {
                                            const linkMode = encMeta?.linkMode || "live";
                                            if (linkMode !== "detached") {
                                                const u = liveUsersMap[r.uid] || {};
                                                const hpC = u?.stats?.hpCurrent;
                                                const manaC = u?.stats?.manaCurrent;
                                                const hpStr = hpC == null ? "?" : hpC;
                                                const manaStr = manaC == null ? "?" : manaC;
                                                return `HP ${hpStr} / Mana ${manaStr}`;
                                            }
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
                    onComplete={(total, info) => {
                        saveInitiative(total, roller.faces, roller.modifier, info);
                        setRoller({ visible: false, faces: 0, modifier: 0 });
                    }}
                />
            )}
        </div>
    );
};

export default EncounterDetails;
