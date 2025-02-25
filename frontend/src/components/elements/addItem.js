// file: ./frontend/src/components/elements/addItem.js
import React, { useState, useEffect } from 'react';
import { db } from '../firebaseConfig'; // Import Firestore instance from firebaseConfig.js
import { doc, getDoc, setDoc } from "firebase/firestore";

export function AddItemOverlay({ onClose }) {
  const [schema, setSchema] = useState(null);
  const [itemFormData, setItemFormData] = useState({});

  useEffect(() => {
    // Fetch the schema from Firebase when the overlay mounts
    const fetchSchema = async () => {
      try {
        const schemaDocRef = doc(db, "items", "schema_arma");
        const docSnap = await getDoc(schemaDocRef);
        if (docSnap.exists()) {
          const schemaData = docSnap.data();
          setSchema(schemaData);
          // Initialize form data based on the schema structure
          let initialData = {};
          Object.keys(schemaData).forEach(field => {
            if (["Slot", "Hands", "Tipo"].includes(field) && Array.isArray(schemaData[field])) {
              initialData[field] = schemaData[field][0] || "";
            } else if (typeof schemaData[field] === "string") {
              initialData[field] = "";
            }
            // Special handling for Parametri field – assume it contains categories "Base" and "Combattimento"
            else if (field === "Parametri" && typeof schemaData[field] === "object") {
              initialData[field] = {};
              Object.keys(schemaData[field]).forEach(category => {
                initialData[field][category] = {};
                Object.keys(schemaData[field][category]).forEach(subField => {
                  initialData[field][category][subField] = { "1": "", "4": "", "7": "", "10": "" };
                });
              });
            }
            // For special table fields (to be combined into one table)
            else if (
              ["Penetrazione", "Danno", "Danno Critico", "Bonus Danno Critico", "Bonus Danno"].includes(field) &&
              typeof schemaData[field] === "object"
            ) {
              initialData[field] = { "1": "", "4": "", "7": "", "10": "" };
            }
            // For other nested map fields
            else if (typeof schemaData[field] === "object" && !Array.isArray(schemaData[field])) {
              initialData[field] = {};
              Object.keys(schemaData[field]).forEach(subKey => {
                initialData[field][subKey] = "";
              });
            }
          });
          setItemFormData(initialData);
        } else {
          console.error("Schema not found at /items/schema_arma");
        }
      } catch (error) {
        console.error("Error fetching schema:", error);
      }
    };

    fetchSchema();
  }, []);

  const handleSaveItem = async () => {
    try {
      const itemName = itemFormData.Nome ? itemFormData.Nome.trim() : "";
      if (!itemName) {
        alert("Nome is required");
        return;
      }
      const docId = itemName.replace(/\s+/g, "_");
      // Check if an item with the same name (docId) already exists in the database
      const itemDocRef = doc(db, "items", docId);
      const existingDocSnap = await getDoc(itemDocRef);
      if (existingDocSnap.exists()) {
        alert("Item already exists. Please change the name.");
        return;
      }
      await setDoc(itemDocRef, itemFormData);
      alert("Item saved successfully");
      onClose(); // Close the overlay after saving
    } catch (error) {
      console.error("Error saving item:", error);
      alert("Error saving item");
    }
  };

  // Render the basic fields in the required order: Nome, Slot, Tipo, Hands, Effetto.
  const renderBasicFields = () => {
    if (!schema) return null;
    return (
      <>
        {schema.Nome !== undefined && (
          <div className="mb-4">
            <label className="block text-white mb-1">Nome</label>
            <input
              type="text"
              value={itemFormData.Nome || ''}
              onChange={(e) => setItemFormData({ ...itemFormData, Nome: e.target.value })}
              className="w-full p-2 rounded bg-gray-700 text-white"
              placeholder="Enter Nome"
            />
          </div>
        )}
        {schema.Slot !== undefined && Array.isArray(schema.Slot) && (
          <div className="mb-4">
            <label className="block text-white mb-1">Slot</label>
            <select
              value={itemFormData.Slot || ''}
              onChange={(e) => setItemFormData({ ...itemFormData, Slot: e.target.value })}
              className="w-full p-2 rounded bg-gray-700 text-white"
            >
              {schema.Slot.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        )}
        {schema.Tipo !== undefined && Array.isArray(schema.Tipo) && (
          <div className="mb-4">
            <label className="block text-white mb-1">Tipo</label>
            <select
              value={itemFormData.Tipo || ''}
              onChange={(e) => setItemFormData({ ...itemFormData, Tipo: e.target.value })}
              className="w-full p-2 rounded bg-gray-700 text-white"
            >
              {schema.Tipo.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        )}
        {schema.Hands !== undefined && Array.isArray(schema.Hands) && (
          <div className="mb-4">
            <label className="block text-white mb-1">Hands</label>
            <select
              value={itemFormData.Hands || ''}
              onChange={(e) => setItemFormData({ ...itemFormData, Hands: e.target.value })}
              className="w-full p-2 rounded bg-gray-700 text-white"
            >
              {schema.Hands.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        )}
        {schema.Effetto !== undefined && typeof schema.Effetto === "string" && (
          <div className="mb-4">
            <label className="block text-white mb-1">Effetto</label>
            <input
              type="text"
              value={itemFormData.Effetto || ''}
              onChange={(e) => setItemFormData({ ...itemFormData, Effetto: e.target.value })}
              className="w-full p-2 rounded bg-gray-700 text-white"
              placeholder="Enter Effetto"
            />
          </div>
        )}
      </>
    );
  };

  // Render three tables side by side: Special Params, Parametri Base, and Parametri Combattimento.
  const renderTablesSection = () => {
    if (!schema) return null;

    // Special Params fields to combine into one table
    const specialFields = ["Penetrazione", "Danno", "Bonus Danno", "Danno Critico", "Bonus Danno Critico"];
    const hasSpecialFields = specialFields.some(field => schema[field] !== undefined);

    const renderSpecialTable = () => (
      <div className="w-1/3 border p-2 rounded">
        <h3 className="text-white mb-2">Special Params</h3>
        <table className="w-full text-white">
          <thead>
            <tr>
              <th className="border px-2 py-1">Param</th>
              {["1", "4", "7", "10"].map(col => (
                <th key={col} className="border px-2 py-1">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {specialFields.map(field => {
              if (schema[field] === undefined) return null;
              return (
                <tr key={field}>
                  <td className="border px-2 py-1">{field}</td>
                  {["1", "4", "7", "10"].map(col => (
                    <td key={col} className="border px-2 py-1">
                      <input
                        type="text"
                        value={(itemFormData[field] && itemFormData[field][col]) || ''}
                        onChange={(e) => {
                          const newData = { ...itemFormData };
                          if (!newData[field]) newData[field] = { "1": "", "4": "", "7": "", "10": "" };
                          newData[field][col] = e.target.value;
                          setItemFormData(newData);
                        }}
                        className="w-full p-1 rounded bg-gray-700 text-white"
                        placeholder={`Enter ${col}`}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );

    // For Parametri Base and Parametri Combattimento, we assume the "Parametri" field contains both.
    const baseParams = (schema.Parametri && schema.Parametri["Base"]) || null;
    const combatParams = (schema.Parametri && schema.Parametri["Combattimento"]) || null;

    const renderParamTable = (category, title) => (
      <div className="w-1/3 border p-2 rounded">
        <h3 className="text-white mb-2">{title}</h3>
        <table className="w-full text-white">
          <thead>
            <tr>
              <th className="border px-2 py-1">Field</th>
              {["1", "4", "7", "10"].map(col => (
                <th key={col} className="border px-2 py-1">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {category === "Base" &&
              baseParams && Object.keys(baseParams).map(subField => (
                <tr key={subField}>
                  <td className="border px-2 py-1">{subField}</td>
                  {["1", "4", "7", "10"].map(col => (
                    <td key={col} className="border px-2 py-1">
                      <input
                        type="text"
                        value={
                          (itemFormData.Parametri &&
                            itemFormData.Parametri["Base"] &&
                            itemFormData.Parametri["Base"][subField] &&
                            itemFormData.Parametri["Base"][subField][col]
                          ) || ''
                        }
                        onChange={(e) => {
                          const newData = { ...itemFormData };
                          if (!newData.Parametri) newData.Parametri = {};
                          if (!newData.Parametri["Base"]) newData.Parametri["Base"] = {};
                          if (!newData.Parametri["Base"][subField]) {
                            newData.Parametri["Base"][subField] = { "1": "", "4": "", "7": "", "10": "" };
                          }
                          newData.Parametri["Base"][subField][col] = e.target.value;
                          setItemFormData(newData);
                        }}
                        className="w-full p-1 rounded bg-gray-700 text-white"
                        placeholder={`Enter ${col}`}
                      />
                    </td>
                  ))}
                </tr>
              ))
            }
            {category === "Combattimento" &&
              combatParams && Object.keys(combatParams).map(subField => (
                <tr key={subField}>
                  <td className="border px-2 py-1">{subField}</td>
                  {["1", "4", "7", "10"].map(col => (
                    <td key={col} className="border px-2 py-1">
                      <input
                        type="text"
                        value={
                          (itemFormData.Parametri &&
                            itemFormData.Parametri["Combattimento"] &&
                            itemFormData.Parametri["Combattimento"][subField] &&
                            itemFormData.Parametri["Combattimento"][subField][col]
                          ) || ''
                        }
                        onChange={(e) => {
                          const newData = { ...itemFormData };
                          if (!newData.Parametri) newData.Parametri = {};
                          if (!newData.Parametri["Combattimento"]) newData.Parametri["Combattimento"] = {};
                          if (!newData.Parametri["Combattimento"][subField]) {
                            newData.Parametri["Combattimento"][subField] = { "1": "", "4": "", "7": "", "10": "" };
                          }
                          newData.Parametri["Combattimento"][subField][col] = e.target.value;
                          setItemFormData(newData);
                        }}
                        className="w-full p-1 rounded bg-gray-700 text-white"
                        placeholder={`Enter ${col}`}
                      />
                    </td>
                  ))}
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    );

    return (
      <div className="flex gap-4">
        {hasSpecialFields && renderSpecialTable()}
        {baseParams && renderParamTable("Base", "Parametri Base")}
        {combatParams && renderParamTable("Combattimento", "Parametri Combattimento")}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-60">
      {/* Increased overlay width from 800px to 1600px */}
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-[1600px] max-h-[80vh] overflow-y-auto">
        <h2 className="text-xl text-white mb-4">Add New Item</h2>
        <form onSubmit={(e) => { e.preventDefault(); handleSaveItem(); }}>
          {renderBasicFields()}
          {renderTablesSection()}
          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
