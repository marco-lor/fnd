const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const canonicalize = (value, inArray = false) => {
  if (value === undefined) return inArray ? { $type: 'undefined' } : undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { $type: 'number', value: 'NaN' };
    if (value === Number.POSITIVE_INFINITY) return { $type: 'number', value: 'Infinity' };
    if (value === Number.NEGATIVE_INFINITY) return { $type: 'number', value: '-Infinity' };
    if (Object.is(value, -0)) return { $type: 'number', value: '-0' };
    return value;
  }
  if (typeof value === 'bigint') return { $type: 'integer', value: value.toString() };
  if (value instanceof Date) return { $type: 'timestamp', value: value.toISOString() };
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry, true));
  if (!isRecord(value)) return {};
  if (typeof value.toDate === 'function' && Number.isFinite(value.seconds)) {
    return {
      $type: 'timestamp',
      seconds: String(value.seconds),
      nanoseconds: Number(value.nanoseconds || 0),
    };
  }
  if (typeof value.path === 'string' && value.firestore) {
    return { $type: 'reference', path: value.path };
  }
  if (Number.isFinite(value.latitude) && Number.isFinite(value.longitude)) {
    return { $type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  }
  return Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, canonicalize(value[key])])
    .filter(([, entry]) => entry !== undefined));
};

export const stableDataJson = (value) => (
  JSON.stringify(canonicalize(value)) ?? '{"$type":"undefined"}'
);
