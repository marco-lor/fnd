import { useEffect, useRef, useState } from 'react';
import {
  doc,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import {
  GRIGLIATA_LIGHTING_RENDER_INPUT_COLLECTION,
  normalizeGrigliataLightingRenderInput,
} from './lightingRenderInput';

export default function useGrigliataLightingRenderInput({
  backgroundId = '',
  currentUserId = '',
}) {
  const [lightingRenderInputState, setLightingRenderInputState] = useState({
    backgroundId: '',
    value: null,
    isReady: false,
  });
  const subscriptionGenerationRef = useRef(0);
  const hasMatchingState = lightingRenderInputState.backgroundId === backgroundId;
  const lightingRenderInput = hasMatchingState ? lightingRenderInputState.value : null;
  const isLightingRenderInputReady = hasMatchingState && lightingRenderInputState.isReady;

  useEffect(() => {
    const subscriptionGeneration = subscriptionGenerationRef.current + 1;
    subscriptionGenerationRef.current = subscriptionGeneration;

    if (!currentUserId || !backgroundId) {
      setLightingRenderInputState({
        backgroundId: '',
        value: null,
        isReady: false,
      });
      return undefined;
    }

    const subscribedBackgroundId = backgroundId;
    setLightingRenderInputState({
      backgroundId: subscribedBackgroundId,
      value: null,
      isReady: false,
    });

    const unsubscribe = onSnapshot(
      doc(db, GRIGLIATA_LIGHTING_RENDER_INPUT_COLLECTION, subscribedBackgroundId),
      (snapshot) => {
        if (subscriptionGenerationRef.current !== subscriptionGeneration) {
          return;
        }

        setLightingRenderInputState({
          backgroundId: subscribedBackgroundId,
          value: snapshot.exists()
            ? normalizeGrigliataLightingRenderInput({
              backgroundId: snapshot.id,
              ...snapshot.data(),
            })
            : null,
          isReady: true,
        });
      },
      (error) => {
        if (subscriptionGenerationRef.current !== subscriptionGeneration) {
          return;
        }

        console.error('Failed to load Grigliata lighting render input:', error);
        setLightingRenderInputState({
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
  }, [backgroundId, currentUserId]);

  return {
    lightingRenderInput,
    isLightingRenderInputReady,
  };
}
