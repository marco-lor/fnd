import fs from 'fs';
import path from 'path';

const COMPONENT_ROOT = path.join(process.cwd(), 'src', 'components');
const DIRECT_MEDIA_TAG = /<(?:img|video)\b/;

const persistedConsumers = [
  'bazaar/elements/addAccessorio.js',
  'bazaar/elements/addArmatura.js',
  'bazaar/elements/addConsumabile.js',
  'bazaar/elements/addWeapon.js',
  'bazaar/elements/comparisonComponent.js',
  'common/SpellOverlay.js',
  'dmDashboard/elements/buttons/addTecnicaPersonale.js',
  'dmDashboard/elements/buttons/editTecnicaPersonale.js',
  'dmDashboard/elements/playerInfo/overlays/EditVarieItemOverlay.js',
  'echiDiViaggio/EquippedInventory.js',
  'home/elements/EquippedInventory.js',
  'tecnicheSpell/elements/personalMediaEditor.js',
  'tecnicheSpell/elements/tecniche_side.js',
].filter((relativePath) => fs.existsSync(path.join(COMPONENT_ROOT, relativePath)));

const directTagAllowlist = new Set([
  // The wrappers are the only code allowed to attach resolved sources to DOM tags.
  'common/MediaImage.js',
  'common/MediaVideo.js',

  // These tags render imported assets or object URLs created from a selected File.
  'dmDashboard/elements/playerInfo/overlays/AddVarieItemOverlay.js',
  'echiDiViaggio/EchiDiViaggio.js',
  'echiDiViaggio/NpcSidebar.js',
  'home/elements/Inventory.js',

  // Concurrently owned consumers are tracked here until their owner converts them.
  'characterCreation/elements/CharacterDetails.js',
  'home/elements/ItemDetailsModal.js',
  'tecnicheSpell/elements/spell_side.js',
]);

const collectJavaScriptFiles = (directory) => fs.readdirSync(
  directory,
  { withFileTypes: true },
).flatMap((entry) => {
  const absolutePath = path.join(directory, entry.name);
  if (entry.isDirectory()) return collectJavaScriptFiles(absolutePath);
  if (!entry.isFile() || !entry.name.endsWith('.js') || entry.name.endsWith('.test.js')) {
    return [];
  }
  return [absolutePath];
});

const relativeComponentPath = (absolutePath) => (
  path.relative(COMPONENT_ROOT, absolutePath).replace(/\\/g, '/')
);

describe('Task 07 persisted media consumer boundary', () => {
  test.each(persistedConsumers)(
    '%s does not bypass MediaImage or MediaVideo',
    (relativePath) => {
      const source = fs.readFileSync(
        path.join(COMPONENT_ROOT, relativePath),
        'utf8',
      );
      expect(source).not.toMatch(DIRECT_MEDIA_TAG);
    },
  );

  test('every remaining direct DOM media tag has an explicit local or owned exception', () => {
    const unclassified = collectJavaScriptFiles(COMPONENT_ROOT)
      .filter((absolutePath) => DIRECT_MEDIA_TAG.test(fs.readFileSync(absolutePath, 'utf8')))
      .map(relativeComponentPath)
      .filter((relativePath) => !directTagAllowlist.has(relativePath));

    expect(unclassified).toEqual([]);
  });

  test('allowlisted editor previews remain local File object URLs', () => {
    const expectedObjectUrlBindings = [
      ['dmDashboard/elements/playerInfo/overlays/AddVarieItemOverlay.js', 'const previewUrl = useObjectUrl(imageFile);'],
      ['echiDiViaggio/NpcSidebar.js', 'const createImagePreviewUrl = useObjectUrl(createImageFile);'],
      ['echiDiViaggio/NpcSidebar.js', 'const editImagePreviewUrl = useObjectUrl(editImageFile);'],
      ['home/elements/Inventory.js', 'const vImagePreviewUrl = useObjectUrl(vImageFile);'],
    ];

    expectedObjectUrlBindings.forEach(([relativePath, binding]) => {
      const source = fs.readFileSync(
        path.join(COMPONENT_ROOT, relativePath),
        'utf8',
      );
      expect(source).toContain(binding);
    });
  });
});
