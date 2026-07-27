import { useEffect, useRef } from 'react';
import { createTask07MediaOperationOwner } from './mediaOperationOwner';

const ensureTask07MediaOperationOwner = (ownerRef) => {
  if (!ownerRef.current || ownerRef.current.isDisposed()) {
    ownerRef.current = createTask07MediaOperationOwner();
  }
  return ownerRef.current;
};

/**
 * Keeps Task 07 upload cancellation scoped to one mounted component. The
 * facade remains stable across React StrictMode's effect cleanup/replay while
 * each real unmount still disposes the underlying owner.
 */
const useTask07MediaOperationOwner = () => {
  const ownerRef = useRef(null);
  const facadeRef = useRef(null);

  if (!facadeRef.current) {
    facadeRef.current = Object.freeze({
      start: (reason) => ensureTask07MediaOperationOwner(ownerRef).start(reason),
      run: async (callback, reason) => {
        if (typeof callback !== 'function') {
          throw new TypeError('Task 07 media owner run requires a callback.');
        }
        const lease = ensureTask07MediaOperationOwner(ownerRef).start(reason);
        try {
          return await callback(lease.signal);
        } finally {
          lease.release();
        }
      },
      cancel: (reason) => ownerRef.current?.cancel(reason) || false,
    });
  }

  useEffect(() => {
    const owner = ensureTask07MediaOperationOwner(ownerRef);
    return () => {
      owner.dispose('Task 07 media owner was unmounted.');
      if (ownerRef.current === owner) ownerRef.current = null;
    };
  }, []);

  return facadeRef.current;
};

export default useTask07MediaOperationOwner;
