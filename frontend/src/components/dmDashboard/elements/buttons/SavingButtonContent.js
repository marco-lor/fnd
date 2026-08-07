import React from 'react';

export default function SavingButtonContent({ label = 'Saving...' }) {
  return (
    <>
      <svg
        className="animate-spin h-4 w-4 mr-2"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.37 0 0 5.37 0 12h4z"
        />
      </svg>
      <span>{label}</span>
    </>
  );
}
