// file: ./frontend/src/components/echiDiViaggio/EchiDiViaggio.js
import React from 'react';
import Navbar from '../common/navbar'; // Import the Navbar
import { useAuth } from '../../AuthContext'; // Import useAuth

function EchiDiViaggio() {
  const { user, userData, loading } = useAuth(); // Use auth context

  // Optional: Show loading state or handle case where user is not logged in
  if (loading) {
    return <div className="text-center text-white pt-10">Loading...</div>; // Basic loading indicator
  }
  if (!user) {
    // This check might be redundant if routing already protects pages
    // but can be useful for components used in multiple places.
    return <div className="text-center text-white pt-10">Please log in to view this page.</div>;
  }

  return (
    <div className="echi-di-viaggio-page-container bg-gray-900 min-h-screen text-white">
      <Navbar /> {/* Render the Navbar */}
      <main className="p-4 md:p-8">
        <h1 className="text-3xl font-bold text-center mb-6 text-[#FFA500]">Echi di Viaggio</h1>
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg max-w-4xl mx-auto">
          <p className="text-lg text-center text-gray-300">
            Questa sezione conterrà i racconti e le memorie delle avventure passate.
            <br />
            (Contenuto attualmente non disponibile - Placeholder)
          </p>
          {/* Future content for the Echi di Viaggio page will go here */}
        </div>
      </main>
    </div>
  );
}

export default EchiDiViaggio;