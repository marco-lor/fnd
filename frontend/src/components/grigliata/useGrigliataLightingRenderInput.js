import { useEffect, useState } from 'react';
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
  const [lightingRenderInput, setLightingRenderInput] = useState(null);
  const [isLightingRenderInputReady, setIsLightingRenderInputReady] = useState(false);

  useEffect(() => {
    if (!currentUserId || !backgroundId) {
      setLightingRenderInput(null);
      setIsLightingRenderInputReady(false);
      return undefined;
    }

    setIsLightingRenderInputReady(false);

    const unsubscribe = onSnapshot(
      doc(db, GRIGLIATA_LIGHTING_RENDER_INPUT_COLLECTION, backgroundId),
      (snapshot) => {
        setLightingRenderInput(snapshot.exists()
          ? normalizeGrigliataLightingRenderInput({
            backgroundId: snapshot.id,
            ...snapshot.data(),
          })
          : null);
        setIsLightingRenderInputReady(true);
      },
      (error) => {
        console.error('Failed to load Grigliata lighting render input:', error);
        setLightingRenderInput(null);
        setIsLightingRenderInputReady(true);
      }
    );

    return () => unsubscribe();
  }, [backgroundId, currentUserId]);

  return {
    lightingRenderInput,
    isLightingRenderInputReady,
  };
}
