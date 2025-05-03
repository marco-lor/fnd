// file: frontend/src/components/common/WeaponOverlay.js
import React from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * A reusable overlay component using React Portal.
 *
 * @param {object} props - Component props.
 * @param {React.ReactNode} props.children - The content to display inside the overlay body.
 * @param {string} props.title - The title displayed at the top of the overlay.
 * @param {function} props.onClose - Function to call when the overlay should be closed (e.g., Cancel button click, background click).
 * @param {function} props.onSave - Function to call when the save action is triggered.
 * @param {string} [props.saveButtonText="Save"] - Text for the save button.
 * @param {string} [props.cancelButtonText="Cancel"] - Text for the cancel button.
 * @param {boolean} [props.isLoading=false] - If true, disables the save button and potentially shows a loading indicator.
 * @param {string} [props.width="80vw"] - The width of the overlay content area.
 * @param {string} [props.height="80vh"] - The height of the overlay content area.
 * @param {number} [props.zIndex=9990] - The z-index for the overlay.
 */
export function WeaponOverlay({
  children,
  title,
  onClose,
  onSave,
  saveButtonText = "Save",
  cancelButtonText = "Cancel",
  isLoading = false,
  width = "80vw",
  height = "80vh",
  zIndex = 9990 // Default z-index
}) {

  // Handle clicks outside the modal content to close
  const handleBackgroundClick = (e) => {
    // Check if the click target is the background itself
    if (e.target === e.currentTarget) {
      onClose(false); // Pass false to indicate cancellation
    }
  };

  const overlayVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
    exit: { opacity: 0 }
  };

  const modalVariants = {
    hidden: { scale: 0.9, opacity: 0 },
    visible: { scale: 1, opacity: 1, transition: { type: "spring", stiffness: 300, damping: 30 } },
    exit: { scale: 0.9, opacity: 0, transition: { duration: 0.2 } }
  };

  const overlayContent = (
    <AnimatePresence>
      {/* Use motion.div for the background overlay */}
      <motion.div
        key="overlay-backdrop"
        className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-70 p-4"
        style={{ zIndex: zIndex }} // Apply zIndex here
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={overlayVariants}
        transition={{ duration: 0.3 }}
        onClick={handleBackgroundClick} // Close on background click
      >
        {/* Use motion.div for the modal content */}
        <motion.div
          key="overlay-content"
          className="bg-gray-800 rounded-lg shadow-xl overflow-hidden border border-gray-700 flex flex-col"
          style={{ width: width, height: height, maxHeight: '95vh', maxWidth: '95vw' }} // Added max dimensions
          variants={modalVariants}
          // Prevent clicks inside the modal from propagating to the background
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-5 border-b border-gray-700">
            <h2 className="text-2xl text-white font-semibold">{title}</h2>
          </div>

          {/* Body - Scrollable */}
          <div className="flex-grow p-5 overflow-y-auto">
            {children}
          </div>

          {/* Footer - Action Buttons */}
          <div className="flex justify-end gap-3 p-4 border-t border-gray-700 bg-gray-800">
            <button
              type="button"
              onClick={() => onClose(false)} // Pass false for cancellation
              disabled={isLoading}
              className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md shadow-md transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cancelButtonText}
            </button>
            <button
              type="button" // Changed from submit to button, handled by onSave prop
              onClick={onSave} // Trigger the save function passed via props
              disabled={isLoading}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-md transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Saving...' : saveButtonText}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  // Use React Portal to render the overlay outside the normal DOM hierarchy
  return ReactDOM.createPortal(overlayContent, document.body);
}
