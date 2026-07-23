import { useEffect, useRef, useState } from 'react';
import {
  doc,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import {
  GRIGLIATA_WALL_STATE_COLLECTION,
  normalizeGrigliataWallRuntimeState,
} from './wallRuntimeState';

export default function useGrigliataWallRuntimeState({
  backgroundId = '',
  currentUserId = '',
}) {
  const [wallRuntimeStateSnapshot, setWallRuntimeStateSnapshot] = useState({
    backgroundId: '',
    value: null,
    isReady: false,
  });
  const subscriptionGenerationRef = useRef(0);
  const hasMatchingState = wallRuntimeStateSnapshot.backgroundId === backgroundId;
  const wallRuntimeState = hasMatchingState ? wallRuntimeStateSnapshot.value : null;
  const isWallRuntimeStateReady = hasMatchingState && wallRuntimeStateSnapshot.isReady;

  useEffect(() => {
    const subscriptionGeneration = subscriptionGenerationRef.current + 1;
    subscriptionGenerationRef.current = subscriptionGeneration;

    if (!currentUserId || !backgroundId) {
      setWallRuntimeStateSnapshot({
        backgroundId: '',
        value: null,
        isReady: false,
      });
      return undefined;
    }

    const subscribedBackgroundId = backgroundId;
    setWallRuntimeStateSnapshot({
      backgroundId: subscribedBackgroundId,
      value: null,
      isReady: false,
    });

    const unsubscribe = onSnapshot(
      doc(db, GRIGLIATA_WALL_STATE_COLLECTION, subscribedBackgroundId),
      (snapshot) => {
        if (subscriptionGenerationRef.current !== subscriptionGeneration) {
          return;
        }

        setWallRuntimeStateSnapshot({
          backgroundId: subscribedBackgroundId,
          value: snapshot.exists()
            ? normalizeGrigliataWallRuntimeState({
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

        console.error('Failed to load Grigliata wall runtime state:', error);
        setWallRuntimeStateSnapshot({
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
    wallRuntimeState,
    isWallRuntimeStateReady,
  };
}
