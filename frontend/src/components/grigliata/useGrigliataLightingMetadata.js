import { useEffect, useRef, useState } from 'react';
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
  const [lightingMetadataState, setLightingMetadataState] = useState({
    backgroundId: '',
    value: null,
    isReady: false,
  });
  const subscriptionGenerationRef = useRef(0);
  const hasMatchingState = lightingMetadataState.backgroundId === backgroundId;
  const lightingMetadata = hasMatchingState ? lightingMetadataState.value : null;
  const isLightingMetadataReady = hasMatchingState && lightingMetadataState.isReady;

  useEffect(() => {
    const subscriptionGeneration = subscriptionGenerationRef.current + 1;
    subscriptionGenerationRef.current = subscriptionGeneration;

    if (!currentUserId || !isManager || !backgroundId) {
      setLightingMetadataState({
        backgroundId: '',
        value: null,
        isReady: false,
      });
      return undefined;
    }

    const subscribedBackgroundId = backgroundId;
    setLightingMetadataState({
      backgroundId: subscribedBackgroundId,
      value: null,
      isReady: false,
    });

    const unsubscribe = onSnapshot(
      doc(db, GRIGLIATA_BACKGROUND_LIGHTING_COLLECTION, subscribedBackgroundId),
      (snapshot) => {
        if (subscriptionGenerationRef.current !== subscriptionGeneration) {
          return;
        }

        setLightingMetadataState({
          backgroundId: subscribedBackgroundId,
          value: snapshot.exists() ? {
            id: snapshot.id,
            ...snapshot.data(),
          } : null,
          isReady: true,
        });
      },
      (error) => {
        if (subscriptionGenerationRef.current !== subscriptionGeneration) {
          return;
        }

        console.error('Failed to load Grigliata lighting metadata:', error);
        setLightingMetadataState({
          backgroundId: subscribedBackgroundId,
          value: null,
          isReady: true,
        });
      }
    );

    return () => {
      if (subscriptionGenerationRef.current === subscriptionGeneration) {
        subscriptionGenerationRef.current += 1;
      }
      unsubscribe();
    };
  }, [backgroundId, currentUserId, isManager]);

  return {
    lightingMetadata,
    isLightingMetadataReady,
  };
}

