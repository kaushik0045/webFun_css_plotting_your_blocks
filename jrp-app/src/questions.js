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
//
//  MATCH_RULES decide how buyers and sellers are compared (see bottom).
//  These starter questions are placeholders until JRP's own list is added.
// ============================================================================

const PROPERTY_TYPES = [
  'Gas station',
  'Truck stop',
  'Hotel / Motel',
  'Retail / Strip center',
  'Restaurant',
  'Office',
  'Industrial / Warehouse',
  'Multifamily (2–4 units)',
  'Multifamily (5+ units)',
  'Single-family home',
  'Condo / Townhouse',
  'Land / Lot',
  'Other commercial',
];

// Only properties whose status is "For sale" are matched with buyers.
const LISTING_STATUSES = ['For sale', 'Under contract', 'Sold', 'Not for sale'];

const BRANDS = ['ARCO', 'Chevron', 'Shell', '76', 'Valero', 'Mobil', 'Exxon', 'Texaco', 'Sinclair', 'Conoco',
  'Phillips 66', 'Circle K', '7-Eleven', 'Rotten Robbie', 'Unbranded', 'Other'];
const YES_NO_APPLIED = ['Yes', 'No', 'Applied for'];

// JRP's seller questions (asked for each property). The property's address is
// already stored with the property, so it is not asked again here.
const SELLER_QUESTIONS = [
  { key: 'listing_status', label: 'Listing status', type: 'select', options: LISTING_STATUSES,
    help: 'Only "For sale" properties are matched with buyers.' },
  { key: 'property_type', label: 'Property type', type: 'select', options: PROPERTY_TYPES },
  { key: 'asking_price', label: 'Asking price', type: 'money' },
  { key: 'brand', label: 'Brand', type: 'select', options: BRANDS },
  { key: 'gas_volume', label: 'Gas volume (gallons per month)', type: 'number' },
  { key: 'gas_margin', label: 'Gas margin (cents per gallon)', type: 'number' },
  { key: 'cstore_sales', label: 'C-store sales (per month)', type: 'money' },
  { key: 'fuel_contract', label: 'Fuel contract (if any)', type: 'text', help: 'Supplier and end date, e.g. "Chevron until 2028".' },
  { key: 'mpds', label: "MPD's (fuel dispensers)", type: 'number' },
  { key: 'size_sqft', label: 'Building size (sq ft)', type: 'number' },
  { key: 'lot_acres', label: 'Lot size (acres)', type: 'number' },
  { key: 'tank_size', label: 'Tank size', type: 'text', help: 'e.g. "2 × 12,000 gal, 1 × 10,000 gal diesel".' },
  { key: 'double_walled', label: 'Double walled tanks?', type: 'yesno' },
  { key: 'rental_income', label: 'Additional rental income?', type: 'yesno' },
  { key: 'rental_income_amount', label: 'If yes, how much (per month)?', type: 'money', showIf: { key: 'rental_income', equals: 'yes' } },
  { key: 'gross_profit', label: 'Gross profit (per year)', type: 'money' },
  { key: 'nearest_freeway', label: 'Nearest freeway', type: 'text', help: 'e.g. "Hwy 99, 0.5 mi".' },
  { key: 'abc_license', label: 'ABC license', type: 'select', options: YES_NO_APPLIED },
  { key: 'cigarette_license', label: 'Cigarette license', type: 'select', options: YES_NO_APPLIED },
  { key: 'ebt', label: 'EBT', type: 'yesno' },
  { key: 'lottery', label: 'Lotto / Lottery', type: 'yesno' },
  { key: 'building_rent', label: 'Rent of the building', type: 'text', help: 'Monthly amount, or "N/A" if owned.' },
  { key: 'hours', label: 'Hours of operation', type: 'text', help: 'e.g. "24 hours" or "5am–11pm".' },
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
  { key: 'property_types', label: 'Property types wanted', type: 'multiselect', options: PROPERTY_TYPES,
    help: 'Leave all unticked if they are open to any type.' },
  { key: 'brands', label: 'Brand interested in', type: 'multiselect', options: BRANDS,
    help: 'Tick all that apply. Leave all unticked if any brand is fine.' },
  { key: 'states', label: 'State interested in', type: 'text',
    help: 'e.g. "CA" or "CA, NV" or "California". Leave blank for any state.' },
  { key: 'branding', label: 'Branded or independent?', type: 'select', options: ['Branded', 'Independent', 'Either'] },
  { key: 'cash_injection', label: 'Cash injection (down payment)', type: 'money', help: 'Cash they can put down. Funds below fills in automatically.' },
  { key: 'budget_max', label: 'Funds (total buying power)', type: 'money', autoFrom: { key: 'cash_injection', times: 5 },
    help: 'Fills in automatically as 5 x the down payment. You can change it.' },
  { key: 'exchange_1031', label: '1031 exchange?', type: 'yesno', help: 'If yes, they probably have a property to sell too.' },
  { key: 'business_experience', label: 'Business experience?', type: 'yesno' },
  { key: 'experience_where', label: 'If yes, where?', type: 'text', showIf: { key: 'business_experience', equals: 'yes' } },
  { key: 'experience_years', label: 'How many years?', type: 'number', showIf: { key: 'business_experience', equals: 'yes' } },
  { key: 'additional_info', label: 'Additional info', type: 'textarea' },
];

// ----------------------------------------------------------------------------
//  MATCH RULES — how a buyer is compared with a property for sale.
//    kind 'price'    seller amount vs buyer's maximum budget
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
  { key: 'type', label: 'Property type', kind: 'oneOf', seller: 'property_type', buyer: 'property_types', weight: 20, dealBreaker: true },
  { key: 'state', label: 'State', kind: 'state', seller: 'address', buyer: 'states', weight: 15, dealBreaker: true },
  { key: 'brand', label: 'Brand', kind: 'oneOf', seller: 'brand', buyer: 'brands', weight: 10 },
  { key: 'branding', label: 'Branded or independent', kind: 'branding', seller: 'brand', buyer: 'branding', weight: 5 },
];

// Score bands for the match meter.
const LEVELS = [
  { level: 'great', min: 85, label: 'Great match' },
  { level: 'good', min: 70, label: 'Good match' },
  { level: 'average', min: 50, label: 'Average match' },
  { level: 'poor', min: 0, label: 'Not a good match' },
];

module.exports = { FUNDS_MULTIPLIER, SELLER_QUESTIONS, BUYER_QUESTIONS, MATCH_RULES, LEVELS, PROPERTY_TYPES, LISTING_STATUSES, BRANDS, STATES };
