import { useEffect, useState } from 'react';
import { useOptionalAuth } from '../../AuthContext';
import {
  loadTask07MediaMode,
  TASK07_MEDIA_MODES,
} from './task07MediaControl';

const EXPLICIT_MODE_SET = new Set(TASK07_MEDIA_MODES);

const normalizeActorValue = (value) => (
  typeof value === 'string' ? value.trim() : ''
);

/**
 * Resolves the actor- and purpose-scoped Task 07 reader mode. Until the
 * server-owned control document is available, readers stay on the legacy
 * source. The underlying config repository shares the physical read across
 * every mounted media instance and invalidates it on auth transitions.
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
    mode: 'legacy',
  });

  useEffect(() => {
    if (explicitMode || !uid || !role || !normalizedPurpose) return undefined;

    let cancelled = false;
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
        setResolved({key: resolutionKey, mode: 'legacy'});
      }
    });

    return () => {
      cancelled = true;
    };
  }, [explicitMode, normalizedPurpose, resolutionKey, role, uid]);

  if (explicitMode) return explicitMode;
  if (!uid || !role || !normalizedPurpose) return 'legacy';
  return resolved.key === resolutionKey ? resolved.mode : 'legacy';
};

export default useTask07MediaReadMode;
