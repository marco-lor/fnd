const METRIC_KEY_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){2,}\.v[1-9][0-9]*$/;

/**
 * Stable Firestore telemetry keys are public, low-cardinality identifiers.
 * Runtime values belong in private repository instance keys, never here.
 *
 * @param {unknown} metricKey
 * @returns {string}
 */
export const assertFirestoreMetricKey = (metricKey) => {
  if (typeof metricKey !== 'string' || !METRIC_KEY_PATTERN.test(metricKey)) {
    throw new TypeError(
      'Firestore metric keys must use <domain>.<resource>.<operation>.vN with lowercase static segments.'
    );
  }
  return metricKey;
};

export const isFirestoreMetricKey = (metricKey) => (
  typeof metricKey === 'string' && METRIC_KEY_PATTERN.test(metricKey)
);

