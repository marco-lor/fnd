import { useEffect, useState } from 'react';
import {
  doc,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { GRIGLIATA_BACKGROUND_LIGHTING_COLLECTION } from './dungeonAlchemistLighting';

export default function useGrigliataLightingMetadata({
  backgroundId = '',
  currentUserId = '',
  isManager = false,
}) {
  const [lightingMetadata, setLightingMetadata] = useState(null);
  const [isLightingMetadataReady, setIsLightingMetadataReady] = useState(false);

  useEffect(() => {
    if (!currentUserId || !isManager || !backgroundId) {
      setLightingMetadata(null);
      setIsLightingMetadataReady(false);
      return undefined;
    }

    setIsLightingMetadataReady(false);

    const unsubscribe = onSnapshot(
      doc(db, GRIGLIATA_BACKGROUND_LIGHTING_COLLECTION, backgroundId),
      (snapshot) => {
        setLightingMetadata(snapshot.exists() ? {
          id: snapshot.id,
          ...snapshot.data(),
        } : null);
        setIsLightingMetadataReady(true);
      },
      (error) => {
        console.error('Failed to load Grigliata lighting metadata:', error);
        setLightingMetadata(null);
        setIsLightingMetadataReady(true);
      }
    );

    return () => unsubscribe();
  }, [backgroundId, currentUserId, isManager]);

  return {
    lightingMetadata,
    isLightingMetadataReady,
  };
}

