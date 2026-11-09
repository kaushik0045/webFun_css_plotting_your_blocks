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

const TIMELINES = ['ASAP', '1–3 months', '3–6 months', '6–12 months', 'Just exploring'];

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

const BUYER_QUESTIONS = [
  { key: 'property_types', label: 'Property types wanted', type: 'multiselect', options: PROPERTY_TYPES,
    help: 'Leave all unticked if they are open to any type.' },
  { key: 'budget_max', label: 'Maximum budget', type: 'money', help: 'The most they can spend.' },
  { key: 'preferred_cities', label: 'Preferred cities', type: 'text', help: 'Separate with commas, e.g. Modesto, Turlock. Leave blank for anywhere.' },
  { key: 'min_size_sqft', label: 'Minimum building size (sq ft)', type: 'number' },
  { key: 'financing', label: 'How are they paying?', type: 'select', options: ['Cash', 'Pre-approved loan', 'Needs financing', 'Not sure'] },
  { key: 'timeline', label: 'How soon do they want to buy?', type: 'select', options: TIMELINES },
  { key: 'notes', label: 'Anything else they are looking for?', type: 'textarea' },
];

// ----------------------------------------------------------------------------
//  MATCH RULES — how a buyer is compared with a property for sale.
//    kind 'price'    seller amount vs buyer's maximum budget
//    kind 'oneOf'    seller's answer must be one of the buyer's choices (blank = any)
//    kind 'place'    the property's address must contain one of the buyer's places
//    kind 'atLeast'  seller's number must be at least the buyer's minimum
//  weight = how much the rule counts toward the 0–100 score.
//  dealBreaker = a miss caps the whole score at 30 ("Not a good match").
// ----------------------------------------------------------------------------
const MATCH_RULES = [
  { key: 'price', label: 'Price vs budget', kind: 'price', seller: 'asking_price', buyer: 'budget_max', weight: 55, required: true },
  { key: 'type', label: 'Property type', kind: 'oneOf', seller: 'property_type', buyer: 'property_types', weight: 25, dealBreaker: true },
  { key: 'location', label: 'Location', kind: 'place', seller: 'address', buyer: 'preferred_cities', weight: 10 },
  { key: 'size', label: 'Building size', kind: 'atLeast', seller: 'size_sqft', buyer: 'min_size_sqft', weight: 10, unit: 'sq ft' },
];

// Score bands for the match meter.
const LEVELS = [
  { level: 'great', min: 85, label: 'Great match' },
  { level: 'good', min: 70, label: 'Good match' },
  { level: 'average', min: 50, label: 'Average match' },
  { level: 'poor', min: 0, label: 'Not a good match' },
];

module.exports = { SELLER_QUESTIONS, BUYER_QUESTIONS, MATCH_RULES, LEVELS, PROPERTY_TYPES, LISTING_STATUSES, BRANDS };
