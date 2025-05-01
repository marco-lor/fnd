// file: ./frontend/src/components/common/SpellOverlay.js
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom";

/**
 * Generic, storage-agnostic spell form.
 *
 * Props
 * ─────────────────────────────────────────────────────────────────────────────
 * ▸ mode          “add” | “edit”  – defaults to “add”; shows confirmation only in “edit”.
 * ▸ schema        Object          – Spell schema (all dropdown lists).
 * ▸ userName      String          – Displayed under the title.
 * ▸ initialData   Object|null     – Prefills the form in “edit” mode.
 * ▸ onClose       Function(result | null)
 *      • null   → user clicked **Cancel**
 *      • { spellData, imageFile, videoFile } → user clicked **Save**
 */
export function SpellOverlay({
  mode = "add",
  schema,
  userName = "Unknown User",
  initialData = null,
  onClose,
}) {
  /* ---------------- state ---------------- */
  const [spellFormData, setSpellFormData] = useState({});
  const [imageFile, setImageFile]         = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [videoFile, setVideoFile]         = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

  /* ---------------- helpers ---------------- */
  /* build an empty object that matches the schema */
  const buildEmptySpell = (s) => ({
    Nome:            "",
    Costo:           0,
    Turni:           0,
    Gittata:         s.Gittata || 0,
    "Effetti Positivi": "",
    "Effetti Negativi": "",
    Esperienza:        Array.isArray(s.Esperienza)     ? s.Esperienza[0]     : "",
    "Mod Params": {
      Base: {
        Costituzione: 0, Destrezza: 0, Fortuna: 0,
        Forza: 0, Intelligenza: 0, Saggezza: 0,
      },
      Combattimento: {
        Attacco: 0, Critico: 0, Difesa: 0,
        Disciplina: 0, RiduzioneDanni: 0, Salute: 0,
      },
    },
    TPC:          Object.fromEntries(["Param1","Param2","ParamTarget"].map(k=>[k, s.TPC?.[k]?.[0] || ""])),
    "TPC Fisico": Object.fromEntries(["Param1","Param2","ParamTarget"].map(k=>[k, s["TPC Fisico"]?.[k]?.[0] || ""])),
    "TPC Mentale":Object.fromEntries(["Param1","Param2","ParamTarget"].map(k=>[k, s["TPC Mentale"]?.[k]?.[0] || ""])),
    "Tipo Base":    Array.isArray(s["Tipo Base"]) ? s["Tipo Base"][0] : "",
  });

  /* initialise on mount / when schema changes */
  useEffect(() => {
    if (!schema) return;                           // parent guarantees schema
    setSpellFormData(initialData ? { ...initialData } : buildEmptySpell(schema));
  }, [schema, initialData]);

  /* generic nested-field setter */
  const handleNestedChange = (cat, sub, key, val) =>
    setSpellFormData((prev) => ({
      ...prev,
      [cat]: { ...(prev[cat] || {}), [sub]: { ...(prev[cat]?.[sub] || {}), [key]: val } },
    }));

  /* ---------- media previews ---------- */
  const preview = (e, isImg) => {
    const file = e.target.files?.[0];
    if (!file) return;
    (isImg ? setImageFile : setVideoFile)(file);
    (isImg ? setImagePreviewUrl : setVideoPreviewUrl)(URL.createObjectURL(file));
  };

  /* ---------- save / cancel handlers ---------- */
  const cleanSpell = () => {
    const num = (v) => (isNaN(parseInt(v)) ? 0 : parseInt(v));
    const s   = spellFormData;            // shortcut
    return {
      Nome:   s.Nome.trim(),
      Costo:  num(s.Costo),
      Turni:  num(s.Turni),
      Gittata:num(s.Gittata),
      "Effetti Positivi": s["Effetti Positivi"] || "",
      "Effetti Negativi": s["Effetti Negativi"] || "",
      Esperienza: s.Esperienza || "",
      "Mod Params": {
        Base: Object.fromEntries(
          Object.entries(s["Mod Params"]?.Base || {}).map(([k,v]) => [k, num(v)])
        ),
        Combattimento: Object.fromEntries(
          Object.entries(s["Mod Params"]?.Combattimento || {}).map(([k,v]) => [k, num(v)])
        ),
      },
      TPC:          { ...(s.TPC || {}) },
      "TPC Fisico": { ...(s["TPC Fisico"] || {}) },
      "TPC Mentale":{ ...(s["TPC Mentale"] || {}) },
      "Tipo Base":  s["Tipo Base"] || "",
    };
  };

  const initiateSave = (e) => {
    e.preventDefault();
    if (!spellFormData.Nome.trim()) {
      alert("Nome is required");
      return;
    }
    mode === "edit" ? setShowConfirmation(true) : dispatchSave();
  };

  const dispatchSave = () =>
    onClose({
      spellData: cleanSpell(),
      imageFile,
      videoFile,
    });

  /* ---------- tiny helpers ---------- */
  const selectOrText = (opts, val, change) =>
    Array.isArray(opts) && opts.length
      ? (
        <select value={val || ""} onChange={change}
                className="w-full p-2 rounded bg-gray-700 text-white">
          {opts.map((o) => <option key={o}>{o}</option>)}
        </select>)
      : (
        <input  type="text" value={val || ""} onChange={change}
                className="w-full p-2 rounded bg-gray-700 text-white" />);

  /* ---------- rendered form ---------- */
  const formEl = (
    <form onSubmit={initiateSave}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {/* Nome / Costo / Turni / Gittata */}
        {[
          ["Nome",         "text",    s=>s.Nome,         v=>setSpellFormData({...spellFormData, Nome:v})],
          ["Costo",        "number",  s=>s.Costo,        v=>setSpellFormData({...spellFormData, Costo:v})],
          ["Turni",        "number",  s=>s.Turni,        v=>setSpellFormData({...spellFormData, Turni:v})],
          ["Gittata",      "number",  s=>s.Gittata,      v=>setSpellFormData({...spellFormData, Gittata:v})],
        ].map(([lbl,type,get,set])=>(
          <div key={lbl}>
            <label className="block text-white mb-1">{lbl}</label>
            <input  type={type} value={get(spellFormData) || ""}
                    onChange={(e)=>set(e.target.value)}
                    className="w-full p-2 rounded bg-gray-700 text-white" />
          </div>
        ))}
      </div>

      {/* Effetti ± */}
      {["Effetti Positivi","Effetti Negativi"].map((k)=>(
        <div key={k} className="mb-4">
          <label className="block text-white mb-1">{k}</label>
          <textarea value={spellFormData[k] || ""}
                    onChange={(e)=>setSpellFormData({...spellFormData,[k]:e.target.value})}
                    className="w-full p-2 rounded bg-gray-700 text-white h-20" />
        </div>
      ))}

      {/* Esperienza / Tipo Base */}
      {[
        ["Esperienza", schema?.Esperienza],
        ["Tipo Base",  schema?.["Tipo Base"]],
      ].map(([lbl,opts])=>(
        <div key={lbl} className="mb-4">
          <label className="block text-white mb-1">{lbl}</label>
          {selectOrText(opts, spellFormData[lbl],
            (e)=>setSpellFormData({...spellFormData,[lbl]:e.target.value}))}
        </div>
      ))}

      {/* Mod Params */}
      <div className="mb-4">
        <h3 className="text-white text-lg mb-2">Mod Params</h3>
        {["Base","Combattimento"].map((grp)=>(
          <div key={grp} className="bg-gray-700 p-3 rounded mb-3">
            <h4 className="text-white font-medium mb-2">{grp}</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {(grp==="Base"
                ? ["Costituzione","Destrezza","Fortuna","Forza","Intelligenza","Saggezza"]
                : ["Attacco","Critico","Difesa","Disciplina","RiduzioneDanni","Salute"]
              ).map((p)=>(
                <div key={p}>
                  <label className="block text-white text-sm mb-1">{p}</label>
                  <input type="number"
                         value={spellFormData["Mod Params"]?.[grp]?.[p] || 0}
                         onChange={(e)=>handleNestedChange("Mod Params", grp, p, parseInt(e.target.value)||0)}
                         className="w-full p-2 rounded bg-gray-600 text-white" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* TPC groups */}
      {["TPC","TPC Fisico","TPC Mentale"].map((tpc)=>(
        <div key={tpc} className="mb-4">
          <h3 className="text-white text-lg mb-2">{tpc}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {["Param1","Param2","ParamTarget"].map((p)=>(
              <div key={`${tpc}-${p}`}>
                <label className="block text-white text-sm mb-1">{p}</label>
                {selectOrText(schema?.[tpc]?.[p],
                  spellFormData[tpc]?.[p] || "",
                  (e)=>setSpellFormData((prev)=>{
                    const next={...prev,[tpc]:{...(prev[tpc]||{}),[p]:e.target.value}};
                    return next;
                  }))}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* media */}
      <div className="mb-4">
        <div>
          <label className="block text-white mb-1">Immagine</label>
          <input type="file" accept="image/*" onChange={(e)=>preview(e,true)}
                 className="w-full text-white" />
          {imagePreviewUrl && <img src={imagePreviewUrl}
                                   alt="Preview"
                                   className="mt-2 w-24 h-auto rounded" />}
        </div>
        <div className="mt-4">
          <label className="block text-white mb-1">Video</label>
          <input type="file" accept="video/*" onChange={(e)=>preview(e,false)}
                 className="w-full text-white" />
          {videoPreviewUrl && <video src={videoPreviewUrl} controls
                                     className="mt-2 w-full max-h-48 rounded" />}
          <p className="text-gray-400 text-sm mt-1">
            Consigliato: video breve (max 30 s) di dimensioni ridotte
          </p>
        </div>
      </div>

      {/* action buttons */}
      <div className="flex justify-end gap-2 mt-4">
        <button type="button"
                onClick={()=>onClose(null)}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-md shadow-md transition">
          Cancel
        </button>
        <button type="submit"
                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white rounded-md shadow-md transition">
          Save Spell
        </button>
      </div>
    </form>
  );

  /* ---------- optional confirmation (edit-mode) ---------- */
  const body = mode==="edit" && showConfirmation ? (
    <div className="text-white">
      <p className="mb-4">Sei sicuro di voler sovrascrivere questo spell?</p>
      <div className="flex justify-end gap-2">
        <button onClick={()=>setShowConfirmation(false)}
                className="px-4 py-2 bg-gray-500 rounded hover:bg-gray-600 transition">
          Annulla
        </button>
        <button onClick={dispatchSave}
                className="px-4 py-2 bg-green-500 rounded hover:bg-green-600 transition">
          Conferma
        </button>
      </div>
    </div>
  ) : formEl;

  /* ---------- mount in portal ---------- */
  return ReactDOM.createPortal(
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[9999]">
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-4/5 max-w-3xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl text-white mb-1">
          {mode==="add" ? "Add Spell" : "Modifica Spell"}
        </h2>
        <p className="text-gray-300 mb-4">Per il giocatore: {userName}</p>
        {schema ? body : <div className="text-white">Loading schema…</div>}
      </div>
    </div>,
    document.body
  );
}
