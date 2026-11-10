// ============================================================================
//  QUESTIONS FOR AGENTS — edit this file to change the forms.
// ============================================================================
//  SELLER_QUESTIONS are asked for each property a seller lists.
//  BUYER_QUESTIONS are asked once per buyer.
//
//  Each question has:
//    key      a short id with no spaces (never change it once real data exists)
//    label    the question shown to agents
//    type     'money' | 'number' | 'select' | 'multiselect' | 'text' | 'textarea' | 'yesno'
//    options  (select / multiselect only) the allowed answers
//    help     (optional) a hint shown under the question
//    showIf   (optional) only ask when another answer matches, e.g. { key: 'rental_income', equals: 'yes' }
//             or one of several answers: { key: 'category', in: ['Commercial', 'Both'] }
//    optionsBy (optional) narrow the options by another answer, e.g. property types by Residential / Commercial
//
//  MATCH_RULES decide how buyers and sellers are compared (see bottom).
//  These starter questions are placeholders until JRP's own list is added.
// ============================================================================

// First question: residential or commercial. It decides which property types and questions show up.
const CATEGORIES = ['Residential', 'Commercial'];
const RESIDENTIAL_TYPES = [
  'Single-family home',
  'Condo / Townhouse',
  'Multifamily (2–4 units)',
  'Multifamily (5+ units)',
  'Mobile / Manufactured home',
  'Land / Lot',
  'Other residential',
];
const COMMERCIAL_TYPES = [
  'Gas station',
  'Truck stop',
  'Car wash',
  'Liquor store',
  'Hotel / Motel',
  'Retail / Strip center',
  'Restaurant',
  'Office',
  'Industrial / Warehouse',
  'Multifamily (5+ units)',
  'Land / Lot',
  'Other commercial',
];
const PROPERTY_TYPES = [...new Set([...COMMERCIAL_TYPES, ...RESIDENTIAL_TYPES])];
// Which types belong to which choice ("Both" = every type).
const TYPES_BY_CATEGORY = { Residential: RESIDENTIAL_TYPES, Commercial: COMMERCIAL_TYPES };
const COMMERCIAL_ONLY = { key: 'category', in: ['Commercial'] };
const RESIDENTIAL_ONLY = { key: 'category', in: ['Residential'] };

// Only properties whose status is "For sale" are matched with buyers.
const LISTING_STATUSES = ['For sale', 'Under contract', 'Sold', 'Not for sale'];

const BRANDS = ['ARCO', 'Chevron', 'Shell', '76', 'Valero', 'Mobil', 'Exxon', 'Texaco', 'Sinclair', 'Conoco',
  'Phillips 66', 'Circle K', '7-Eleven', 'Rotten Robbie', 'Unbranded', 'Other'];
const YES_NO_APPLIED = ['Yes', 'No', 'Applied for'];

