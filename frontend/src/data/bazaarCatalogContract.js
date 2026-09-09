/**
 * Task 09A's semantic oracle.
 *
 * This module deliberately has no Firestore or React dependency.  It records
 * the result contract that the summary/query reader (09B) must preserve while
 * keeping the current Bazaar reader in place for 09A.
 */

export const BAZAAR_QUERY_CONTRACT_VERSION = 1;
export const BAZAAR_PAGE_SIZE = 50;
export const BAZAAR_SEARCH_DEBOUNCE_MS = 150;

export const BAZAAR_INITIAL_QUERY_CONTRACT = Object.freeze({
  pageSize: BAZAAR_PAGE_SIZE,
  realtime: 'first-page-only',
  order: Object.freeze([
    Object.freeze({ field: 'normalizedName', direction: 'asc' }),
    Object.freeze({ field: '__name__', direction: 'asc' }),
  ]),
  clientTruncation: false,
  summaryOnly: true,
});

export const BAZAAR_ADVANCED_QUERY_CONTRACT = Object.freeze({
  completeness: 'actor-visible-full-catalog',
  arbitrarySubstringSearch: true,
  arbitraryCombinedFacets: true,
  summedSelectedLevel1Sort: true,
  clientTruncation: false,
  evaluation: 'server-authoritative-search-snapshot',
});

export const BAZAAR_PRICE_CONTRACT = Object.freeze({
  mode: 'server-authoritative-current-price',
  clientFacts: Object.freeze(['itemId', 'operationId']),
  expectedPriceAccepted: false,
  versionRejection: false,
  serverReadsCatalogInTransaction: true,
  displayedPriceMayBeStale: true,
});

const asTrimmedString = (value) => (value == null ? '' : String(value).trim());

export const normalizeFilterArray = (value) => {
  if (!Array.isArray(value)) return ['All'];

  const normalized = Array.from(new Set(
    value
      .filter((entry) => entry != null)
      .map((entry) => String(entry).trim())
      .filter(Boolean)
  ));

  return normalized.length === 0 || normalized.includes('All')
    ? ['All']
    : normalized;
};

export const isMeaningfulSpecialValue = (value) => {
  if (Array.isArray(value)) return value.some(isMeaningfulSpecialValue);
  if (value && typeof value === 'object') {
    return Object.values(value).some(isMeaningfulSpecialValue);
  }
  if (typeof value === 'number') return !Number.isNaN(value);
  if (typeof value === 'boolean') return value;
  return value != null && String(value).trim() !== '';
};

export const isCatalogItemShape = (item) => Boolean(
  item
  && item.item_type
  && item.General
  && item.Specific
  && item.Parametri
  && !String(item.id || '').startsWith('schema_')
);

export const isBazaarItemVisibleToActor = (item, actor = {}) => {
  if (!isCatalogItemShape(item) || !actor?.uid) return false;

  // The production Bazaar deliberately gives unrestricted catalog scope only
  // to the exact `dm` role.  A webmaster is an editor, not a DM query actor.
  if (actor.role === 'dm') return true;

  return item.visibility === 'all'
    || (item.visibility === 'custom' && Array.isArray(item.allowed_users)
      && item.allowed_users.includes(actor.uid));
};

const selected = (values, candidate) => (
  normalizeFilterArray(values).includes('All')
  || normalizeFilterArray(values).includes(candidate)
);

const parsePrice = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};

/**
 * The current Bazaar reader uses only General.prezzo for card/filter price.
 * General.Costo remains part of the legacy item shape and is preserved by the
 * projection, but it is not silently substituted for prezzo by this oracle.
 */
export const getBazaarDisplayedPrice = (item) => {
  const rawPrice = item?.General?.prezzo ?? 0;
  return parsePrice(rawPrice);
};

export const getBazaarLegacyCost = (item) => parsePrice(item?.General?.Costo ?? 0);

