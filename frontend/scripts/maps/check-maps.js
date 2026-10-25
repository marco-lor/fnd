const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { modernTransfers, sourceModule, sha256, MAPS_DIRECTORY, MAPS, BUDGET_BYTES, DIVISORS, SETTINGS } = require('./generate-maps');

async function validateImage(directory, entry, width, height, format) {
  const bytes = await fs.readFile(path.join(directory, entry.file));
  assert.equal(bytes.length, entry.bytes, `Incorrect bytes: ${entry.file}`);
  assert.equal(sha256(bytes), entry.sha256, `Incorrect SHA256 hash: ${entry.file}`);
  assert.equal(entry.width, width, `Incorrect aspect/dimensions: ${entry.file}`);
  assert.equal(entry.height, height, `Incorrect aspect/dimensions: ${entry.file}`);
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, format === 'avif' ? 'heif' : format, `Incorrect format: ${entry.file}`);
  // Metadata alone accepts truncated images; force every pixel through the decoder.
  const decoded = await sharp(bytes, { failOn: 'warning' }).raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, width, `Decoded dimensions: ${entry.file}`);
  assert.equal(decoded.info.height, height, `Decoded dimensions: ${entry.file}`);
}

async function checkMaps({ mapsDirectory = MAPS_DIRECTORY, maps = MAPS, budgetBytes = BUDGET_BYTES } = {}) {
  const output = path.join(mapsDirectory, 'generated');
  const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1, 'Unknown map manifest schema');
  assert.equal(manifest.encoder.sharp, sharp.versions.sharp, 'Unexpected Sharp version; regenerate with pinned dependency');
  assert.deepEqual(manifest.encoder.settings, SETTINGS, 'Unexpected encoding settings');
  assert.deepEqual(Object.keys(manifest.maps).sort(), maps.map(({ id }) => id).sort(), 'Unexpected maps');
  for (const definition of maps) {
    const map = manifest.maps[definition.id];
    assert.equal(map.original.file, definition.file, 'Unexpected original master');
    if (definition.sha256) assert.equal(map.original.sha256, definition.sha256, 'Original master SHA256 changed');
    await validateImage(mapsDirectory, map.original, definition.width, definition.height, 'png');
    assert.deepEqual(Object.keys(map.variants).sort(), ['avif', 'webp'], 'Unexpected formats');
    for (const format of ['avif', 'webp']) {
      assert.equal(map.variants[format].length, 3, 'Missing responsive candidate');
      for (const [index, divisor] of DIVISORS.entries()) {
        const width = definition.width / divisor;
        const height = definition.height / divisor;
        const variant = map.variants[format][index];
        assert.equal(variant.file, `${definition.id}-${width}.${format}`, 'Unexpected variant filename');
        await validateImage(output, variant, width, height, format);
      }
    }
  }
  const transfers = modernTransfers(manifest);
  assert.ok(transfers.worstCaseBytes <= budgetBytes, `Cold modern map budget exceeded: ${transfers.worstCaseBytes} > ${budgetBytes}`);
  assert.deepEqual(manifest.coldModern, { budgetBytes, ...transfers }, 'Incorrect declared map byte budget');
  assert.equal(await fs.readFile(path.join(output, 'sources.js'), 'utf8'), sourceModule(manifest), 'Generated source URLs disagree with manifest');
  return { valid: true, ...transfers, budgetBytes };
}

if (require.main === module) checkMaps().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { checkMaps };
