// file: ./frontend/src/components/codex/buttons/AddLinguaButton.js
import React from 'react';

function AddLinguaButton() {
  // Placeholder onClick handler - functionality to be added later
  const handleClick = () => {
    console.log("Aggiungi Lingua button clicked - implement action");
    // Example: Open a modal, navigate to an add page, etc.
  };

  // Updated className:
  // - Changed bg-blue-600 to bg-gray-600
  // - Changed hover:bg-blue-700 to hover:bg-gray-700
  // - Changed transition duration-150 ease-in-out to transition-colors for consistency with the reference button's transition type
  return (
    <button
      onClick={handleClick}
      className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded transition-colors mb-4 shadow-md"
    >
      Aggiungi Lingua
    </button>
  );
}

export default AddLinguaButton;