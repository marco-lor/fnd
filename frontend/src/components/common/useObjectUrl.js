import { useEffect, useState } from 'react';
import { recordTask08Event } from '../../performance/task08';

const getDefaultUrlApi = () => (
  typeof URL !== 'undefined' ? URL : null
);

export const createObjectUrlLease = (file, {
  urlApi = getDefaultUrlApi(),
} = {}) => {
  if (!file) return { revoke: () => {}, url: '' };
  if (
    typeof urlApi?.createObjectURL !== 'function'
    || typeof urlApi?.revokeObjectURL !== 'function'
  ) {
    throw new Error('Object URL previews are not supported in this environment.');
  }
  const url = urlApi.createObjectURL(file);
  recordTask08Event({
    metric: 'media-object-url-create',
    tags: { kind: 'object-url' },
  });
  let active = true;
  return {
    url,
    revoke: () => {
      if (!active) return;
      active = false;
      urlApi.revokeObjectURL(url);
      recordTask08Event({
        metric: 'media-object-url-revoke',
        tags: { kind: 'object-url' },
      });
      recordTask08Event({
        metric: 'cleanup',
        tags: { kind: 'object-url' },
      });
    },
  };
};

export const withObjectUrl = async (file, operation, options) => {
  if (typeof operation !== 'function') {
    throw new TypeError('Object URL operation must be a function.');
  }
  const lease = createObjectUrlLease(file, options);
  try {
    return await operation(lease.url);
  } finally {
    lease.revoke();
  }
};

const useObjectUrl = (file) => {
  const [objectUrlState, setObjectUrlState] = useState({ file: null, url: '' });

  useEffect(() => {
    if (!file) return undefined;
    const lease = createObjectUrlLease(file);
    setObjectUrlState({ file, url: lease.url });
    return lease.revoke;
  }, [file]);

  // Effects run after render. Hide a previous file's URL during that small
  // handoff window so a stale preview cannot flash after replacement/clear.
  return objectUrlState.file === file ? objectUrlState.url : '';
};

export default useObjectUrl;
