import React, { useContext, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { deleteDoc, doc, onSnapshot } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage"; // Added Firebase storage functions
import { db, storage } from "../../firebaseConfig"; // Imported storage alongside db
import { AuthContext } from "../../../AuthContext";

export default function ComparisonPanel({ item }) {
  const { user } = useContext(AuthContext);
  const [userData, setUserData] = useState(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [imageError, setImageError] = useState(false);

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

  // Proactively load the image and set error state if it fails
  useEffect(() => {
    if (item.image_url) {
      const img = new Image();
      img.onload = () => setImageError(false);
      img.onerror = () => setImageError(true);
      img.src = item.image_url;
    } else {
      setImageError(true);
    }
  }, [item.image_url]);

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

  // Delete handlers with confirmation dialog
  const handleDeleteClick = () => {
    setShowConfirmation(true);
  };

  const handleConfirmDelete = async () => {
    try {
      // First, delete the Firestore document
      await deleteDoc(doc(db, "items", item.id));
      console.log("Document deleted successfully");

      // Then, delete the associated image from Firebase storage if it exists
      if (item.image_url) {
        try {
          // Extract the file path from the URL
          const urlPath = decodeURIComponent(item.image_url.split('/o/')[1].split('?')[0]);
          const imageRef = ref(storage, urlPath);
          await deleteObject(imageRef);
          console.log("Image deleted successfully from storage");
        } catch (imageError) {
          console.error("Error deleting image from storage:", imageError);
        }
      }

      setShowConfirmation(false);
    } catch (error) {
      console.error("Error deleting document:", error);
    }
  };

  const handleCancelDelete = () => {
    setShowConfirmation(false);
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
        {/* Confirmation Dialog */}
        {showConfirmation && (
          <div className="absolute top-0 left-0 right-0 z-40 p-4 bg-gray-800 bg-opacity-95 rounded-lg shadow-lg border border-gray-700">
            <p className="text-white mb-4">Sei sicuro di voler eliminare questo oggetto?</p>
            <div className="flex justify-end space-x-2">
              <button
                onClick={handleCancelDelete}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
              >
                Annulla
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Elimina
              </button>
            </div>
          </div>
        )}

        {/* Conditionally render the delete button for authorized roles */}
        {(userData?.role === 'webmaster' || userData?.role === 'dm') && (
          <button
            onClick={handleDeleteClick}
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
            <span className="text-red-500 font-bold"></span>
          </button>
        )}

        {/* Background image with fallback */}
        {!imageError && item.image_url ? (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${item.image_url})` }}
          ></div>
        ) : (
          <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
            <div className="text-6xl text-gray-600 font-bold">
              {item.Nome?.charAt(0) || "?"}
            </div>
          </div>
        )}

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