const getLevelOneValue = (item, group, parameter) => {
  const parameterData = item?.Parametri?.[group]?.[parameter];
  if (!parameterData) return 0;
  const rawValue = parameterData?.['1'] ?? parameterData?.[1] ?? 0;
  if (typeof rawValue === 'number') return Number.isFinite(rawValue) ? rawValue : 0;
  const parsed = Number.parseFloat(rawValue);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const bazaarItemSortScore = (
  item,
  { selectedCombatParams = ['All'], selectedBaseParams = ['All'] } = {}
) => {
  const combat = normalizeFilterArray(selectedCombatParams);
  const base = normalizeFilterArray(selectedBaseParams);
  const combatSelected = !combat.includes('All') && combat.length > 0;
  const baseSelected = !base.includes('All') && base.length > 0;
  if (!combatSelected && !baseSelected) return null;

  return [
    ...(combatSelected ? combat.map((parameter) => getLevelOneValue(item, 'Combattimento', parameter)) : []),
    ...(baseSelected ? base.map((parameter) => getLevelOneValue(item, 'Base', parameter)) : []),
  ].reduce((total, value) => total + value, 0);
};

export const compareBazaarItems = (
  left,
  right,
  sortOptions = {}
) => {
  const leftScore = bazaarItemSortScore(left, sortOptions);
  const rightScore = bazaarItemSortScore(right, sortOptions);
  if (leftScore !== null && rightScore !== null && rightScore !== leftScore) {
    return rightScore - leftScore;
  }

  const leftName = (left?.General?.Nome || 'Oggetto Sconosciuto').toLowerCase();
  const rightName = (right?.General?.Nome || 'Oggetto Sconosciuto').toLowerCase();
  // Returning zero for equal names intentionally retains the Firestore ID/input
  // order.  Adding an ID tie-breaker would change the current observable result.
  return leftName.localeCompare(rightName);
};

export const matchesBazaarItem = (
  item,
  {
    searchTerm = '',
    selectedSlot = ['All'],
    selectedHands = ['All'],
    selectedTipo = ['All'],
    selectedItemType = ['All'],
    selectedSpecialParams = ['All'],
    onlyAffordable = false,
    userGold = 0,
  } = {}
) => {
  const matchesSearch = String(searchTerm).trim() === ''
    || Boolean(item?.General?.Nome
      && String(item.General.Nome).toLowerCase().includes(String(searchTerm).toLowerCase()));
  const matchesSlot = selected(selectedSlot, item?.General?.Slot);
  const matchesHands = selected(selectedHands, item?.Specific?.Hands == null ? undefined : String(item.Specific.Hands));
  const matchesTipo = selected(selectedTipo, item?.Specific?.Tipo);
  const matchesItemType = selected(selectedItemType, item?.item_type);
  const matchesSpecialParams = normalizeFilterArray(selectedSpecialParams).includes('All')
    || normalizeFilterArray(selectedSpecialParams).some((parameter) => (
      isMeaningfulSpecialValue(item?.Parametri?.Special?.[parameter])
    ));
  const matchesAffordable = !onlyAffordable || getBazaarDisplayedPrice(item) <= userGold;

  return matchesSearch
    && matchesSlot
    && matchesHands
    && matchesTipo
    && matchesItemType
    && matchesSpecialParams
    && matchesAffordable;
};

/**
 * Complete semantic evaluation used by the 09A oracle.  It never slices the
 * result: a caller that needs a page must page the authoritative query first
 * and must prove that its query represents the complete result set.
 */
export const applyBazaarCatalogSemantics = (items, filters = {}, actor = {}) => (
  (Array.isArray(items) ? items : [])
    .filter((item) => isBazaarItemVisibleToActor(item, actor))
    .filter((item) => matchesBazaarItem(item, filters))
    .sort((left, right) => compareBazaarItems(left, right, filters))
);

export const projectBazaarSummary = (item) => ({
  id: item?.id,
  item_type: item?.item_type,
  visibility: item?.visibility,
  allowed_users: Array.isArray(item?.allowed_users) ? [...item.allowed_users] : [],
  normalizedName: String(item?.normalizedName || item?.General?.Nome || '').toLocaleLowerCase(),
  name: item?.General?.Nome || '',
  price: getBazaarDisplayedPrice(item),
  slot: item?.General?.Slot ?? null,
  hands: item?.Specific?.Hands ?? null,
  tipo: item?.Specific?.Tipo ?? null,
  specialParams: Object.keys(item?.Parametri?.Special || {})
    .filter((key) => isMeaningfulSpecialValue(item.Parametri.Special[key])),
  combatParams: Object.keys(item?.Parametri?.Combattimento || {}),
  baseParams: Object.keys(item?.Parametri?.Base || {}),
  thumbnail: item?.media || item?.imageUrl || item?.imagePath || null,
  catalogVersion: item?.catalogVersion ?? null,
});

export const createDefaultBazaarFilters = () => ({
  searchTerm: '',
  selectedSlot: ['All'],
  selectedHands: ['All'],
  selectedTipo: ['All'],
  selectedItemType: ['All'],
  selectedSpecialParams: ['All'],
  selectedCombatParams: ['All'],
  selectedBaseParams: ['All'],
  onlyAffordable: false,
});
