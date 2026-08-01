import { useEffect, useState } from 'react';
import { useOptionalAuth } from '../../AuthContext';
import {
  loadTask07MediaMode,
  TASK07_MEDIA_MODES,
  TASK07_MEDIA_PENDING_MODE,
} from './task07MediaControl';

const EXPLICIT_MODE_SET = new Set([
  ...TASK07_MEDIA_MODES,
  TASK07_MEDIA_PENDING_MODE,
]);

export const TASK07_MEDIA_CONTROL_RETRY_MS = 1000;
const normalizeActorValue = (value) => (
  typeof value === 'string' ? value.trim() : ''
);

/**
 * Resolves the actor- and purpose-scoped Task 07 reader mode. Until the
 * server-owned control document is available, readers expose a non-fetching
 * pending state. The underlying config repository shares the physical read
 * across every mounted media instance and invalidates it on auth transitions.
 */
export const useTask07MediaReadMode = ({
  override = 'auto',
  purpose = '',
} = {}) => {
  const auth = useOptionalAuth();
  const explicitMode = EXPLICIT_MODE_SET.has(override)
    ? override
    : (override === 'auto' ? null : 'legacy');
  const uid = normalizeActorValue(auth?.user?.uid);
  const role = normalizeActorValue(auth?.userData?.role).toLowerCase();
  const normalizedPurpose = normalizeActorValue(purpose);
  const resolutionKey = [uid, role, normalizedPurpose].join('\u0000');
  const [resolved, setResolved] = useState({
    key: '',
    mode: TASK07_MEDIA_PENDING_MODE,
  });
  const [retryGeneration, setRetryGeneration] = useState(0);

  useEffect(() => {
    if (explicitMode || !uid || !role) return undefined;

    let cancelled = false;
    let retryTimer = null;
    loadTask07MediaMode({
      purpose: normalizedPurpose,
      role,
      uid,
    }).then((mode) => {
      if (!cancelled) {
        setResolved({key: resolutionKey, mode});
      }
    }).catch(() => {
      if (!cancelled) {
        setResolved({
          key: resolutionKey,
          mode: TASK07_MEDIA_PENDING_MODE,
        });
        retryTimer = setTimeout(() => {
          if (!cancelled) {
            setRetryGeneration((generation) => generation + 1);
          }
        }, TASK07_MEDIA_CONTROL_RETRY_MS);
      }
    });

    return () => {
      cancelled = true;
      if (retryTimer != null) clearTimeout(retryTimer);
    };
  }, [explicitMode, normalizedPurpose, resolutionKey, retryGeneration, role, uid]);

  if (explicitMode) return explicitMode;
  if (!uid) return 'legacy';
  if (!role) return TASK07_MEDIA_PENDING_MODE;
  return resolved.key === resolutionKey
    ? resolved.mode
    : TASK07_MEDIA_PENDING_MODE;
};

export default useTask07MediaReadMode;
