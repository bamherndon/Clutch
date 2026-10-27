import {
  HeartlandItemCreatedPayload,
  HeartlandItemCustomFields,
} from '../model/item';
import {
  UnknownRecord,
  getBoolean,
  getBooleanOrNull,
  getNumber,
  getNumberOrNull,
  getRecordOrNull,
  getString,
  getStringOrNull,
  isRecord,
} from './json';
import { ParseResult, parseError, parseOk } from './result';

/**
 * Parse an `item_created` webhook body, mapping Heartland's snake_case (and
 * its trailing-`?` boolean convention) onto camelCase.
 */
export function parseItemCreatedBody(
  body: string
): ParseResult<HeartlandItemCreatedPayload> {
  let raw: unknown;
  try {
    raw = JSON.parse(body) as unknown;
  } catch (err) {
    return parseError(`invalid JSON: ${String(err)}`);
  }

  if (!isRecord(raw)) {
    return parseError('payload is not an object');
  }

  const id = getNumber(raw, 'id');
  if (typeof id !== 'number') {
    return parseError('payload is missing a numeric id');
  }

  return parseOk({
    id,
    metadata: getRecordOrNull(raw, 'metadata'),
    cost: getNumberOrNull(raw, 'cost'),
    price: getNumberOrNull(raw, 'price'),
    description: getString(raw, 'description'),
    allowFractionalQty: getBoolean(raw, 'allow_fractional_qty?'),
    publicId: getString(raw, 'public_id'),
    defaultLookupId: getNumberOrNull(raw, 'default_lookup_id'),
    longDescription: getString(raw, 'long_description'),
    custom: parseCustomFields(raw.custom),
    active: getBoolean(raw, 'active?'),
    createdAt: getString(raw, 'created_at'),
    updatedAt: getString(raw, 'updated_at'),
    financialClassId: getNumberOrNull(raw, 'financial_class_id'),
    importBatchId: getNumberOrNull(raw, 'import_batch_id'),
    primaryVendorId: getNumberOrNull(raw, 'primary_vendor_id'),
    primaryBarcode: getStringOrNull(raw, 'primary_barcode'),
    gridId: getNumberOrNull(raw, 'grid_id'),
    originalPrice: getNumberOrNull(raw, 'original_price'),
    sortKey: getNumberOrNull(raw, 'sort_key'),
    metadataPrivate: getRecordOrNull(raw, 'metadata_private'),
    importSetId: getNumberOrNull(raw, 'import_set_id'),
    createdByUserId: getNumberOrNull(raw, 'created_by_user_id'),
    promptForPrice: getBoolean(raw, 'prompt_for_price?'),
    promptForDescription: getBoolean(raw, 'prompt_for_description?'),
    useDynamicMargin: getBoolean(raw, 'use_dynamic_margin?'),
    dynamicMargin: getNumberOrNull(raw, 'dynamic_margin'),
    updatedByUserId: getNumberOrNull(raw, 'updated_by_user_id'),
    weight: getNumberOrNull(raw, 'weight'),
    width: getNumberOrNull(raw, 'width'),
    height: getNumberOrNull(raw, 'height'),
    depth: getNumberOrNull(raw, 'depth'),
    trackInventory: getBoolean(raw, 'track_inventory?'),
    addOnForItemsMatchingFilter: getBoolean(
      raw,
      'add_on_for_items_matching_filter?'
    ),
    addOnItemFilter: getStringOrNull(raw, 'add_on_item_filter'),
    uuid: getString(raw, 'uuid'),
    primaryImageId: getNumberOrNull(raw, 'primary_image_id'),
    defaultPriceListId: getNumberOrNull(raw, 'default_price_list_id'),
    type: getString(raw, 'type'),
    availableOnline: getBoolean(raw, 'available_online?'),
    hasImages: getBooleanOrNull(raw, 'has_images?'),
    weightUnit: getStringOrNull(raw, 'weight_unit'),
    widthUnit: getStringOrNull(raw, 'width_unit'),
    heightUnit: getStringOrNull(raw, 'height_unit'),
    depthUnit: getStringOrNull(raw, 'depth_unit'),
    productType: getString(raw, 'product_type'),
  });
}

function parseCustomFields(
  value: unknown
): HeartlandItemCustomFields | null | undefined {
  if (value === null || value === undefined) {
    return value as null | undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const mapped: HeartlandItemCustomFields = {
    upc: getString(value, 'upc'),
    tags: getString(value, 'tags'),
    theme: getString(value, 'theme'),
    series: getString(value, 'series'),
    retired: getString(value, 'retired'),
    category: getString(value, 'category'),
    department: getString(value, 'department'),
    launchDate: getString(value, 'launch_date'),
    bamCategory: getString(value, 'bam_category'),
    bricklinkId: getString(value, 'bricklink_id'),
    taxCategory: getString(value, 'tax_category'),
    subDepartment: getString(value, 'sub_department'),
    retirementDate: getString(value, 'retirement_date'),
  };

  // Preserve any custom field we do not model explicitly.
  for (const [key, fieldValue] of Object.entries(value as UnknownRecord)) {
    if (!(key in mapped)) {
      mapped[key] = fieldValue;
    }
  }

  return mapped;
}
