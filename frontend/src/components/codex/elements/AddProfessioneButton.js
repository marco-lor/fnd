import React from 'react';

function AddProfessioneButton() {
  // Placeholder onClick handler - functionality to be added later
  const handleClick = () => {
    console.log("Aggiungi Professione button clicked - implement action");
    // Example: Open a modal, navigate to an add page, etc.
  };

  return (
    <button
      onClick={handleClick}
      className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded transition-colors mb-4 shadow-md"
    >
      Aggiungi Professione
    </button>
  );
}

export default AddProfessioneButton;
