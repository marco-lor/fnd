const {spawnSync} = require('node:child_process');

const focusedTestNames = [
  'GlobalAuroraBackground.test.js',
  'legacyMediaStorage.test.js',
  'MediaImage.test.js',
  'MediaVideo.test.js',
  'SpellOverlay.test.js',
  'privateMediaAssets.test.js',
  'useObjectUrl.test.js',
  'userOwnedMedia.test.js',
  'GlobalGrigliataMusicPlayer.test.js',
  'GrigliataBoard.test.js',
  'BackgroundGalleryOrganizerOverlay.test.js',
  'BackgroundGalleryPanel.test.js',
  'NarrationPlacementPicker.test.js',
  'imageAssetRegistry.test.js',
  'catalogItemMedia.test.js',
  'catalogItemMediaWriter.test.js',
  'characterCreationAvatarMedia.test.js',
  'customTokenMedia.test.js',
  'configRepository.test.js',
  'backendOperationIntentStore.test.js',
  'callableRegistry.test.js',
  'foeMediaLifecycle.test.js',
  'foeMediaRetirement.test.js',
  'FoeEntryEditors.test.js',
  'FoeFormModal.test.js',
  'embeddedMedia.test.js',
  'embeddedMediaRetry.test.js',
  'mediaConsumerAdapter.test.js',
  'mediaFeatureFlags.test.js',
  'mediaPipeline.test.js',
  'mediaPolicy.test.js',
  'mediaUpload.test.js',
  'mediaWriterAdapter.test.js',
  'personalMediaWriter.test.js',
  'privateInventoryMediaWriter.test.js',
  'task07MediaControl.test.js',
  'useTask07MediaOperationOwner.test.js',
  'useTask07MediaReadMode.test.js',
];

const reactScripts = require.resolve('react-scripts/bin/react-scripts.js');
const result = spawnSync(process.execPath, [
  reactScripts,
  'test',
  '--watch=false',
  '--runInBand',
  '--watchman=false',
  `--testPathPattern=${focusedTestNames.join('|')}`,
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CI: process.env.CI || 'true',
  },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = Number.isInteger(result.status) ? result.status : 1;
