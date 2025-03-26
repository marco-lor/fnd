import React from 'react';
import Navbar from '../common/navbar';

const CombatPage = () => {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Navbar />
      <div className="container mx-auto p-4">
        <h1 className="text-3xl font-bold mb-6">Combat Tool</h1>
        {/* Combat tool content will go here */}
        <div className="bg-gray-800 p-6 rounded-lg">
          <p className="text-xl">Combat tool coming soon...</p>
        </div>
      </div>
    </div>
  );
};

export default CombatPage;
