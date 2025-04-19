import Roll20Map from './elements/roll20map'; // Adjusted path  (or wherever your file is)
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../AuthContext'; // Assuming you need auth context
import { db } from '../firebaseConfig'; // Adjust path as needed
import { doc, updateDoc, collection, onSnapshot } from 'firebase/firestore'; // Removed getDoc as it's unused

const CombatPage = () => {
  const [combatId] = useState('YOUR_DEFAULT_COMBAT_ID'); // Removed setCombatId as it's unused
  const [mapUrl, setMapUrl] = useState(''); // State for the map image URL
  const [tokens, setTokens] = useState([]); // State for token data fetched from Firestore
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // TODO: How will you determine the 'combatId'?
  // Example: Maybe from URL parameters if using React Router
  // import { useParams } from 'react-router-dom';
  // const { combatId: routeCombatId } = useParams();
  // useEffect(() => {
  //   if (routeCombatId) setCombatId(routeCombatId);
  // }, [routeCombatId]);

  // Fetch Combat Data (Map URL and Initial Token Positions)
  useEffect(() => {
    if (!combatId || combatId === 'YOUR_DEFAULT_COMBAT_ID') {
        setLoading(false);
        setError("No valid combat selected.");
        return; // Don't fetch if no combat ID
    }

    setLoading(true);
    setError(null);

    // Listener for the main combat document (for mapUrl, grid settings etc.)
    const combatDocRef = doc(db, 'combats', combatId); // ASSUMING 'combats' collection
    const unsubscribeCombat = onSnapshot(combatDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setMapUrl(data.mapImageUrl || ''); // Assuming field name is mapImageUrl
        // You could also load grid size here: setGridSize(data.gridSize || 50);
        setError(null);
      } else {
        setError(`Combat with ID ${combatId} not found.`);
        setMapUrl('');
        setTokens([]);
      }
    }, (err) => {
       console.error("Error fetching combat data:", err);
       setError("Failed to load combat data.");
       setLoading(false); // Ensure loading stops on error
    });

    // Listener for the tokens subcollection
    const tokensColRef = collection(db, 'combats', combatId, 'tokens'); // ASSUMING 'tokens' subcollection
    const unsubscribeTokens = onSnapshot(tokensColRef, (querySnapshot) => {
        const fetchedTokens = [];
        querySnapshot.forEach((doc) => {
            fetchedTokens.push({ id: doc.id, ...doc.data() });
        });
        setTokens(fetchedTokens); // This will trigger the image loading in Roll20Map
        setLoading(false); // Set loading false after tokens arrive
        setError(null); // Clear error if tokens load successfully
    }, (err) => {
        console.error("Error fetching tokens:", err);
        setError("Failed to load tokens.");
        setTokens([]); // Clear tokens on error
        setLoading(false);
    });

    // Cleanup listeners on component unmount or when combatId changes
    return () => {
      unsubscribeCombat();
      unsubscribeTokens();
    };

  }, [combatId]); // Re-run if combatId changes

  // --- Callback Function to Update Firestore ---
  // Use useCallback to prevent this function from causing unnecessary re-renders of Roll20Map
  const handleTokenMove = useCallback(async (tokenId, newPosition) => {
    if (!combatId || combatId === 'YOUR_DEFAULT_COMBAT_ID' ) {
        console.error("Cannot update token position without a valid combatId.");
        return;
    }
    console.log(`Token ${tokenId} moved to`, newPosition); // For debugging

    // Update Firestore document for the specific token
    const tokenDocRef = doc(db, 'combats', combatId, 'tokens', tokenId);
    try {
      // Update only the x and y fields
      await updateDoc(tokenDocRef, {
        x: newPosition.x,
        y: newPosition.y,
      });
      console.log(`Successfully updated token ${tokenId} position in Firestore.`);
    } catch (error) {
      console.error(`Failed to update token ${tokenId} position in Firestore:`, error);
      // Optional: Add user feedback about the save failure
    }
  }, [combatId]); // Dependency: combatId is needed for the Firestore path

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <div className="flex-grow container mx-auto p-4 flex flex-col">
        <h1 className="text-3xl font-bold mb-6 text-center">Combat: {combatId}</h1>
        {/* Combat tool content */}
        <div className="flex-grow bg-gray-800 p-2 md:p-4 rounded-lg flex flex-col">
          {loading && <p className="text-xl text-center p-10">Loading Map...</p>}
          {error && <p className="text-xl text-center text-red-500 p-10">{error}</p>}
          {!loading && !error && mapUrl && (
            // The Roll20Map component will take available space due to flex-grow on parents
             <Roll20Map
              mapUrl={mapUrl}
              initialTokens={tokens} // Pass the tokens fetched from Firestore
              gridSize={50} // Example grid size - could be fetched from combat data
              onTokenMove={handleTokenMove} // Pass the callback function
            />
          )}
           {!loading && !error && !mapUrl && (
                <p className="text-xl text-center p-10">No map configured for this combat.</p>
           )}
        </div>
        {/* Other combat UI elements can go here (e.g., initiative tracker, chat) */}
      </div>
    </div>
  );
};

export default CombatPage;