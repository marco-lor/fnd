const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const rotateRight = (value, bits) => (value >>> bits) | (value << (32 - bits));

export const sha256Hex = (source) => {
  const encoded = [];
  for (const character of source) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x7f) encoded.push(codePoint);
    else if (codePoint <= 0x7ff) {
      encoded.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      encoded.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    } else {
      encoded.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  const bytes = Uint8Array.from(encoded);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const hash = [...SHA256_INITIAL];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + (index * 4), false);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15];
      const right = words[index - 2];
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    [a, b, c, d, e, f, g, h].forEach((value, index) => {
      hash[index] = (hash[index] + value) >>> 0;
    });
  }
  return hash.map((value) => value.toString(16).padStart(8, '0')).join('');
};

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

export const stableUserDataJson = (value) => (
  JSON.stringify(canonicalize(value)) ?? '{"$type":"undefined"}'
);

const validInstanceId = (value) => (
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value.trim())
    ? value.trim()
    : ''
);

const entrySnapshot = (rawEntry) => {
  const snapshot = isRecord(rawEntry)
    ? { ...rawEntry }
    : { id: String(rawEntry || '').trim(), name: String(rawEntry || '').trim() };
  delete snapshot._instance;
  delete snapshot._task05;
  delete snapshot.qty;
  delete snapshot.quantity;
  return snapshot;
};

const entryQuantity = (entry) => {
  const quantity = Number(entry?.qty ?? entry?.quantity ?? 1);
  return Number.isFinite(quantity) ? Math.max(1, Math.trunc(quantity)) : 1;
};

export const buildLegacyInventoryBindings = (inventory) => {
  const occurrences = new Map();
  const usedIds = new Set();
  const bindings = [];
  (Array.isArray(inventory) ? inventory : []).forEach((rawEntry, legacyIndex) => {
    const snapshot = entrySnapshot(rawEntry);
    const fingerprint = sha256Hex(stableUserDataJson(snapshot));
    const occurrence = occurrences.get(fingerprint) || 0;
    occurrences.set(fingerprint, occurrence + 1);
    const kind = String(snapshot.type ?? snapshot.item_type ?? 'legacy').trim().toLowerCase() || 'legacy';
    const quantity = entryQuantity(rawEntry);
    const units = kind === 'varie' ? 1 : quantity;
    const requestedId = validInstanceId(rawEntry?._instance?.instanceId);
    for (let unit = 0; unit < units; unit += 1) {
      const preferred = requestedId
        ? (unit === 0 ? requestedId : `${requestedId}_${unit + 1}`)
        : `legacy_${fingerprint.slice(0, 24)}_${occurrence + 1}_${unit + 1}`;
      let inventoryId = preferred;
      let collision = 1;
      while (usedIds.has(inventoryId)) {
        collision += 1;
        inventoryId = `legacy_${fingerprint.slice(0, 24)}_${occurrence + 1}_${unit + 1}_${collision}`;
      }
      usedIds.add(inventoryId);
      bindings.push({
        inventoryId,
        legacyIndex,
        unit,
        kind,
        quantity: kind === 'varie' ? quantity : 1,
        snapshot,
        rawEntry,
      });
    }
  });
  return bindings;
};

export const normalizeLegacyInventoryWithStableIds = (inventory) => (
  buildLegacyInventoryBindings(inventory).map((binding) => {
    const source = isRecord(binding.rawEntry)
      ? binding.rawEntry
      : { id: binding.snapshot.id, name: binding.snapshot.name };
    return {
      ...source,
      qty: binding.quantity,
      _instance: {
        ...(isRecord(source._instance) ? source._instance : {}),
        instanceId: binding.inventoryId,
      },
      _task05: {
        inventoryId: binding.inventoryId,
        legacyIndex: binding.legacyIndex,
        legacyUnit: binding.unit,
      },
    };
  })
);
