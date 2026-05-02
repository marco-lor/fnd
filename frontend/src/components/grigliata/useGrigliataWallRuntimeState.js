import { useEffect, useState } from 'react';
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
  const [wallRuntimeState, setWallRuntimeState] = useState(null);
  const [isWallRuntimeStateReady, setIsWallRuntimeStateReady] = useState(false);

  useEffect(() => {
    if (!currentUserId || !backgroundId) {
      setWallRuntimeState(null);
      setIsWallRuntimeStateReady(false);
      return undefined;
    }

    setIsWallRuntimeStateReady(false);

    const unsubscribe = onSnapshot(
      doc(db, GRIGLIATA_WALL_STATE_COLLECTION, backgroundId),
      (snapshot) => {
        setWallRuntimeState(snapshot.exists()
          ? normalizeGrigliataWallRuntimeState({
            backgroundId: snapshot.id,
            ...snapshot.data(),
          })
          : null);
        setIsWallRuntimeStateReady(true);
      },
      (error) => {
        console.error('Failed to load Grigliata wall runtime state:', error);
        setWallRuntimeState(null);
        setIsWallRuntimeStateReady(true);
      }
    );

    return () => unsubscribe();
  }, [backgroundId, currentUserId]);

  return {
    wallRuntimeState,
    isWallRuntimeStateReady,
  };
}
