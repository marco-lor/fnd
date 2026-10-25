const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const { generateMaps } = require('./generate-maps');
const { checkMaps } = require('./check-maps');

const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const maps = [{ id: 'art', file: 'mappa_art.png', width: 64, height: 32 }, { id: 'precisa', file: 'mappa_precisa.png', width: 80, height: 32 }];

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'echi-maps-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const map of maps) {
    // A dark perimeter and colored quadrants reveal a resize that crops edges.
    const pixels = Buffer.alloc(map.width * map.height * 3);
    for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) {
      const border = x < map.width / 8 || x >= map.width * 7 / 8 || y < map.height / 8 || y >= map.height * 7 / 8;
      const color = border ? [12, 12, 12] : y < map.height / 2
        ? x < map.width / 2 ? [220, 25, 25] : [25, 220, 25]
        : x < map.width / 2 ? [25, 25, 220] : [220, 190, 25];
      pixels.set(color, (y * map.width + x) * 3);
    }
    await sharp(pixels, { raw: { width: map.width, height: map.height, channels: 3 } }).png().toFile(path.join(directory, map.file));
  }
  const options = { mapsDirectory: directory, maps, budgetBytes: 10000 };
  return { directory, options, generated: path.join(directory, 'generated') };
}

test('generation preserves complete exact-ratio quarter/half/full images and is deterministic', async (t) => {
  const { directory, options, generated } = await fixture(t);
  const manifest = await generateMaps(options);
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.maps.art.variants.avif.map(({ width, height }) => [width, height]), [[16, 8], [32, 16], [64, 32]]);
  assert.deepEqual(manifest.maps.precisa.variants.webp.map(({ width, height }) => [width, height]), [[20, 8], [40, 16], [80, 32]]);
  for (const definition of maps) {
    const original = await fs.readFile(path.join(directory, definition.file));
    assert.equal(manifest.maps[definition.id].original.sha256, hash(original));
    for (const format of ['avif', 'webp']) for (const variant of manifest.maps[definition.id].variants[format]) {
      const bytes = await fs.readFile(path.join(generated, variant.file));
      assert.equal(variant.bytes, bytes.length);
      assert.equal(variant.sha256, hash(bytes));
      const decoded = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
      assert.equal(decoded.info.width * definition.height, decoded.info.height * definition.width);
      const sample = (x, y) => [...decoded.data.subarray((y * variant.width + x) * 3, (y * variant.width + x) * 3 + 3)];
      for (const channel of sample(0, 0)) assert.ok(Math.abs(channel - 12) < 30, 'top-left perimeter was cropped');
      for (const channel of sample(variant.width - 1, variant.height - 1)) assert.ok(Math.abs(channel - 12) < 30, 'bottom-right perimeter was cropped');
      const redQuadrant = sample(Math.floor(variant.width / 4), Math.floor(variant.height / 4));
      assert.ok(redQuadrant[0] > 180 && redQuadrant[1] < 65 && redQuadrant[2] < 65, 'map content moved or was cropped');
    }
  }
  assert.deepEqual(await generateMaps(options), manifest);
  assert.equal((await checkMaps(options)).valid, true);
});

test('check rejects a missing or tampered variant and incorrect recorded byte count', async (t) => {
  const { options, generated } = await fixture(t);
  const manifest = await generateMaps(options);
  const variant = manifest.maps.art.variants.webp[0];
  const file = path.join(generated, variant.file);
  const valid = await fs.readFile(file);
  await fs.rm(file);
  await assert.rejects(checkMaps(options), /missing|ENOENT/i);
  await fs.writeFile(file, Buffer.from('not an image'));
  await assert.rejects(checkMaps(options), /bytes|hash|decode/i);
  await fs.writeFile(file, valid);
  variant.bytes += 1;
  await fs.writeFile(path.join(generated, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(checkMaps(options), /bytes/i);
});

test('check decodes files and rejects wrong aspect ratio even with matching bytes and hash', async (t) => {
  const { options, generated } = await fixture(t);
  const manifest = await generateMaps(options);
  const variant = manifest.maps.art.variants.webp[0];
  const bytes = await sharp({ create: { width: 16, height: 9, channels: 3, background: '#795f39' } }).webp().toBuffer();
  await fs.writeFile(path.join(generated, variant.file), bytes);
  Object.assign(variant, { width: 16, height: 9, bytes: bytes.length, sha256: hash(bytes) });
  await fs.writeFile(path.join(generated, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(checkMaps(options), /aspect|dimensions/i);
});

test('check rejects undecodable content even when integrity metadata agrees', async (t) => {
  const { options, generated } = await fixture(t);
  const manifest = await generateMaps(options);
  const variant = manifest.maps.art.variants.webp[0];
  const bytes = Buffer.from('not a webp');
  await fs.writeFile(path.join(generated, variant.file), bytes);
  Object.assign(variant, { bytes: bytes.length, sha256: hash(bytes) });
  await fs.writeFile(path.join(generated, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(checkMaps(options), /decode|unsupported|corrupt/i);
});

test('check enforces the cold modern budget for either format and validates original masters', async (t) => {
  const { directory, options } = await fixture(t);
  await generateMaps(options);
  await assert.rejects(checkMaps({ ...options, budgetBytes: 1 }), /budget/i);
  await fs.appendFile(path.join(directory, 'mappa_art.png'), 'tampered');
  await assert.rejects(checkMaps(options), /original|master|bytes|hash/i);
});
