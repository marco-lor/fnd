import { useEffect, useState } from 'react';
import {
  doc,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import {
  buildGrigliataFogOfWarDocId,
  GRIGLIATA_FOG_OF_WAR_COLLECTION,
  normalizeGrigliataFogOfWarDoc,
} from './fogOfWar';

export default function useGrigliataFogOfWar({
  backgroundId = '',
  currentUserId = '',
  isManager = false,
}) {
  const [fogOfWar, setFogOfWar] = useState(null);
  const [isFogOfWarReady, setIsFogOfWarReady] = useState(false);

  useEffect(() => {
    const fogDocId = buildGrigliataFogOfWarDocId(backgroundId, currentUserId);

    if (!fogDocId || isManager) {
      setFogOfWar(null);
      setIsFogOfWarReady(false);
      return undefined;
    }

    setIsFogOfWarReady(false);

    const unsubscribe = onSnapshot(
      doc(db, GRIGLIATA_FOG_OF_WAR_COLLECTION, fogDocId),
      (snapshot) => {
        setFogOfWar(snapshot.exists()
          ? normalizeGrigliataFogOfWarDoc({
            id: snapshot.id,
            ...snapshot.data(),
          })
          : null);
        setIsFogOfWarReady(true);
      },
      (error) => {
        console.error('Failed to load Grigliata fog of war:', error);
        setFogOfWar(null);
        setIsFogOfWarReady(true);
      }
    );

    return () => unsubscribe();
  }, [backgroundId, currentUserId, isManager]);

  return {
    fogOfWar,
    isFogOfWarReady,
  };
}