// JRP's seller questions (asked for each property). The property's address is
// already stored with the property, so it is not asked again here.
const SELLER_QUESTIONS = [
  { key: 'category', label: 'Selling residential or commercial?', type: 'select', options: CATEGORIES, lead: true,
    help: 'Pick one to see the questions for this property.' },
  { key: 'listing_status', label: 'Listing status', type: 'select', options: LISTING_STATUSES,
    help: 'Only "For sale" properties are matched with buyers.' },
  { key: 'property_type', label: 'Property type', type: 'select', options: PROPERTY_TYPES,
    optionsBy: { key: 'category', groups: TYPES_BY_CATEGORY }, },
  { key: 'asking_price', label: 'Asking price', type: 'money' },
  { key: 'bedrooms', label: 'Bedrooms', type: 'number', showIf: RESIDENTIAL_ONLY },
  { key: 'bathrooms', label: 'Bathrooms', type: 'number', showIf: RESIDENTIAL_ONLY },
  { key: 'year_built', label: 'Year built', type: 'number', showIf: RESIDENTIAL_ONLY },
  { key: 'hoa', label: 'HOA fee (per month)', type: 'money', showIf: RESIDENTIAL_ONLY, help: 'Leave blank if none.' },
  { key: 'exchange_1031', label: '1031 exchange?', type: 'yesno',
    help: 'If yes, the seller will buy a replacement property, so they are a buyer too.' },
  { key: 'brand', label: 'Brand', type: 'select', options: BRANDS, showIf: COMMERCIAL_ONLY },
  { key: 'gas_volume', label: 'Gas volume (gallons per month)', type: 'number', showIf: COMMERCIAL_ONLY },
  { key: 'gas_margin', label: 'Gas margin (cents per gallon)', type: 'number', showIf: COMMERCIAL_ONLY },
  { key: 'cstore_sales', label: 'C-store sales (per month)', type: 'money', showIf: COMMERCIAL_ONLY },
  { key: 'fuel_contract', label: 'Fuel contract (if any)', type: 'text', help: 'Supplier and end date, e.g. "Chevron until 2028".', showIf: COMMERCIAL_ONLY },
  { key: 'mpds', label: "MPD's (fuel dispensers)", type: 'number', showIf: COMMERCIAL_ONLY },
  { key: 'size_sqft', label: 'Building size (sq ft)', type: 'number' },
  { key: 'lot_acres', label: 'Lot size (acres)', type: 'number' },
  { key: 'tank_size', label: 'Tank size', type: 'text', help: 'e.g. "2 × 12,000 gal, 1 × 10,000 gal diesel".', showIf: COMMERCIAL_ONLY },
  { key: 'double_walled', label: 'Double walled tanks?', type: 'yesno', showIf: COMMERCIAL_ONLY },
  { key: 'rental_income', label: 'Additional rental income?', type: 'yesno' },
  { key: 'rental_income_amount', label: 'If yes, how much (per month)?', type: 'money', showIf: { key: 'rental_income', equals: 'yes' } },
  { key: 'gross_profit', label: 'Gross profit (per year)', type: 'money', showIf: COMMERCIAL_ONLY },
  { key: 'nearest_freeway', label: 'Nearest freeway', type: 'text', help: 'e.g. "Hwy 99, 0.5 mi".', showIf: COMMERCIAL_ONLY },
  { key: 'abc_license', label: 'ABC license', type: 'select', options: YES_NO_APPLIED, showIf: COMMERCIAL_ONLY },
  { key: 'cigarette_license', label: 'Cigarette license', type: 'select', options: YES_NO_APPLIED, showIf: COMMERCIAL_ONLY },
  { key: 'ebt', label: 'EBT', type: 'yesno', showIf: COMMERCIAL_ONLY },
  { key: 'lottery', label: 'Lotto / Lottery', type: 'yesno', showIf: COMMERCIAL_ONLY },
  { key: 'building_rent', label: 'Rent of the building', type: 'text', help: 'Monthly amount, or "N/A" if owned.', showIf: COMMERCIAL_ONLY },
  { key: 'hours', label: 'Hours of operation', type: 'text', help: 'e.g. "24 hours" or "5am–11pm".', showIf: COMMERCIAL_ONLY },
  { key: 'additional_info', label: 'Additional info', type: 'textarea' },
];

// US states, so buyers can type "CA" or "California".
const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// JRP's buyer questions (asked once per buyer).
const BUYER_QUESTIONS = [
  { key: 'category', label: 'Property interested in: residential or commercial?', type: 'select', options: ['Residential', 'Commercial', 'Both'], lead: true,
    help: 'Pick one to see the rest of the questions.' },
  { key: 'property_types', label: 'Property types wanted', type: 'multiselect', options: PROPERTY_TYPES,
    optionsBy: { key: 'category', groups: TYPES_BY_CATEGORY },
    help: 'Leave all unticked if they are open to any type.' },
  { key: 'brands', label: 'Brand interested in', type: 'multiselect', options: BRANDS, showIf: { key: 'category', in: ['Commercial', 'Both'] },
    help: 'Tick all that apply. Leave all unticked if any brand is fine.' },
  { key: 'states', label: 'State interested in', type: 'text',
    help: 'e.g. "CA" or "CA, NV" or "California". Leave blank for any state.' },
  { key: 'branding', label: 'Branded or independent?', type: 'select', options: ['Branded', 'Independent', 'Either'],
    showIf: { key: 'category', in: ['Commercial', 'Both'] } },
  { key: 'cash_injection', label: 'Cash injection (down payment)', type: 'money', help: 'Cash they can put down. Funds below fills in automatically.' },
  { key: 'budget_max', label: 'Funds (total buying power)', type: 'money', autoFrom: { key: 'cash_injection', times: 5 },
    help: 'Fills in automatically as 5 x the down payment. You can change it.' },
  { key: 'business_experience', label: 'Business experience?', type: 'yesno' },
  { key: 'experience_where', label: 'If yes, where?', type: 'text', showIf: { key: 'business_experience', equals: 'yes' } },
  { key: 'experience_years', label: 'How many years?', type: 'number', showIf: { key: 'business_experience', equals: 'yes' } },
  { key: 'additional_info', label: 'Additional info', type: 'textarea' },
];

