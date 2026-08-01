import { withTask07CatalogLegacyImageField } from './catalogItemMediaWriter';

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
});
