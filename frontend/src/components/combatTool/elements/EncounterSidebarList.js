import React, { useEffect, useMemo, useState } from "react";
import { db } from "../../firebaseConfig";
import { useAuth } from "../../../AuthContext";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { Section } from "./ui";

const EncounterSidebarList = ({ isDM, onSelect, selectedId }) => {
    const { user, userData } = useAuth();
    const [encountersAll, setEncountersAll] = useState([]); // DM only
    const [encByUid, setEncByUid] = useState([]); // non-DM by user uid
    const [encByCid, setEncByCid] = useState([]); // non-DM by characterId
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) return;
        const baseColl = collection(db, "encounters");
        if (isDM) {
            const unsubAll = onSnapshot(baseColl, (snap) => {
                const rows = [];
                snap.forEach((d) => {
                    const data = d.data();
                    if (!data || data.status === "deleted") return;
                    rows.push({ id: d.id, ...data });
                });
                rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
                setEncountersAll(rows);
                setLoading(false);
            }, (err) => {
                if (typeof process !== "undefined" && process.env && process.env.NODE_ENV !== "production") {
                    // eslint-disable-next-line no-console
                    console.warn("encounters onSnapshot error (all)", err?.message || err);
                }
                setEncountersAll([]);
                setLoading(false);
            });
            return () => unsubAll();
        }

        // Non-DM: listen independently by UID and by characterId
        const unsubs = [];

        unsubs.push(
            onSnapshot(query(baseColl, where("participantIds", "array-contains", user.uid)), (snap) => {
                const rows = [];
                snap.forEach((d) => {
                    const data = d.data();
                    if (!data || data.status === "deleted") return;
                    rows.push({ id: d.id, ...data });
                });
                setEncByUid(rows);
                setLoading(false);
            }, (err) => {
                if (typeof process !== "undefined" && process.env && process.env.NODE_ENV !== "production") {
                    // eslint-disable-next-line no-console
                    console.warn("encounters onSnapshot error (by uid)", err?.message || err);
                }
                setEncByUid([]);
                setLoading(false);
            })
        );

        const cid = userData?.characterId;
        if (cid) {
            unsubs.push(
                onSnapshot(query(baseColl, where("participantCharacterIds", "array-contains", cid)), (snap) => {
                    const rows = [];
                    snap.forEach((d) => {
                        const data = d.data();
                        if (!data || data.status === "deleted") return;
                        rows.push({ id: d.id, ...data });
                    });
                    setEncByCid(rows);
                    setLoading(false);
                }, (err) => {
                    if (typeof process !== "undefined" && process.env && process.env.NODE_ENV !== "production") {
                        // eslint-disable-next-line no-console
                        console.warn("encounters onSnapshot error (by cid)", err?.message || err);
                    }
                    setEncByCid([]);
                    setLoading(false);
                })
            );
        } else {
            setEncByCid([]);
        }

        return () => unsubs.forEach((u) => u());
    }, [isDM, user?.uid, userData?.characterId]);

    const encounters = useMemo(() => {
        const rows = isDM ? encountersAll : [...encByUid, ...encByCid];
        const unique = new Map();
        for (const r of rows) unique.set(r.id, r);
        const merged = Array.from(unique.values());
        merged.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        return merged;
    }, [isDM, encountersAll, encByUid, encByCid]);

    useEffect(() => {
        if (!onSelect) return;
        if (loading) return;
        if (selectedId) return;
        if (encounters.length > 0) onSelect(encounters[0]);
    }, [onSelect, loading, selectedId, encounters]);

    // If the selected encounter was removed, switch to the first one or clear selection
    useEffect(() => {
        if (!onSelect) return;
        if (loading) return;
        if (!selectedId) return; // already empty, handled by previous effect
        const stillExists = encounters.some((e) => e.id === selectedId);
        if (!stillExists) {
            onSelect(encounters[0] || null);
        }
    }, [encounters, loading, onSelect, selectedId]);

    if (loading) return <div className="text-slate-300">Loading encounters…</div>;

    return (
        <Section title="Encounters">
            {encounters.length === 0 ? (
                <div className="text-slate-400">No encounters yet.</div>
            ) : (
                <div className="grid gap-2">
                    {encounters.map((e) => {
                        const isSelected = selectedId === e.id;
                        return (
                            <button
                                key={e.id}
                                onClick={() => onSelect && onSelect(e)}
                                className={`text-left border rounded-2xl p-3 transition bg-slate-900/60 border-slate-700/50 hover:border-indigo-600/60 hover:bg-slate-900/80 ${
                                    isSelected ? "ring-2 ring-indigo-500/60" : ""
                                }`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div>
                                        <div className="font-semibold text-slate-100 truncate">{e.name || "Untitled"}</div>
                                    </div>
                                    <div className="text-xs text-slate-400">{(e.participants || []).length} players</div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </Section>
    );
};

export default EncounterSidebarList;
