// file: ./frontend/src/components/codex/Codex.js
import React from 'react';
import Navbar from '../common/navbar'; // Import the Navbar
import { useAuth } from '../../AuthContext'; // Import useAuth to potentially access user data if needed

function Codex() {
  const { user, userData, loading } = useAuth(); // Use auth context

  // Optional: Show loading state or handle case where user is not logged in
  if (loading) {
    return <div>Loading...</div>; // Or a more sophisticated loading indicator
  }
  if (!user) {
    // Redirect to login or show a message, though App.js routes might handle this
    return <div>Please log in to view this page.</div>;
  }

  return (
    <div className="codex-page-container bg-gray-900 min-h-screen text-white">
      <Navbar /> {/* Render the Navbar */}
      <main className="p-4 md:p-8">
        <h1 className="text-3xl font-bold text-center mb-6">Codex</h1>
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
          <p className="text-lg text-center">
            Codex content will be displayed here. This is currently a placeholder.
          </p>
          {/* Future content for the Codex page will go here */}
        </div>
      </main>
    </div>
  );
}

export default Codex;