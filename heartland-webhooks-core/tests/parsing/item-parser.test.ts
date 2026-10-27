import { parseItemCreatedBody } from '../../src/parsing/item-parser';

describe('parseItemCreatedBody', () => {
  it('maps snake_case and trailing-? fields to camelCase', () => {
    const result = parseItemCreatedBody(
      JSON.stringify({
        id: 101,
        public_id: 'SET-1234',
        long_description: 'A long description',
        'active?': true,
        'track_inventory?': false,
        'has_images?': null,
        primary_barcode: null,
        price: 12.5,
        product_type: 'inventory',
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.value;
    expect(item.id).toBe(101);
    expect(item.publicId).toBe('SET-1234');
    expect(item.longDescription).toBe('A long description');
    expect(item.active).toBe(true);
    expect(item.trackInventory).toBe(false);
    expect(item.productType).toBe('inventory');
    expect(item.price).toBe(12.5);
  });

  it('distinguishes an explicit null from an absent field', () => {
    const result = parseItemCreatedBody(
      JSON.stringify({ id: 1, primary_barcode: null })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.primaryBarcode).toBeNull();
    expect(result.value.gridId).toBeUndefined();
  });

  it('maps custom fields and preserves unmodelled ones', () => {
    const result = parseItemCreatedBody(
      JSON.stringify({
        id: 5,
        custom: {
          department: 'Minifigs',
          sub_department: 'New In Box',
          bricklink_id: 'sw0001a-1',
          bam_category: 'Star Wars',
          some_new_custom_field: 'kept',
        },
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const custom = result.value.custom;
    expect(custom?.department).toBe('Minifigs');
    expect(custom?.subDepartment).toBe('New In Box');
    expect(custom?.bricklinkId).toBe('sw0001a-1');
    expect(custom?.bamCategory).toBe('Star Wars');
    expect(custom?.some_new_custom_field).toBe('kept');
  });

  it('preserves a null custom object', () => {
    const result = parseItemCreatedBody(JSON.stringify({ id: 5, custom: null }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.custom).toBeNull();
  });

  it('ignores a non-object custom value', () => {
    const result = parseItemCreatedBody(
      JSON.stringify({ id: 5, custom: 'nope' })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.custom).toBeUndefined();
  });

  it('rejects invalid JSON and missing ids', () => {
    expect(parseItemCreatedBody('{oops').ok).toBe(false);
    expect(parseItemCreatedBody(JSON.stringify({ public_id: 'x' })).ok).toBe(
      false
    );
    expect(parseItemCreatedBody('"a string"').ok).toBe(false);
  });
});
