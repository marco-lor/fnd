import React, { useEffect, useMemo, useState } from "react";
import { GiAnimalSkull } from "react-icons/gi";
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
import { advanceTurn as advanceTurnUtil } from "./buttons/advanceTurn";

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
    // Live foes map (foeId -> foe doc) when encounter includes foes and is linked
    const [liveFoesMap, setLiveFoesMap] = useState({});

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
            setLiveFoesMap({});
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

            // Subscribe to foes for foe participants
            const foeIds = Object.values(participantsMap)
                .filter((p) => p?.type === "foe" && p?.foeId)
                .map((p) => p.foeId);
            const uniqueFoes = Array.from(new Set(foeIds));
            uniqueFoes.forEach((foeId) => {
                const fRef = doc(db, "foes", foeId);
                const unsubF = onSnapshot(
                    fRef,
                    (snap) => {
                        setLiveFoesMap((prev) => ({ ...prev, [foeId]: snap.data() || null }));
                    },
                    (err) => {
                        if (typeof process !== "undefined" && process.env && process.env.NODE_ENV !== "production") {
                            // eslint-disable-next-line no-console
                            console.warn("foes doc subscription error", foeId, err?.message || err);
                        }
                    }
                );
                unsubs.push(unsubF);
            });
        } else {
            setLiveUsersMap({});
            setLiveFoesMap({});
        }
        return () => {
            unsubs.forEach((u) => u());
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        isDM,
        encMeta?.linkMode,
        JSON.stringify(Object.values(participantsMap).map((p) => p?.uid).sort()),
        JSON.stringify(
            Object.values(participantsMap)
                .filter((p) => p?.type === "foe" && p?.foeId)
                .map((p) => p.foeId)
                .sort()
        ),
    ]);

    // For foe participants, create a snapshot copy in their participant doc if missing
    useEffect(() => {
        if (!isDM) return;
        const linkMode = encMeta?.linkMode || "live";
        if (linkMode === "detached") return;
        const entries = Object.entries(participantsMap);
        const toWrite = entries.filter(([key, p]) => p?.type === "foe" && p?.foeId && !p?.foeSnapshot && liveFoesMap[p.foeId]);
        if (toWrite.length === 0) return;
        (async () => {
            try {
                for (const [pKey, p] of toWrite) {
                    const foe = liveFoesMap[p.foeId];
                    if (!foe) continue;
                    const pRef = doc(db, "encounters", encounter.id, "participants", pKey);
                    await setDoc(
                        pRef,
                        {
                            foeSnapshot: {
                                id: p.foeId,
                                name: foe?.name || "",
                                category: foe?.category || "",
                                rank: foe?.rank || "",
                                dadoAnima: foe?.dadoAnima || "",
                                stats: foe?.stats || {},
                                Parametri: foe?.Parametri || {},
                                imageUrl: foe?.imageUrl || "",
                            },
                            foeSnapshotAt: serverTimestamp(),
                        },
                        { merge: true }
                    );
                }
            } catch (e) {
                if (typeof process !== "undefined" && process.env && process.env.NODE_ENV !== "production") {
                    // eslint-disable-next-line no-console
                    console.warn("failed to write foeSnapshot", e);
                }
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDM, encMeta?.linkMode, encounter.id, JSON.stringify(participantsMap), JSON.stringify(liveFoesMap)]);

    // DM-only: Foe initiative roller
    const [foeRoller, setFoeRoller] = useState({ visible: false, faces: 0, modifier: 0, pKey: null, label: "" });

    const getFoeDexTot = (foeDocOrSnap) => {
        try {
            const base = foeDocOrSnap?.Parametri?.Base || {};
            const key = Object.keys(base).find((k) => k.toLowerCase() === "destrezza");
            return Number(base?.[key]?.Tot) || 0;
        } catch {
            return 0;
        }
    };

    const parseFacesFromDado = (dadoStr) => {
        const faces = parseInt(String(dadoStr || "").replace(/^d/i, ""), 10);
        return Number.isFinite(faces) && faces > 0 ? faces : 0;
    };

    const startFoeRoll = (pKey) => {
        const p = participantsMap[pKey];
        if (!p || p?.initiative != null) return;
        let src = null;
        const linkMode = encMeta?.linkMode || "live";
        if (linkMode !== "detached") {
            src = (p?.foeId && liveFoesMap[p.foeId]) || p?.foeSnapshot || null;
        } else {
            src = p?.foeSnapshot || null;
        }
        const faces = parseFacesFromDado(src?.dadoAnima || src?.stats?.dadoAnima);
        const modifier = getFoeDexTot(src);
        if (!faces) {
            alert("Impossibile determinare il Dado Anima del foe.");
            return;
        }
        const label = p?.characterId || p?.email || pKey;
        setFoeRoller({ visible: true, faces, modifier, pKey, label });
    };

    const saveFoeInitiative = async (total, faces, modifier, details) => {
        const pKey = foeRoller.pKey;
        if (!pKey) return;
        try {
            const pRef = doc(db, "encounters", encounter.id, "participants", pKey);
            // Atomic: set only if not set yet
            await runTransaction(db, async (tx) => {
                const snap = await tx.get(pRef);
                const data = snap.exists() ? snap.data() : {};
                const already = data?.initiative != null && (typeof data.initiative === "number" || data.initiative?.value != null);
                if (already) throw new Error("already-rolled");
                tx.set(
                    pRef,
                    {
                        initiative: { value: total, faces, modifier, rolledAt: serverTimestamp() },
                        updatedAt: serverTimestamp(),
                    },
                    { merge: true }
                );
            });

            // Log entry
            try {
                const expr = `d${faces}${modifier ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : ""}`;
                await addDoc(collection(db, "encounters", encounter.id, "logs"), {
                    type: "roll",
                    kind: "initiative",
                    by: foeRoller.label,
                    uid: null,
                    description: `Iniziativa foe (Destrezza ${modifier >= 0 ? "+" : ""}${modifier})`,
                    expression: expr,
                    total,
                    rolls: details?.rolls || [],
                    modifier,
                    faces,
                    createdAt: serverTimestamp(),
                });
            } catch {}
        } catch (e) {
            if (e && e.message === "already-rolled") {
                alert("Iniziativa già tirata per questo foe.");
                setFoeRoller({ visible: false, faces: 0, modifier: 0, pKey: null, label: "" });
                return;
            }
            console.error("Failed to save foe initiative", e);
            alert("Impossibile salvare l'iniziativa del foe.");
        }
    };

    const getDexTot = () => {
        const base = userData?.Parametri?.Base || {};
        const key = Object.keys(base).find((k) => k.toLowerCase() === "destrezza");
        return Number(base?.[key]?.Tot) || 0;
    };

    // Use the exact same criteria as Home page: pick dice by current level index and parse faces from string like "d6", "d8", ...
    const computeFaces = () => {
        const level = userData?.stats?.level;
        if (!level) return 0;
        const diceTypeStr = dadiAnimaByLevel[level];
        if (!diceTypeStr) return 0;
        const faces = parseInt(String(diceTypeStr).replace(/^d/i, ""), 10);
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

    // ---------------- TURN ORDER STATE ----------------
    const allHaveInitiative = useMemo(() => rows.length > 0 && rows.every((r) => r.initiative != null), [rows]);
    const turnState = encMeta?.turn || null; // { order: [participantDocKey], index, round }
    const currentOrder = useMemo(() => {
        if (!turnState?.order) return [];
        return turnState.order.filter((k) => participantsMap[k]);
    }, [turnState, participantsMap]);
    const currentIndex = turnState?.index ?? 0;
    const currentRound = turnState?.round ?? 0;
    const activeKey = currentOrder[currentIndex];

    const startTurnOrder = async () => {
        if (!isDM) return;
        if (!allHaveInitiative) return alert("Iniziative mancanti.");
        if (turnState) return alert("Turn order già iniziato.");
        try {
            const encRef = doc(db, "encounters", encounter.id);
            const order = rows.map((r) => r.key); // already sorted desc
            await runTransaction(db, async (tx) => {
                const snap = await tx.get(encRef);
                const data = snap.data() || {};
                if (data.turn) throw new Error("already-started");
                tx.set(encRef, { turn: { order, index: 0, round: 1, startedAt: serverTimestamp(), updatedAt: serverTimestamp() } }, { merge: true });
            });
            const orderStr = rows.map((r) => r.label).join(" > ");
            await addDoc(collection(db, "encounters", encounter.id, "logs"), {
                type: "turn",
                by: "DM",
                message: `Turn order started: ${orderStr}`,
                createdAt: serverTimestamp(),
            });
            const first = rows[0];
            if (first) {
                await addDoc(collection(db, "encounters", encounter.id, "logs"), {
                    type: "turn",
                    by: "DM",
                    message: `Turn begins: ${first.label} (Turno 1)` ,
                    createdAt: serverTimestamp(),
                });
            }
        } catch (e) {
            if (e?.message === "already-started") return;
            console.error("startTurnOrder failed", e);
            alert("Impossibile avviare il turn order.");
        }
    };

    // advanceTurn moved to dedicated utility in buttons/advanceTurn.js
    const advanceTurn = () => advanceTurnUtil({ isDM, turnState, encounter, db, participantsMap, rows });

    const rebuildOrder = async () => {
        if (!isDM || !turnState) return;
        try {
            const encRef = doc(db, "encounters", encounter.id);
            const order = rows.map((r) => r.key);
            await runTransaction(db, async (tx) => {
                const snap = await tx.get(encRef);
                if (!snap.exists()) throw new Error("missing");
                const data = snap.data() || {};
                if (!data.turn) throw new Error("no-turn");
                const existing = data.turn;
                tx.set(encRef, { turn: { ...existing, order, index: 0, updatedAt: serverTimestamp() } }, { merge: true });
            });
            await addDoc(collection(db, "encounters", encounter.id, "logs"), {
                type: "turn",
                by: "DM",
                message: `Turn order rebuilt: ${rows.map((r) => r.label).join(" > ")}` ,
                createdAt: serverTimestamp(),
            });
        } catch (e) {
            console.error("rebuildOrder failed", e);
            alert("Impossibile ricostruire il turn order.");
        }
    };

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
                                    `Sei sicuro di voler eliminare l'incontro${encounter.name ? ` "${encounter.name}"` : ""}?\nQuesta azione eliminerà definitivamente il documento, i partecipanti e i log.`
                                );
                                if (!ok) return;
                                try {
                                    const encRef = doc(db, "encounters", encounter.id);
                                    const participantsRef = collection(db, "encounters", encounter.id, "participants");
                                    const logsRef = collection(db, "encounters", encounter.id, "logs");

                                    // Collect all docs to delete (participants + logs), then delete in chunks to stay under batch limit
                                    const toDelete = [];
                                    const partSnap = await getDocs(participantsRef);
                                    partSnap.forEach((d) => toDelete.push(d.ref));
                                    const logsSnap = await getDocs(logsRef);
                                    logsSnap.forEach((d) => toDelete.push(d.ref));

                                    const CHUNK = 450; // safety margin under 500 operations per batch
                                    for (let i = 0; i < toDelete.length; i += CHUNK) {
                                        const batch = writeBatch(db);
                                        const slice = toDelete.slice(i, i + CHUNK);
                                        slice.forEach((ref) => batch.delete(ref));
                                        await batch.commit();
                                    }

                                    // Finally delete the encounter document itself
                                    const finalBatch = writeBatch(db);
                                    finalBatch.delete(encRef);
                                    await finalBatch.commit();
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
                        {rows.map((r) => {
                            const p = participantsMap[r.key] || {};
                            const isFoe = p?.type === "foe";
                            const isActive = !!turnState && r.key === activeKey;
                            return (
                                <tr
                                    key={r.key}
                                    aria-current={isActive ? "true" : undefined}
                                    className={`transition-colors ${
                                        isActive
                                            ? (isFoe ? "bg-rose-500/15" : "bg-emerald-500/15")
                                            : `odd:bg-transparent even:bg-white/[0.02] ${isFoe ? "bg-rose-900/10" : ""}`
                                    }`}
                                >
                                    <td className="px-3 py-2">
                                        <span className={`${isFoe ? "text-rose-200" : "text-white"} ${isActive ? "font-semibold" : ""}`}>
                                            {isActive && (
                                                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse mr-2 align-middle" title="Turno attivo" />
                                            )}
                                            {r.label}
                                        </span>
                                        {isFoe && (
                                            <span className="ml-2 inline-flex items-center rounded-full px-2 py-[2px] text-[10px] border bg-rose-500/10 border-rose-400/30 text-rose-200 align-middle" title="Foe">
                                                <GiAnimalSkull className="w-4 h-4" />
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        {r.initiative !== null ? (
                                            <span className={
                                                isFoe
                                                    ? "inline-flex min-w-[2.25rem] justify-center rounded-md bg-rose-500/10 px-2 py-0.5 text-rose-300 ring-1 ring-inset ring-rose-400/30 tabular-nums"
                                                    : "inline-flex min-w-[2.25rem] justify-center rounded-md bg-indigo-500/10 px-2 py-0.5 text-indigo-300 ring-1 ring-inset ring-indigo-400/30 tabular-nums"
                                            }>
                                                {r.initiative}
                                            </span>
                                        ) : (
                                            <div className="flex items-center justify-center gap-2">
                                                <span className="text-slate-500">—</span>
                                                {isDM && isFoe && (
                                                    <button
                                                        onClick={() => startFoeRoll(r.key)}
                                                        className="px-2 py-0.5 rounded-md text-[11px] bg-rose-900/30 text-rose-200 border border-rose-700/50 hover:bg-rose-900/50"
                                                        title="Tira iniziativa (foe)"
                                                    >
                                                        Roll
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </td>
                                {isDM && (
                                    <td className="px-3 py-2 text-center text-xs text-slate-400">
                                        {(() => {
                                            const linkMode = encMeta?.linkMode || "live";
                                            if (linkMode !== "detached") {
                                                // For foes, read from live foes snapshot; for users, from live users
                                                const p = participantsMap[r.key] || {};
                                                if (p?.type === "foe" && p?.foeId) {
                                                    const foe = liveFoesMap[p.foeId] || {};
                                                    const hpC = foe?.stats?.hpCurrent ?? foe?.stats?.hpTotal;
                                                    const manaC = foe?.stats?.manaCurrent ?? foe?.stats?.manaTotal;
                                                    const hpStr = hpC == null ? "?" : hpC;
                                                    const manaStr = manaC == null ? "?" : manaC;
                                                    return `HP ${hpStr} / Mana ${manaStr}`;
                                                }
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
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* TURN ORDER */}
            <div className="mt-6 border-t border-slate-700/50 pt-4">
                <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                        Turn Order {turnState && <span className="text-[11px] font-normal text-slate-400">Turno {currentRound || 1}</span>}
                    </div>
                    {isDM && (
                        <div className="flex gap-2 flex-wrap justify-end">
                            {!turnState && (
                                <Button size="sm" onClick={startTurnOrder} disabled={!allHaveInitiative} title={!allHaveInitiative ? "Serve iniziativa per tutti" : undefined}>
                                    Avvia Turni
                                </Button>
                            )}
                            {turnState && (
                                <>
                                    <Button size="sm" kind="primary" onClick={advanceTurn}>Avanza</Button>
                                    <Button size="sm" kind="secondary" onClick={rebuildOrder} title="Ricostruisci dall'iniziativa (index reset)">Rebuild</Button>
                                </>
                            )}
                        </div>
                    )}
                </div>
                {!turnState && !allHaveInitiative && (
                    <div className="text-xs text-slate-400">Tira l'iniziativa per tutti i partecipanti per avviare il turn order.</div>
                )}
                {!turnState && allHaveInitiative && (
                    <div className="text-xs text-slate-400">Tutte le iniziative pronte. Il DM può avviare i turni.</div>
                )}
                {turnState && (
                    <div className="flex flex-wrap gap-2">
                        {currentOrder.map((k) => {
                            const r = rows.find((row) => row.key === k);
                            if (!r) return null;
                            const active = k === activeKey;
                            return (
                                <div
                                    key={k}
                                    className={`px-3 py-1 rounded-full text-xs flex items-center gap-1 border tabular-nums ${active ? "bg-emerald-600/20 border-emerald-500/50 text-emerald-200 shadow-inner" : "bg-slate-800/40 border-slate-600/50 text-slate-300"}`}
                                    title={`Iniziativa ${r.initiative}`}
                                >
                                    <span className="font-mono">{r.initiative}</span>
                                    <span className="text-slate-400">•</span>
                                    <span className="truncate max-w-[8rem]">{r.label}</span>
                                    {active && <span className="ml-1 text-[10px] uppercase tracking-wide">ATTIVO</span>}
                                </div>
                            );
                        })}
                    </div>
                )}
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

            {foeRoller.visible && (
                <DiceRoller
                    faces={foeRoller.faces}
                    count={1}
                    modifier={foeRoller.modifier}
                    description={`Iniziativa foe (d${foeRoller.faces} + ${foeRoller.modifier})`}
                    onComplete={(total, info) => {
                        saveFoeInitiative(total, foeRoller.faces, foeRoller.modifier, info);
                        setFoeRoller({ visible: false, faces: 0, modifier: 0, pKey: null, label: "" });
                    }}
                />
            )}
        </div>
    );
};

export default EncounterDetails;
