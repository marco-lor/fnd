import React from 'react';

export function MultiSelect({ options = [], selected = [], onChange }) {
    const toggleOption = (option) => {
        const newSelection = selected.includes(option)
            ? selected.filter(o => o !== option)
            : [...selected, option];
        if (onChange) onChange(newSelection);
    };

    return (
        <div className="flex flex-wrap gap-2">
            {options.map(option => {
                const isActive = selected.includes(option);
                return (
                    <button
                        type="button"
                        key={option}
                        onClick={() => toggleOption(option)}
                        className={`px-3 py-1 rounded-full border text-sm transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50
                            ${isActive ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-700 text-gray-300 border-gray-600 hover:bg-gray-600'}`}
                    >
                        {option}
                    </button>
                );
            })}
        </div>
    );
}