// Everything else waits until Residential / Commercial is picked.
const GATE = (list, choices) => list.forEach((q) => { if (q.key !== 'category' && !q.showIf) q.showIf = { key: 'category', in: choices }; });
GATE(SELLER_QUESTIONS, CATEGORIES);
GATE(BUYER_QUESTIONS, ['Residential', 'Commercial', 'Both']);

// ----------------------------------------------------------------------------
//  MATCH RULES — how a buyer is compared with a property for sale.
//    kind 'price'    seller amount vs buyer's maximum budget
//    kind 'category' Residential / Commercial must agree (buyer "Both" = any)
//    kind 'oneOf'    seller's answer must be one of the buyer's choices (blank = any)
//    kind 'state'    the property's address must be in one of the buyer's states
//    kind 'branding' buyer wants Branded / Independent; seller brand "Unbranded" = independent
//    kind 'place'    the property's address must contain one of the buyer's places (not used now)
//    kind 'atLeast'  seller's number must be at least the buyer's minimum (not used now)
//  weight = how much the rule counts toward the 0–100 score.
//  dealBreaker = a miss caps the whole score at 30 ("Not a good match").
// ----------------------------------------------------------------------------
// Buying power = this many times the down payment (used when Funds is left blank).
const FUNDS_MULTIPLIER = 5;

const MATCH_RULES = [
  { key: 'price', label: 'Price vs funds', kind: 'price', seller: 'asking_price', buyer: 'budget_max', weight: 50, required: true },
  { key: 'category', label: 'Residential or commercial', kind: 'category', seller: 'category', buyer: 'category', weight: 5, dealBreaker: true },
  { key: 'type', label: 'Property type', kind: 'oneOf', seller: 'property_type', buyer: 'property_types', weight: 20, dealBreaker: true },
  { key: 'state', label: 'State', kind: 'state', seller: 'address', buyer: 'states', weight: 15, dealBreaker: true },
  { key: 'brand', label: 'Brand', kind: 'oneOf', seller: 'brand', buyer: 'brands', weight: 10 },
  { key: 'branding', label: 'Branded or independent', kind: 'branding', seller: 'brand', buyer: 'branding', weight: 5 },
];

// Which category a property type belongs to (used to fill in old records).
function categoryOfType(t) {
  const r = RESIDENTIAL_TYPES.includes(t); const c = COMMERCIAL_TYPES.includes(t);
  return r && !c ? 'Residential' : c && !r ? 'Commercial' : null;
}

// Score bands for the match meter.
const LEVELS = [
  { level: 'great', min: 85, label: 'Great match' },
  { level: 'good', min: 70, label: 'Good match' },
  { level: 'average', min: 50, label: 'Average match' },
  { level: 'poor', min: 0, label: 'Not a good match' },
];

module.exports = { CATEGORIES, TYPES_BY_CATEGORY, categoryOfType, FUNDS_MULTIPLIER, SELLER_QUESTIONS, BUYER_QUESTIONS, MATCH_RULES, LEVELS, PROPERTY_TYPES, LISTING_STATUSES, BRANDS, STATES };
