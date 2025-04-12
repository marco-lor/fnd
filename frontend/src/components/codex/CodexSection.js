// file: ./frontend/src/components/codex/CodexSection.js
import React from 'react';
import PropTypes from 'prop-types'; // Import PropTypes for prop validation

function CodexSection({ title, items, AddButtonComponent }) {
  // Defensive check: Ensure items is an object before trying to get entries
  const entries = items && typeof items === 'object' ? Object.entries(items) : [];

  return (
    <div className="bg-gray-800 p-4 rounded-lg shadow-lg flex flex-col h-full"> {/* Added h-full for consistent height */}
      {/* Conditionally render the Add button only if the component is provided */}
      {AddButtonComponent && <AddButtonComponent />}
      <h2 className="text-2xl font-semibold mb-4 border-b border-gray-700 pb-2">{title}</h2>
      <div className="flex-grow overflow-y-auto"> {/* Added overflow-y-auto if content exceeds height */}
        {entries.length > 0 ? (
          <ul className="space-y-3">
            {entries.map(([nome, descrizione]) => (
              <li key={nome}>
                <h3 className="font-bold text-lg">{nome}</h3>
                {/* Only render description if it exists and is a string */}
                {descrizione && typeof descrizione === 'string' && (
                    <p className="text-sm text-gray-300">{descrizione}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-400">Nessun elemento disponibile per "{title}".</p>
        )}
      </div>
    </div>
  );
}

// Add PropTypes for better component documentation and error checking
CodexSection.propTypes = {
  title: PropTypes.string.isRequired,
  items: PropTypes.object, // Expecting an object, even if empty
  AddButtonComponent: PropTypes.elementType, // Expecting a React component type (or null/undefined)
};

// Default props for robustness
CodexSection.defaultProps = {
    items: {},
    AddButtonComponent: null,
};

export default CodexSection;