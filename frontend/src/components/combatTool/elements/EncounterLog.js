import React, { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../firebaseConfig";
import { collection, onSnapshot, query, orderBy, limit } from "firebase/firestore";
import { Section } from "./ui";

const tsToDate = (ts) => {
    try {
        if (!ts) return null;
        if (typeof ts.toDate === "function") return ts.toDate();
        if (ts.seconds) return new Date(ts.seconds * 1000);
        return new Date(ts);
    } catch {
        return null;
    }
};

const formatTime = (date) => {
    if (!date) return "";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const LogRow = ({ entry }) => {
    const d = tsToDate(entry.createdAt);
    const time = formatTime(d);
    const isRoll = entry.type === "roll";
    return (
        <div className="rounded-xl border border-slate-700/50 bg-slate-900/50 px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
                <div className="truncate">{entry.by || "Unknown"}</div>
                <div className="shrink-0 tabular-nums">{time}</div>
            </div>
            <div className="mt-1 text-slate-200 text-sm">
                {isRoll ? (
                    <>
                        <span className="text-indigo-300">rolled</span>{" "}
                        <span className="font-mono">{entry.expression || "roll"}</span>{" "}
                        = <span className="font-semibold text-indigo-200">{entry.total}</span>
                        {Array.isArray(entry.rolls) && entry.rolls.length > 1 && (
                            <span className="text-slate-400 text-xs"> ({entry.rolls.join(" + ")}{entry.modifier ? (entry.modifier > 0 ? ` + ${entry.modifier}` : ` ${entry.modifier}`) : ""})</span>
                        )}
                        {entry.description && (
                            <div className="text-[11px] text-slate-400 mt-0.5">{entry.description}</div>
                        )}
                    </>
                ) : (
                    <div className="text-slate-300 text-sm">{entry.message}</div>
                )}
            </div>
        </div>
    );
};

const EncounterLog = ({ encounterId }) => {
    const [entries, setEntries] = useState([]);
    const containerRef = useRef(null);

    useEffect(() => {
        if (!encounterId) return;
        const logsRef = collection(db, "encounters", encounterId, "logs");
        const q = query(logsRef, orderBy("createdAt", "desc"), limit(200));
        const unsub = onSnapshot(q, (snap) => {
            const list = [];
            snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
            setEntries(list);
        });
        return () => unsub();
    }, [encounterId]);

    const content = useMemo(() => entries, [entries]);

    useEffect(() => {
        // Optional: keep scroll at top since newest is first
        if (containerRef.current) containerRef.current.scrollTop = 0;
    }, [content.length]);

    return (
        <Section title="Encounter Log">
            <div ref={containerRef} className="max-h-[60vh] md:max-h-[calc(100vh-12rem)] overflow-y-auto pr-1 grid gap-2">
                {content.length === 0 ? (
                    <div className="text-slate-400 text-sm">No logs yet. Rolls will appear here.</div>
                ) : (
                    content.map((e) => <LogRow key={e.id} entry={e} />)
                )}
            </div>
        </Section>
    );
};

export default EncounterLog;
