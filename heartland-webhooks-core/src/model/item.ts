/**
 * Heartland custom item fields, camelCased from the snake_case the API sends.
 */
export interface HeartlandItemCustomFields {
  upc?: string;
  tags?: string;
  theme?: string;
  series?: string;
  retired?: string;
  category?: string;
  department?: string;
  launchDate?: string;
  bamCategory?: string;
  bricklinkId?: string;
  taxCategory?: string;
  subDepartment?: string;
  retirementDate?: string;
  [key: string]: unknown;
}

/**
 * Body of a Heartland `item_created` webhook, normalized to camelCase.
 */
export interface HeartlandItemCreatedPayload {
  id: number;
  metadata?: Record<string, unknown> | null;
  cost?: number | null;
  price?: number | null;
  description?: string;
  allowFractionalQty?: boolean;
  publicId?: string;
  defaultLookupId?: number | null;
  longDescription?: string;
  custom?: HeartlandItemCustomFields | null;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
  financialClassId?: number | null;
  importBatchId?: number | null;
  primaryVendorId?: number | null;
  primaryBarcode?: string | null;
  gridId?: number | null;
  originalPrice?: number | null;
  sortKey?: number | null;
  metadataPrivate?: Record<string, unknown> | null;
  importSetId?: number | null;
  createdByUserId?: number | null;
  promptForPrice?: boolean;
  promptForDescription?: boolean;
  useDynamicMargin?: boolean;
  dynamicMargin?: number | null;
  updatedByUserId?: number | null;
  weight?: number | null;
  width?: number | null;
  height?: number | null;
  depth?: number | null;
  trackInventory?: boolean;
  addOnForItemsMatchingFilter?: boolean;
  addOnItemFilter?: string | null;
  uuid?: string;
  primaryImageId?: number | null;
  defaultPriceListId?: number | null;
  type?: string;
  availableOnline?: boolean;
  hasImages?: boolean | null;
  weightUnit?: string | null;
  widthUnit?: string | null;
  heightUnit?: string | null;
  depthUnit?: string | null;
  productType?: string;
  [key: string]: unknown;
}
