// ./buttons/AddConoscenzaPersonale.js
import React from 'react';

// --- REFACTORED: Applied sleek button style ---
const sleekButtonStyle = "w-36 px-2 py-1 bg-gradient-to-r from-blue-800 to-indigo-900 hover:from-blue-700 hover:to-indigo-800 text-white text-xs font-medium rounded-md transition-all duration-150 transform hover:scale-105 flex items-center justify-center space-x-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 shadow-sm";

const AddConoscenzaPersonale = ({ onClick }) => {
  return (
    <button
      className={sleekButtonStyle} // Applied new style
      onClick={onClick} // Pass the onClick handler
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"> {/* Adjusted icon size */}
        <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
      </svg>
      <span>Add Conoscenza</span>
    </button>
  );
};

export default AddConoscenzaPersonale;