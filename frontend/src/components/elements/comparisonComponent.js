// file: ./frontend/src/components/elements/comparisonComponent.js
import React, { useContext, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { deleteDoc, doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { AuthContext } from "../../AuthContext";

export default function ComparisonPanel({ item }) {
  // Get the user from the shared AuthContext.
  const { user } = useContext(AuthContext);
  // Local state to hold additional user data from Firestore (including the role)
  const [userData, setUserData] = useState(null);

  useEffect(() => {
    if (user) {
      const userRef = doc(db, "users", user.uid);
      const unsubscribe = onSnapshot(
        userRef,
        (docSnap) => {
          if (docSnap.exists()) {
            setUserData(docSnap.data());
          }
        },
        (error) => {
          console.error("Error fetching user data:", error);
        }
      );
      return () => unsubscribe();
    }
  }, [user]);

  console.log("User role:", userData?.role);

  // Destructure nested parameters if present
  const parametri = item.Parametri || {};
  const baseParams = parametri.Base || {};
  const combatParams = parametri.Combattimento || {};

  // Compute the image URL (using a placeholder if not provided)
  const imageUrl = item.image_url
    ? item.image_url
    : `https://via.placeholder.com/150x150?text=${encodeURIComponent(item.Nome)}`;

  // Define the field groups with their display order and labels
  const itemGroup = [
    { key: "Penetrazione", label: "Penetrazione" },
    { key: "Danno", label: "Danno" },
    { key: "Bonus Danno", label: "Bonus Danno" },
    { key: "Danno Critico", label: "Danno Critico" },
    { key: "Bonus Danno Critico", label: "Bonus Danno Critico" }
  ];

  const baseGroup = [
    { key: "Fortuna", label: "Fortuna" },
    { key: "Destrezza", label: "Destrezza" },
    { key: "Costituzione", label: "Costituzione" },
    { key: "Intelligenza", label: "Intelligenza" },
    { key: "Saggezza", label: "Saggezza" },
    { key: "Forza", label: "Forza" }
  ];

  const combatGroup = [
    { key: "Difesa", label: "Difesa" },
    { key: "Salute", label: "Salute" },
    { key: "Critico", label: "Critico" },
    { key: "Attacco", label: "Attacco" },
    { key: "RiduzioneDanni", label: "Riduz. Danni" },
    { key: "Disciplina", label: "Disciplina" },
    { key: "Mira", label: "Mira" }
  ];

  // Helper function to render table cells for columns "1", "4", "7", "10"
  const renderRow = (data) => {
    return ["1", "4", "7", "10"].map(col => (
      <td key={col} className="border px-2 py-1 text-center">
        {data && data[col] ? data[col] : '-'}
      </td>
    ));
  };

  // Helper function to check if row should be displayed:
  // Only show the row if at least one cell is not "-" (or empty)
  const shouldShowRow = (data) => {
    if (!data) return false;
    const columns = ["1", "4", "7", "10"];
    return columns.some(col => data[col] !== undefined && data[col] !== '-' && data[col] !== null && data[col] !== '');
  };

  // Filter the groups based on row values
  const filteredItemGroup = itemGroup.filter(field => shouldShowRow(item[field.key]));
  const filteredBaseGroup = baseGroup.filter(field => shouldShowRow(baseParams[field.key]));
  const filteredCombatGroup = combatGroup.filter(field => shouldShowRow(combatParams[field.key]));

  // Handler to delete the document from Firestore
  const handleDelete = async () => {
    try {
      // Adjust "items" to match your Firestore collection name if necessary.
      await deleteDoc(doc(db, "items", item.id));
      console.log("Document deleted successfully");
    } catch (error) {
      console.error("Error deleting document:", error);
    }
  };

  return (
    <motion.div
      initial={{ x: 300, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 300, opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed right-0 p-0 overflow-y-auto z-50"
      style={{
        top: '14rem',
        width: '25vw',
        height: 'calc(100% - 4rem)'
      }}
    >
      <div className="relative h-full">
        {/* Conditionally render the delete button for authorized roles */}
        {(userData?.role === 'webmaster' || userData?.role === 'dm') && (
          <button
            onClick={handleDelete}
            className="absolute top-2 right-2 z-30 flex items-center space-x-1 bg-transparent border-none cursor-pointer"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-6 h-6 text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m2 0a2 2 0 012 2v1a2 2 0 01-2 2H7a2 2 0 01-2-2V9a2 2 0 012-2h10z"
              />
            </svg>
            <span className="text-red-500 font-bold">Elimina Oggetto</span>
          </button>
        )}

        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${imageUrl})` }}
        ></div>
        <div className="absolute inset-0 bg-black opacity-70"></div>
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-gray-900"></div>
        <div className="relative z-10 p-4">
          <h2 className="text-2xl font-bold text-white mb-4">{item.Nome}</h2>
          <div className="mb-4 space-y-1">
            <p className="text-white">
              <span className="font-semibold">Tipo:</span> {item.Tipo || '-'}
            </p>
            <p className="text-white">
              <span className="font-semibold">Hands:</span> {item.Hands || '-'}
            </p>
            <p className="text-white">
              <span className="font-semibold">Slot:</span> {item.Slot || '-'}
            </p>
            <p className="text-white">
              <span className="font-semibold">Effetto:</span> {item.Effetto || '-'}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-white border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-1 text-left">Item</th>
                  <th className="border px-2 py-1">1</th>
                  <th className="border px-2 py-1">4</th>
                  <th className="border px-2 py-1">7</th>
                  <th className="border px-2 py-1">10</th>
                </tr>
              </thead>
              <tbody>
                {filteredItemGroup.map(field => (
                  <tr key={field.key} className="border-b">
                    <td className="px-2 py-1">{field.label}</td>
                    {renderRow(item[field.key])}
                  </tr>
                ))}
                {filteredBaseGroup.length > 0 && (
                  <>
                    <tr className="bg-gray-800">
                      <td className="px-2 py-1 font-semibold" colSpan="5">Base</td>
                    </tr>
                    {filteredBaseGroup.map(field => (
                      <tr key={field.key} className="border-b">
                        <td className="px-2 py-1">{field.label}</td>
                        {renderRow(baseParams[field.key])}
                      </tr>
                    ))}
                  </>
                )}
                {filteredCombatGroup.length > 0 && (
                  <>
                    <tr className="bg-gray-800">
                      <td className="px-2 py-1 font-semibold" colSpan="5">Combat</td>
                    </tr>
                    {filteredCombatGroup.map(field => (
                      <tr key={field.key} className="border-b">
                        <td className="px-2 py-1">{field.label}</td>
                        {renderRow(combatParams[field.key])}
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
