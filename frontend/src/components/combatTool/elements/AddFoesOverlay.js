import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { db } from "../../firebaseConfig";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  arrayUnion,
} from "firebase/firestore";
import { Button } from "./ui";

// DM-only control to add foes (from foes hub) to an encounter
// Props: { encounterId: string, isDM: boolean }
const AddFoesOverlay = ({ encounterId, isDM }) => {
  const [open, setOpen] = useState(false);
  const [foes, setFoes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return; // fetch only when needed
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, "foes"),
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        list.sort((a, b) => (b.updated_at?.seconds || b.created_at?.seconds || 0) - (a.updated_at?.seconds || a.created_at?.seconds || 0));
        setFoes(list);
        setLoading(false);
      },
      (e) => {
        console.warn("foes snapshot error", e);
        setErr("Impossibile caricare i foes.");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return foes;
    return foes.filter((f) => {
      const name = (f?.name || "").toLowerCase();
      const cat = (f?.category || "").toLowerCase();
      const rank = (f?.rank || "").toLowerCase();
      return name.includes(q) || cat.includes(q) || rank.includes(q);
    });
  }, [foes, query]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearState = () => {
    setSelected(new Set());
    setQuery("");
    setErr("");
  };

  const addToEncounter = async () => {
    if (!isDM || !encounterId || selected.size === 0) return;
    try {
      setBusy(true);
      setErr("");
      const encRef = doc(db, "encounters", encounterId);
      const batch = writeBatch(db);

      const participantsToAppend = [];
      const idsToAppend = [];

      for (const foeId of selected) {
        const foe = foes.find((f) => f.id === foeId);
        if (!foe) continue;
        const pRef = doc(collection(encRef, "participants")); // auto id
        const name = foe.name || `Foe ${foeId}`;
        const uidPseudo = `foe:${foeId}`; // used only for uniqueness; not a real user
        const hpCurrent = Number(foe?.stats?.hpCurrent ?? foe?.stats?.hpTotal ?? 0) || 0;
        const manaCurrent = Number(foe?.stats?.manaCurrent ?? foe?.stats?.manaTotal ?? 0) || 0;
        batch.set(pRef, {
          type: "foe",
          foeId,
          uid: uidPseudo,
          characterId: name, // displayed in EncounterDetails label
          email: null,
          initiative: null,
          hp: { current: hpCurrent, temp: 0 },
          mana: { current: manaCurrent },
          notes: "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        participantsToAppend.push({ uid: uidPseudo, characterId: name, email: null, foeId });
        idsToAppend.push(uidPseudo);
      }

      if (participantsToAppend.length > 0) {
        batch.update(encRef, {
          participants: arrayUnion(...participantsToAppend),
          participantIds: arrayUnion(...idsToAppend),
        });
      }

      await batch.commit();
      setOpen(false);
      clearState();
    } catch (e) {
      console.error("add foes failed", e);
      setErr("Impossibile aggiungere i foes all'incontro.");
    } finally {
      setBusy(false);
    }
  };

  if (!isDM || !encounterId) return null;

  return (
    <>
      <Button kind="secondary" onClick={() => setOpen(true)} title="Aggiungi creature all'incontro" size="sm">
        + Add foes
      </Button>

      {open && createPortal(
        <div className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/95 shadow-2xl flex flex-col">
            <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-700/50">
              <div>
                <div className="text-white font-semibold">Add foes to encounter</div>
                <div className="text-[12px] text-slate-400">Seleziona uno o più foes dalla lista</div>
              </div>
              <div className="flex items-center gap-2">
                <Button kind="secondary" size="sm" onClick={() => { setOpen(false); clearState(); }} title="Chiudi">Close</Button>
                <Button onClick={addToEncounter} disabled={busy || selected.size === 0} title={selected.size === 0 ? "Seleziona almeno un foe" : undefined} size="sm">
                  {busy ? "Adding…" : `Add ${selected.size || ""}`}
                </Button>
              </div>
            </div>

            {err && <div className="px-4 pt-3 text-sm text-red-300">{err}</div>}

            <div className="p-4 border-b border-slate-700/50">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name / category / rank"
                className="w-full rounded-lg bg-slate-900/60 px-3 py-2 text-white border border-slate-700/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="text-slate-300">Caricamento…</div>
              ) : filtered.length === 0 ? (
                <div className="text-slate-400">Nessun foe trovato.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filtered.map((f) => {
                    const checked = selected.has(f.id);
                    const hpTxt = `${Number(f?.stats?.hpCurrent ?? f?.stats?.hpTotal ?? 0)}/${Number(f?.stats?.hpTotal ?? 0)}`;
                    const manaTxt = `${Number(f?.stats?.manaCurrent ?? f?.stats?.manaTotal ?? 0)}/${Number(f?.stats?.manaTotal ?? 0)}`;
                    return (
                      <label key={f.id} className={`cursor-pointer rounded-xl border p-3 transition ${checked ? "bg-indigo-950/40 border-indigo-700/60" : "bg-slate-900/40 border-slate-700/60 hover:border-slate-500/60"}`}>
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={checked}
                            onChange={() => toggle(f.id)}
                          />
                          <div className="min-w-0">
                            <div className="text-white font-semibold truncate">{f?.name || f.id}</div>
                            <div className="text-[12px] text-slate-400 truncate">Lv {Number(f?.stats?.level || 1)} • {f?.category || "—"} • {f?.rank || "—"}</div>
                            <div className="text-[12px] text-slate-400 mt-1">HP {hpTxt} • Mana {manaTxt}</div>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-700/50 flex items-center justify-end gap-2">
              <Button kind="secondary" size="sm" onClick={() => { setOpen(false); clearState(); }}>Cancel</Button>
              <Button onClick={addToEncounter} disabled={busy || selected.size === 0} size="sm">{busy ? "Adding…" : "Add selected"}</Button>
            </div>
          </div>
        </div>, document.body)}
    </>
  );
};

export default AddFoesOverlay;
