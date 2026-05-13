export const isGrigliataFogDebugEnabled = () => {
  if (process.env.NODE_ENV === 'test') {
    return false;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  const explicitFlag = window.localStorage?.getItem('grigliataFogDebug');
  if (explicitFlag === '0' || explicitFlag === 'false') {
    return false;
  }
  if (explicitFlag === '1' || explicitFlag === 'true') {
    return true;
  }

  return process.env.NODE_ENV !== 'production';
};

export const logGrigliataFogDebug = (eventName, payload = {}) => {
  if (!isGrigliataFogDebugEnabled()) {
    return;
  }

  const logPayload = {
    at: new Date().toISOString(),
    ...payload,
  };
  let serializedPayload = '';
  try {
    serializedPayload = JSON.stringify(logPayload);
  } catch (error) {
    serializedPayload = JSON.stringify({
      at: logPayload.at,
      serializationError: error?.message || String(error),
    });
  }

  console.info(`[grigliata:fog:${eventName}] ${serializedPayload}`, logPayload);
};
