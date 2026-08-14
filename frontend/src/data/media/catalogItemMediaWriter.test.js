import {
  prepareTask07CatalogEmbeddedSpells,
  retireTask07CatalogItemImage,
  task07CatalogEmbeddedSpellEditorState,
  task07CatalogItemImageEditorState,
  withTask07CatalogLegacyImageField,
} from './catalogItemMediaWriter';

describe('Task 07 catalog item preparation', () => {
  test('omits image_url from a canonical create instead of storing null', () => {
    const prepared = withTask07CatalogLegacyImageField({
      item_type: 'weapon',
      General: {Nome: 'Strict blade', image_url: null},
    }, {
      editMode: false,
      imageUrl: null,
      task07V1Write: true,
    });

    expect(prepared.General).not.toHaveProperty('image_url');
  });

  test('preserves legacy write semantics outside a canonical create', () => {
    expect(withTask07CatalogLegacyImageField({General: {Nome: 'Legacy'}}, {
      editMode: false,
      imageUrl: null,
      task07V1Write: false,
    }).General).toHaveProperty('image_url', null);
    expect(withTask07CatalogLegacyImageField({General: {Nome: 'Edited'}}, {
      editMode: true,
      imageUrl: 'https://legacy.example/item.png',
      task07V1Write: true,
    }).General).toHaveProperty(
      'image_url',
      'https://legacy.example/item.png'
    );
  });

  test('does not mutate the caller-owned form object', () => {
    const source = {General: {Nome: 'Source', image_url: null}};
    withTask07CatalogLegacyImageField(source, {
      task07V1Write: true,
    });
    expect(source.General).toHaveProperty('image_url', null);
  });

  test('canonical-only General.media remains visible and explicitly removable',
    async () => {
      const assetId = `m_${'c'.repeat(40)}`;
      const currentItem = {
        task07MediaRevision: 4,
        General: {
          Nome: 'Canonical item',
          media: {
            assetId,
            variants: {thumbnail: {path: 'canonical/thumb'}},
          },
        },
      };
      expect(task07CatalogItemImageEditorState(currentItem)).toMatchObject({
        assetId,
        compatibilityMode: 'auto',
        hasImage: true,
        media: currentItem,
        src: null,
      });
      expect(task07CatalogItemImageEditorState(currentItem, {removed: true}))
        .toMatchObject({assetId, hasImage: false, src: null});

      const retire = jest.fn().mockResolvedValue({state: 'superseded'});
      await expect(retireTask07CatalogItemImage(currentItem, {retire}))
        .resolves.toMatchObject({assetId, handled: true, status: 'retired'});
      expect(retire).toHaveBeenCalledWith(assetId);
    });

  test('catalog retirement reconciles an idempotent superseded response',
    async () => {
      const assetId = `m_${'d'.repeat(40)}`;
      const failure = new Error('already retired');
      await expect(retireTask07CatalogItemImage({media: {assetId}}, {
        retire: jest.fn().mockRejectedValue(failure),
        getStatus: jest.fn().mockResolvedValue({
          assetId,
          attached: false,
          state: 'superseded',
        }),
      })).resolves.toMatchObject({assetId, handled: true, status: 'retired'});
    });

  test('reopen and unchanged save preserves canonical embedded spell media',
    async () => {
      const imageAssetId = `m_${'a'.repeat(40)}`;
      const videoAssetId = `m_${'b'.repeat(40)}`;
      const currentItem = {
        General: {spells: {Shield: {
          Nome: 'Shield',
          task07MediaEntryId: 'shield-entry',
        }}},
        task07EmbeddedMedia: {
          'shield-entry': {
            targetKind: 'catalog-item-spell',
            media: {assetId: imageAssetId},
            videoMedia: {assetId: videoAssetId},
            task07MediaRevision: 1,
            task07VideoMediaRevision: 1,
          },
        },
      };
      const editor = task07CatalogEmbeddedSpellEditorState(currentItem);
      expect(editor.customSpells).toHaveLength(1);
      expect(editor.customSpells[0].spellData.media.assetId)
        .toBe(imageAssetId);
      expect(editor.customSpells[0].spellData.videoMedia.assetId)
        .toBe(videoAssetId);

      const unchanged = await prepareTask07CatalogEmbeddedSpells({
        actorUid: 'dm-a',
        role: 'dm',
        itemId: 'item-a',
        currentItem,
        customSpells: editor.customSpells,
      });
      expect(unchanged.operations).toEqual([]);
      expect(unchanged.spells.Shield).not.toHaveProperty('media');
      expect(unchanged.spells.Shield).not.toHaveProperty('videoMedia');
      expect(unchanged.spells.Shield.task07MediaEntryId)
        .toBe('shield-entry');

      const removed = await prepareTask07CatalogEmbeddedSpells({
        actorUid: 'dm-a',
        role: 'dm',
        itemId: 'item-a',
        currentItem,
        customSpells: [{
          ...editor.customSpells[0],
          imageRemoved: true,
          videoRemoved: true,
        }],
      });
      expect(removed.operations).toEqual([
        {action: 'retire', assetId: imageAssetId},
        {action: 'retire', assetId: videoAssetId},
      ]);
    });

  test('delete and re-add with the same name never inherits the old binding',
    async () => {
      const oldAssetId = `m_${'e'.repeat(40)}`;
      const currentItem = {
        General: {spells: {Shield: {
          Nome: 'Shield',
          task07MediaEntryId: 'old-shield-entry',
        }}},
        task07EmbeddedMedia: {
          'old-shield-entry': {
            targetKind: 'catalog-item-spell',
            media: {assetId: oldAssetId},
            task07MediaRevision: 1,
          },
        },
      };
      const replacement = await prepareTask07CatalogEmbeddedSpells({
        actorUid: 'dm-a',
        role: 'dm',
        itemId: 'item-a',
        currentItem,
        customSpells: [{
          spellData: {
            Nome: 'Shield',
            task07MediaEntryId: 'new-shield-entry',
          },
        }],
      });

      expect(replacement.spells.Shield).toEqual({
        Nome: 'Shield',
        task07MediaEntryId: 'new-shield-entry',
      });
      expect(replacement.spells.Shield).not.toHaveProperty('media');
      expect(replacement.operations).toEqual([
        {action: 'retire', assetId: oldAssetId},
      ]);
    });
});
