// file: ./frontend/src/components/DMDashboard.js # do not remove this line
import React from 'react';
import Navbar from './elements/navbar';

const DMDashboard = () => {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Navbar />
      <div className="container mx-auto p-4">
        <h1 className="text-3xl font-bold mb-6">DM Dashboard</h1>
        <div className="bg-gray-800 rounded-lg p-6">
          <p>
            Welcome to the DM Dashboard. This area is only accessible to users with the DM role.
          </p>
          {/* Insert DM-specific functionality here */}
        </div>
      </div>
    </div>
  );
};

export default DMDashboard;
