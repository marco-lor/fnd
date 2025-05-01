// file: ./frontend/src/components/common/SpellOverlay.js
import React, { useEffect, useState, useCallback } from "react"; // Added useCallback
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
 * ▸ saveButtonText String|null     – Text for the primary action button (defaults to "Save Spell").
 * ▸ onClose       Function(result | null)
 * • null   → user clicked **Cancel**
 * • { spellData, imageFile, videoFile } → user clicked primary action button
 */
export function SpellOverlay({
  mode = "add",
  schema,
  userName = "Unknown User",
  initialData = null,
  saveButtonText = "Save Spell", // Added prop with default
  onClose,
}) {
  /* ---------------- state ---------------- */
  const [spellFormData, setSpellFormData] = useState({});
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

  /* ---------------- helpers ---------------- */
  // Use useCallback to memoize buildEmptySpell if schema structure is stable
   const buildEmptySpell = useCallback((s) => ({
     Nome:            "",
     Costo:           0,
     Turni:           0,
     Gittata:         s?.Gittata && !isNaN(parseInt(s.Gittata)) ? parseInt(s.Gittata) : 0, // Ensure number
     "Effetti Positivi": "",
     "Effetti Negativi": "",
     Esperienza:        Array.isArray(s?.Esperienza)     ? s.Esperienza[0]     : "",
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
     TPC:          Object.fromEntries(["Param1","Param2","ParamTarget"].map(k=>[k, s?.TPC?.[k]?.[0] || ""])),
     "TPC Fisico": Object.fromEntries(["Param1","Param2","ParamTarget"].map(k=>[k, s?.["TPC Fisico"]?.[k]?.[0] || ""])),
     "TPC Mentale":Object.fromEntries(["Param1","Param2","ParamTarget"].map(k=>[k, s?.["TPC Mentale"]?.[k]?.[0] || ""])),
     "Tipo Base":    Array.isArray(s?.["Tipo Base"]) ? s["Tipo Base"][0] : "",
   }), []); // Empty dependency array assuming schema structure doesn't change based on props/state here

  /* initialise on mount / when schema/initialData changes */
  useEffect(() => {
    if (!schema) return;
    // Deep copy initialData if provided to avoid modifying the original object
    const startingData = initialData ? JSON.parse(JSON.stringify(initialData)) : buildEmptySpell(schema);
    setSpellFormData(startingData);

    // Clear previews if initial data changes (or on initial load without data)
     setImageFile(null);
     setImagePreviewUrl(initialData?.image_url || null); // Show existing image URL if in edit mode
     setVideoFile(null);
     setVideoPreviewUrl(initialData?.video_url || null); // Show existing video URL if in edit mode

      // Cleanup URLs on component unmount or before setting new ones
     return () => {
       if (imagePreviewUrl && imagePreviewUrl.startsWith('blob:')) URL.revokeObjectURL(imagePreviewUrl);
       if (videoPreviewUrl && videoPreviewUrl.startsWith('blob:')) URL.revokeObjectURL(videoPreviewUrl);
     };

  }, [schema, initialData, buildEmptySpell]); // buildEmptySpell is memoized

  /* generic nested-field setter */
 const handleNestedChange = useCallback((cat, sub, key, val) =>
    setSpellFormData((prev) => {
      // Ensure category and subcategory exist
      const updatedCat = prev[cat] ? { ...prev[cat] } : {};
      const updatedSub = updatedCat[sub] ? { ...updatedCat[sub] } : {};

      // Ensure numeric fields get numbers
      let finalVal = val;
       if (cat === 'Mod Params' || ['Costo', 'Turni', 'Gittata'].includes(key)) {
           finalVal = isNaN(parseInt(val)) ? 0 : parseInt(val);
       }

      updatedSub[key] = finalVal;
      updatedCat[sub] = updatedSub;

      return { ...prev, [cat]: updatedCat };
    }), []); // No dependencies needed as it operates on internal state logic


   /* ---------- media previews ---------- */
   const preview = (e, isImg) => {
     const file = e.target.files?.[0];
     const currentPreviewUrl = isImg ? imagePreviewUrl : videoPreviewUrl;

     // Revoke previous blob URL if it exists
     if (currentPreviewUrl && currentPreviewUrl.startsWith('blob:')) {
       URL.revokeObjectURL(currentPreviewUrl);
     }

     if (!file) {
       // Clear state if file is removed
       if (isImg) {
         setImageFile(null);
         setImagePreviewUrl(null);
       } else {
         setVideoFile(null);
         setVideoPreviewUrl(null);
       }
       return;
     }

     const newPreviewUrl = URL.createObjectURL(file);
     if (isImg) {
       setImageFile(file);
       setImagePreviewUrl(newPreviewUrl);
     } else {
       setVideoFile(file);
       setVideoPreviewUrl(newPreviewUrl);
     }
   };


  /* ---------- save / cancel handlers ---------- */
   // Use useCallback for cleanSpell if its logic is stable
   const cleanSpell = useCallback(() => {
     const num = (v) => (v === '' || isNaN(parseInt(v)) ? 0 : parseInt(v)); // Handle empty strings
     const s = spellFormData;
     const cleaned = {
       Nome:   s.Nome?.trim() || "", // Ensure Nome exists and trim
       Costo:  num(s.Costo),
       Turni:  num(s.Turni),
       Gittata:num(s.Gittata),
       "Effetti Positivi": s["Effetti Positivi"] || "",
       "Effetti Negativi": s["Effetti Negativi"] || "",
       Esperienza: s.Esperienza || "",
       "Mod Params": {
         Base: {},
         Combattimento: {},
       },
       TPC:          { ...(s.TPC || {}) },
       "TPC Fisico": { ...(s["TPC Fisico"] || {}) },
       "TPC Mentale":{ ...(s["TPC Mentale"] || {}) },
       "Tipo Base":  s["Tipo Base"] || "",
     };

     // Clean Mod Params safely
     if (s["Mod Params"]?.Base) {
       Object.keys(s["Mod Params"].Base).forEach(k => {
         cleaned["Mod Params"].Base[k] = num(s["Mod Params"].Base[k]);
       });
     }
     if (s["Mod Params"]?.Combattimento) {
       Object.keys(s["Mod Params"].Combattimento).forEach(k => {
         cleaned["Mod Params"].Combattimento[k] = num(s["Mod Params"].Combattimento[k]);
       });
     }

     // Include existing URLs if in edit mode and files haven't changed
      if (mode === 'edit' && initialData?.image_url && !imageFile) {
          cleaned.image_url = initialData.image_url;
      }
      if (mode === 'edit' && initialData?.video_url && !videoFile) {
          cleaned.video_url = initialData.video_url;
      }


     return cleaned;
   }, [spellFormData, mode, initialData, imageFile, videoFile]); // Dependencies for cleanSpell

  const initiateSave = (e) => {
    e.preventDefault();
    if (!spellFormData.Nome || !spellFormData.Nome.trim()) {
      alert("Spell Name (Nome) is required.");
      return;
    }
    if (mode === "edit") {
       setShowConfirmation(true); // Show confirmation only in edit mode
    } else {
       dispatchSave(); // Directly save in add mode
    }
  };

   // Use useCallback for dispatchSave
   const dispatchSave = useCallback(() => {
     setShowConfirmation(false); // Hide confirmation if it was shown
     onClose({
       spellData: cleanSpell(),
       imageFile, // Pass the File object, not the preview URL
       videoFile, // Pass the File object, not the preview URL
     });
   }, [onClose, cleanSpell, imageFile, videoFile]); // Dependencies for dispatchSave


  /* ---------- tiny helpers ---------- */
    const selectOrText = useCallback((opts, val, changeFn, placeholder = "") => {
        const commonClasses = "w-full p-2 rounded bg-gray-700 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/50";
        return Array.isArray(opts) && opts.length > 0
            ? (
                <select value={val || ""} onChange={changeFn} className={commonClasses}>
                     {placeholder && <option value="" disabled>{placeholder}</option>}
                    {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
            ) : (
                <input
                    type="text"
                    value={val || ""}
                    onChange={changeFn}
                    className={commonClasses}
                    placeholder={placeholder}
                />
            );
    }, []); // No external dependencies


  /* ---------- rendered form ---------- */
  const formEl = (
    <form onSubmit={initiateSave} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}> {/* Prevent accidental submit on Enter */}
       {/* Basic Info: Nome, Costo, Turni, Gittata */}
       <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
         {[
           ["Nome", "text", s => s.Nome, v => setSpellFormData(p => ({ ...p, Nome: v })), "Spell Name *"],
           ["Costo", "number", s => s.Costo, v => setSpellFormData(p => ({ ...p, Costo: v })), "Mana Cost"],
           ["Turni", "number", s => s.Turni, v => setSpellFormData(p => ({ ...p, Turni: v })), "Duration/Cast Time"],
           ["Gittata", "number", s => s.Gittata, v => setSpellFormData(p => ({ ...p, Gittata: v })), "Range"],
         ].map(([lbl, type, get, set, placeholder]) => (
           <div key={lbl}>
             <label className="block text-white text-sm mb-1">{lbl} {lbl === 'Nome' ? <span className="text-red-500">*</span> : ''}</label>
             <input
               type={type}
               value={get(spellFormData) ?? (type === 'number' ? 0 : '')} // Provide default for controlled input
               onChange={(e) => set(e.target.value)}
               min={type === 'number' ? "0" : undefined} // Basic validation for numbers
               className="w-full p-2 rounded bg-gray-700 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/50"
               placeholder={placeholder}
               required={lbl === 'Nome'} // HTML5 validation
             />
           </div>
         ))}
       </div>

      {/* Effects: Positive, Negative */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {["Effetti Positivi", "Effetti Negativi"].map((k) => (
          <div key={k}>
            <label className="block text-white text-sm mb-1">{k}</label>
            <textarea
              value={spellFormData[k] || ""}
              onChange={(e) => setSpellFormData(prev => ({ ...prev, [k]: e.target.value }))}
              className="w-full p-2 rounded bg-gray-700 text-white text-sm h-20 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500/50" // Allow vertical resize
              placeholder={`Describe ${k.toLowerCase()}...`}
            />
          </div>
        ))}
      </div>


       {/* Dropdowns/Text: Esperienza, Tipo Base */}
       <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
         {[
           ["Esperienza", schema?.Esperienza],
           ["Tipo Base", schema?.["Tipo Base"]],
         ].map(([lbl, opts]) => (
           <div key={lbl}>
             <label className="block text-white text-sm mb-1">{lbl}</label>
             {selectOrText(opts, spellFormData[lbl],
               (e) => setSpellFormData(prev => ({ ...prev, [lbl]: e.target.value })), `Select ${lbl}...`)}
           </div>
         ))}
       </div>


      {/* Mod Params Section */}
       <div className="mb-4 p-4 bg-gray-700/50 rounded-lg">
           <h3 className="text-white text-lg mb-3 font-medium">Modificatori Parametri</h3>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
               {["Base", "Combattimento"].map((grp) => (
                   <div key={grp}>
                       <h4 className="text-gray-300 font-semibold mb-2 text-base border-b border-gray-600 pb-1">{grp}</h4>
                       <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                           {(grp === "Base"
                               ? ["Costituzione", "Destrezza", "Fortuna", "Forza", "Intelligenza", "Saggezza"]
                               : ["Attacco", "Critico", "Difesa", "Disciplina", "RiduzioneDanni", "Salute"]
                           ).map((p) => (
                               <div key={p}>
                                   <label className="block text-white text-xs mb-0.5">{p}</label>
                                   <input
                                       type="number"
                                       value={spellFormData["Mod Params"]?.[grp]?.[p] ?? 0} // Default to 0
                                       onChange={(e) => handleNestedChange("Mod Params", grp, p, e.target.value)}
                                       className="w-full p-1.5 rounded bg-gray-600 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                   />
                               </div>
                           ))}
                       </div>
                   </div>
               ))}
           </div>
       </div>

      {/* TPC Sections */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {["TPC", "TPC Fisico", "TPC Mentale"].map((tpc) => (
          <div key={tpc} className="p-3 bg-gray-700/50 rounded-lg">
            <h3 className="text-white text-base mb-2 font-medium">{tpc}</h3>
            <div className="space-y-2">
              {["Param1", "Param2", "ParamTarget"].map((p) => (
                <div key={`${tpc}-${p}`}>
                  <label className="block text-white text-xs mb-0.5">{p}</label>
                  {selectOrText(schema?.[tpc]?.[p],
                    spellFormData[tpc]?.[p],
                    (e) => setSpellFormData((prev) => ({
                        ...prev,
                        [tpc]: { ...(prev[tpc] || {}), [p]: e.target.value }
                    })), `Select ${p}...`
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Media Uploads */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4 p-4 bg-gray-700/50 rounded-lg">
        {/* Image Upload */}
        <div>
          <label className="block text-white text-sm mb-1">Immagine (Opzionale)</label>
          <input type="file" accept="image/*" onChange={(e) => preview(e, true)}
                 className="w-full text-sm text-white file:mr-4 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
          {imagePreviewUrl && (
             <div className="mt-2 relative w-24 h-24">
                <img src={imagePreviewUrl} alt="Preview" className="w-full h-full object-cover rounded border border-gray-600" />
                 {/* Add a clear button */}
                  <button type="button" onClick={() => { if (imagePreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(imagePreviewUrl); setImageFile(null); setImagePreviewUrl(initialData?.image_url || null); e.target.value = null; }} className="absolute top-0 right-0 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center -mt-1 -mr-1">&times;</button>
              </div>
           )}
           {!imagePreviewUrl && <div className="mt-2 w-24 h-24 rounded border border-dashed border-gray-600 flex items-center justify-center text-gray-500 text-xs">No Image</div>}
        </div>

         {/* Video Upload */}
         <div>
           <label className="block text-white text-sm mb-1">Video (Opzionale)</label>
           <input type="file" accept="video/*" onChange={(e) => preview(e, false)}
                   className="w-full text-sm text-white file:mr-4 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
           {videoPreviewUrl && (
             <div className="mt-2 relative max-w-xs">
                <video src={videoPreviewUrl} controls className="w-full max-h-48 rounded border border-gray-600" />
                {/* Add a clear button */}
                <button type="button" onClick={() => { if (videoPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(videoPreviewUrl); setVideoFile(null); setVideoPreviewUrl(initialData?.video_url || null); e.target.value = null;}} className="absolute top-0 right-0 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center -mt-1 -mr-1">&times;</button>
              </div>
            )}
            {!videoPreviewUrl && <div className="mt-2 h-24 rounded border border-dashed border-gray-600 flex items-center justify-center text-gray-500 text-xs">No Video</div>}

           <p className="text-gray-400 text-xs mt-1">Consigliato: video breve (&lt;30s) e di dimensioni ridotte.</p>
         </div>
      </div>


      {/* Action Buttons */}
      <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-600">
        <button
          type="button"
          onClick={() => onClose(null)} // Always pass null on cancel
          className="px-5 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-md shadow-md transition-colors duration-150"
        >
          Cancel
        </button>
        <button
          type="submit" // Triggers initiateSave
          className="px-5 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-md shadow-md transition-colors duration-150"
          disabled={!spellFormData.Nome?.trim()} // Disable if name is empty
        >
          {saveButtonText} {/* Use the prop for button text */}
        </button>
      </div>
    </form>
  );

  /* ---------- optional confirmation (edit-mode) ---------- */
  const confirmationDialog = (
    <div className="text-white">
      <p className="mb-4 text-center">Sei sicuro di voler sovrascrivere questo spell?</p>
      <div className="flex justify-center gap-4">
        <button onClick={() => setShowConfirmation(false)}
                className="px-5 py-2 bg-gray-500 rounded hover:bg-gray-600 transition-colors duration-150">
          Annulla
        </button>
        <button onClick={dispatchSave} // Calls the save logic
                className="px-5 py-2 bg-green-600 rounded hover:bg-green-700 transition-colors duration-150">
          Conferma Sovrascrittura
        </button>
      </div>
    </div>
  );

  // Determine what body content to show
   const bodyContent = mode === "edit" && showConfirmation ? confirmationDialog : formEl;

  /* ---------- mount in portal ---------- */
  return ReactDOM.createPortal(
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-75 z-[9999] p-4"> {/* Increased opacity, ensure highest z-index */}
       <div className="bg-gray-800 p-5 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto border border-gray-700"> {/* Slightly smaller max-width */}
        <h2 className="text-xl text-white mb-1 font-semibold">
          {mode === "add" ? "Crea Nuovo Spell" : "Modifica Spell"}
        </h2>
        <p className="text-gray-300 text-sm mb-4 border-b border-gray-700 pb-2">({userName})</p>
         {schema ? bodyContent : <div className="text-white text-center p-8">Loading spell schema...</div>}
      </div>
    </div>,
    document.body // Mount directly to body
  );
}