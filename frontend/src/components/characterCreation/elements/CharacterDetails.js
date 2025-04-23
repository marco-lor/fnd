import React from "react";

function CharacterDetails({ 
  characterName, 
  setCharacterName, 
  imageFile, 
  imagePreview, 
  handleImageChange, 
  selectedRace, 
  selectedAnima,
  error
}) {
  return (
    <div>
      {/* Character Name Input */}
      <div className="w-full mb-6">
        <label htmlFor="characterName" className="block text-white text-left mb-2 text-sm font-medium">
          Character Name
        </label>
        <input
          id="characterName"
          type="text"
          placeholder="Enter your character name"
          className="w-full p-3 rounded-[5px] text-base bg-[rgba(30,30,30,0.9)] text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300"
          value={characterName}
          onChange={(e) => setCharacterName(e.target.value)}
          required
        />
      </div>

      {/* Character Image Upload */}
      <div className="w-full mb-6">
        <label htmlFor="characterImage" className="block text-white text-left mb-2 text-sm font-medium">
          Character Image (Optional)
        </label>
        <div className="flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-4">
          {/* Image Preview */}
          <div className="flex-shrink-0">
            {imagePreview ? (
              <img
                src={imagePreview}
                alt="Preview"
                className="w-24 h-24 rounded-full object-cover border-2 border-[rgba(150,150,255,0.4)] shadow-md"
                onError={(e) => { e.target.src = 'https://placehold.co/96x96/333/ccc?text=Error'; }}
              />
            ) : (
              // Placeholder Icon
              <div className="w-24 h-24 rounded-full bg-gray-700 flex items-center justify-center text-white/50 border-2 border-[rgba(150,150,255,0.2)]">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            )}
          </div>
          {/* File Input */}
          <div className="flex-grow w-full">
            <input
              id="characterImage"
              type="file"
              accept="image/png, image/jpeg, image/webp, image/gif"
              onChange={handleImageChange}
              className="block w-full text-white text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer file:cursor-pointer file:transition-colors file:duration-200"
            />
            <p className="mt-2 text-xs text-gray-400 text-left">
              Square images look best. Max 1MB recommended.
            </p>
          </div>
        </div>
      </div>

      {/* Display selected choices summary */}
      <div className="w-full mb-6 p-4 bg-[rgba(30,30,40,0.6)] rounded-lg border border-[rgba(150,150,255,0.2)]">
        <h4 className="text-left text-white text-sm font-medium mb-2">Selected Choices:</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left text-sm">
          <div>
            <span className="text-gray-300">Race:</span> <span className="text-yellow-300">{selectedRace?.id || "None"}</span>
          </div>
          <div>
            <span className="text-gray-300">Anima Shard:</span> <span className="text-yellow-300">{selectedAnima?.name || "None"}</span>
          </div>
          {selectedAnima && (
            <>
              <div className="col-span-1 sm:col-span-2 mt-1">
                <span className="text-gray-300">Initial Bonuses: </span>
                {Object.entries(selectedAnima.bonuses).map(([param, value]) => (
                  <span key={param} className="inline-block bg-blue-900/50 px-2 py-0.5 rounded mr-2 mb-1">
                    <span className="text-yellow-300">{param}</span> +{value}
                  </span>
                ))}
              </div>
              {selectedAnima.levelUpBonus && Object.keys(selectedAnima.levelUpBonus).length > 0 && (
                <div className="col-span-1 sm:col-span-2 mt-1">
                  <span className="text-gray-300">Level Up Bonuses (per level): </span>
                  {Object.entries(selectedAnima.levelUpBonus).map(([param, value]) => (
                    <span key={param} className="inline-block bg-green-900/50 px-2 py-0.5 rounded mr-2 mb-1">
                      <span className="text-green-300">{param}</span> +{value}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      
      {/* Error message is now rendered in the parent component */}
    </div>
  );
}

export default CharacterDetails;