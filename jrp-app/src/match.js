// Matching engine: compares every buyer with every property for sale and
// explains the result ("See why"). Rules and weights live in src/questions.js.
const { SELLER_QUESTIONS, BUYER_QUESTIONS, MATCH_RULES, LEVELS, STATES, FUNDS_MULTIPLIER } = require('./questions');

const blank = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const pct = (n) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;
const num = (n) => Math.round(n).toLocaleString('en-US');

function parseDetails(text) {
  try {
    const o = JSON.parse(text || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}

// Clean answers coming from a form so only known questions with valid values are stored.
function cleanDetails(questions, input, existing = {}) {
  const out = { ...existing };
  if (!input || typeof input !== 'object') return out;
  for (const q of questions) {
    if (!(q.key in input)) continue;
    const v = input[q.key];
    let val = null;
    if (q.type === 'money' || q.type === 'number') {
      const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,\s]/g, ''));
      val = String(v ?? '').trim() === '' || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100) / 100;
    } else if (q.type === 'select') {
      val = q.options.includes(v) ? v : null;
    } else if (q.type === 'multiselect') {
      val = Array.isArray(v) ? q.options.filter((o) => v.includes(o)) : [];
      if (!val.length) val = null;
    } else if (q.type === 'yesno') {
      val = v === 'yes' || v === 'no' ? v : null;
    } else {
      const s = typeof v === 'string' ? v.trim().slice(0, q.type === 'textarea' ? 2000 : 200) : '';
      val = s || null;
    }
    if (val === null) delete out[q.key]; else out[q.key] = val;
  }
  // Drop follow-up answers whose condition is no longer true (e.g. rental amount when rental income is "No").
  for (const q of questions) {
    if (q.showIf && out[q.showIf.key] !== q.showIf.equals) delete out[q.key];
  }
  return out;
}

// Which questions changed (for the history log).
function changedLabels(questions, before, after) {
  return questions.filter((q) => JSON.stringify(before[q.key] ?? null) !== JSON.stringify(after[q.key] ?? null)).map((q) => q.label);
}

// Small memo so repeated lookups (same address / same buyer text) are instant.
function memo(fn, max = 5000) {
  const cache = new Map();
  return (key) => {
    const k = String(key ?? '');
    if (cache.has(k)) return cache.get(k);
    if (cache.size >= max) cache.clear();
    const v = fn(k);
    cache.set(k, v);
    return v;
  };
}

// "CA, nevada" -> ['CA', 'NV']
const NAME_TO_CODE = Object.fromEntries(Object.entries(STATES).map(([code, name]) => [name.toLowerCase(), code]));
const statesOf = memo((text) => {
  const out = [];
  for (const raw of text.split(/[,;/]+|\s+and\s+/i)) {
    const t = raw.trim();
    const code = STATES[t.toUpperCase()] ? t.toUpperCase() : NAME_TO_CODE[t.toLowerCase()];
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
});
// Which state is an address in? Looks for ", CA" / " CA 95350" or the full state name.
// The patterns are built once, not on every comparison.
const STATE_PATTERNS = Object.entries(STATES).map(([code, name]) => ({
  code,
  short: new RegExp(`(^|[\\s,])${code}(\\s+\\d{5}|\\s*,|\\s*$)`),
  long: new RegExp(`\\b${name}\\b`, 'i'),
}));
const stateOfAddress = memo((a) => {
  for (const sp of STATE_PATTERNS) {
    if (sp.short.test(a) || sp.long.test(a)) return sp.code;
  }
  return null;
});

function placesOf(text) {
  return String(text || '').split(/[,;/]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// Score one rule. status: match | partial | miss | missing | any
function scoreRule(rule, listing, buyer) {
  const s = listing.details[rule.seller];
  let b = buyer.details[rule.buyer];
  // No Funds entered: buying power = 5 x down payment.
  const estimated = rule.kind === 'price' && blank(b) && !blank(buyer.details.cash_injection);
  if (estimated) b = Number(buyer.details.cash_injection) * FUNDS_MULTIPLIER;
  const base = { key: rule.key, label: rule.label, weight: rule.weight };

  if (rule.kind === 'price') {
    if (blank(s) || blank(b)) {
      const who = [blank(s) && "seller's asking price", blank(b) && "buyer's budget"].filter(Boolean).join(' and ');
      return { ...base, status: 'missing', score: null, why: () => `Add the ${who} to compare price.`.replace("buyer's budget", "buyer's funds") };
    }
    const asking = Number(s);
    const budget = Number(b);
    const diff = asking - budget;
    const cash = blank(buyer.details.cash_injection) ? null : Number(buyer.details.cash_injection);
    const cashInfo = { ...(cash === null ? {} : { cash, cashPctOfAsking: asking ? (cash / asking) * 100 : 0 }), ...(estimated ? { estimated: true } : {}) };
    if (diff <= 0) {
      const left = -diff;
      const leftPct = budget ? (left / budget) * 100 : 0;
      const calc = { asking, budget, difference: left, direction: 'under', pctOfBudget: leftPct, ...cashInfo };
      if (left === 0) return { ...base, status: 'match', score: 100, calc, why: () => `Exact match: asking price equals the buyer's funds (${money(budget)}).` };
      if (asking < budget * 0.6) {
        return { ...base, status: 'partial', score: 75, calc,
          why: () => `${money(left)} under their funds (${pct(leftPct)} less). Much cheaper than they can spend, so it may be smaller than what they want.` };
      }
      return { ...base, status: 'match', score: 100, calc, why: () => `Within funds: ${money(left)} left over (${pct(leftPct)} under their funds).` };
    }
    const overPct = budget ? (diff / budget) * 100 : 100;
    const dropPct = (diff / asking) * 100;
    const score = Math.max(0, Math.round(100 - 5 * overPct));
    return { ...base, status: score >= 70 ? 'partial' : 'miss', score,
      calc: { asking, budget, difference: diff, direction: 'over', pctOfBudget: overPct, sellerDropPct: dropPct, ...cashInfo },
      why: () => `${money(diff)} more than the buyer's funds. The buyer would need ${pct(overPct)} more money, or the seller would need to lower the price by ${pct(dropPct)} to ${money(budget)}.` };
  }

  if (rule.kind === 'oneOf') {
    const wanted = Array.isArray(b) ? b : blank(b) ? [] : [b];
    if (!wanted.length) return { ...base, status: 'any', score: null, why: () => `Buyer is open to any ${rule.label.toLowerCase()}${blank(s) ? '' : ` (this one: ${s})`}.` };
    if (blank(s)) return { ...base, status: 'missing', score: null, why: () => `Add the ${rule.label.toLowerCase()} for this property.` };
    return wanted.includes(s)
      ? { ...base, status: 'match', score: 100, why: () => `${s}: the buyer wants this (${wanted.join(', ')}).` }
      : { ...base, status: 'miss', score: 0, why: () => `This is a ${s}, but the buyer wants ${wanted.join(', ')}.` };
  }

  if (rule.kind === 'state') {
    const wanted = statesOf(b);
    if (!wanted.length) return { ...base, status: 'any', score: null, why: () => 'Buyer is open to any state.' };
    const st = stateOfAddress(listing.address);
    if (!st) return { ...base, status: 'missing', score: null, why: () => 'Add the state to this property\'s address (e.g. "Modesto, CA 95350").' };
    return wanted.includes(st)
      ? { ...base, status: 'match', score: 100, why: () => `In ${STATES[st]}, a state the buyer wants (${wanted.join(', ')}).` }
      : { ...base, status: 'miss', score: 0, why: () => `This property is in ${STATES[st]}, but the buyer wants ${wanted.map((c) => STATES[c]).join(', ')}.` };
  }

  if (rule.kind === 'branding') {
    if (blank(b) || b === 'Either') return { ...base, status: 'any', score: null, why: () => 'Buyer is fine with branded or independent.' };
    if (blank(s)) return { ...base, status: 'missing', score: null, why: () => 'Add the brand for this property.' };
    const isIndependent = s === 'Unbranded';
    const ok = (b === 'Independent') === isIndependent;
    return ok
      ? { ...base, status: 'match', score: 100, why: () => `${isIndependent ? 'Independent (unbranded)' : `Branded (${s})`}, as the buyer wants.` }
      : { ...base, status: 'miss', score: 0, why: () => `Buyer wants ${b.toLowerCase()}, but this station is ${isIndependent ? 'independent (unbranded)' : `branded (${s})`}.` };
  }

  if (rule.kind === 'place') {
    const wanted = placesOf(b);
    if (!wanted.length) return { ...base, status: 'any', score: null, why: () => 'Buyer is open to any location.' };
    const where = `${rule.seller === 'address' ? '' : s || ''} ${listing.address || ''}`.toLowerCase();
    const hit = wanted.find((w) => where.includes(w));
    return hit
      ? { ...base, status: 'match', score: 100, why: () => `In ${b.split(/[,;/]+/).map((x) => x.trim()).find((x) => x.toLowerCase() === hit)}, one of the buyer's preferred areas.` }
      : { ...base, status: 'miss', score: 0, why: () => `Buyer prefers ${b}; this property is at ${listing.address}.` };
  }

  if (rule.kind === 'atLeast') {
    if (blank(b)) return { ...base, status: 'any', score: null, why: () => `Buyer has no minimum ${rule.label.toLowerCase()}.` };
    if (blank(s)) return { ...base, status: 'missing', score: null, why: () => `Add the ${rule.label.toLowerCase()} for this property.` };
    const have = Number(s);
    const need = Number(b);
    if (have >= need) return { ...base, status: 'match', score: 100, why: () => `${num(have)} ${rule.unit || ''} meets the buyer's minimum of ${num(need)}.`.replace('  ', ' ') };
    const shortPct = ((need - have) / need) * 100;
    const score = Math.max(0, Math.round(100 - 3 * shortPct));
    return { ...base, status: score >= 70 ? 'partial' : 'miss', score,
      why: () => `${num(need - have)} ${rule.unit || ''} smaller than the buyer's minimum (${pct(shortPct)} short).`.replace('  ', ' ') };
  }
  return { ...base, status: 'any', score: null, why: () => '' };
}

function levelFor(score) {
  return LEVELS.find((l) => score >= l.min) || LEVELS[LEVELS.length - 1];
}

// Compare one buyer with one listing. Returns score, level and the full "See why" breakdown.
// explain = false skips writing the "See why" sentences (much faster for big lists).
function compare(buyer, listing, explain = true) {
  const parts = MATCH_RULES.map((r) => {
    const part = scoreRule(r, listing, buyer);
    if (explain) part.text = part.why ? part.why() : '';
    part.why = undefined; // not sent to the browser
    return part;
  });
  const counted = parts.filter((p) => p.score !== null);
  const missingRequired = MATCH_RULES.filter((r) => r.required && parts.find((p) => p.key === r.key).status === 'missing');
  const broken = MATCH_RULES.filter((r) => r.dealBreaker && parts.find((p) => p.key === r.key).status === 'miss');
  const totalWeight = counted.reduce((a, p) => a + p.weight, 0);
  const weighted = counted.length ? Math.round(counted.reduce((a, p) => a + p.score * p.weight, 0) / totalWeight) : null;
  // A deal-breaker (wrong property type or state) means "not a fit" even if the price is still unknown.
  if (missingRequired.length && !broken.length || !counted.length) {
    const need = missingRequired.length
      ? parts.filter((p) => missingRequired.some((r) => r.key === p.key)).map((p) => p.text || '').filter(Boolean)
      : [];
    const missingLabel = parts.find((p) => p.key === 'price' && p.status === 'missing')
      ? `Missing: ${[blank(listing.details.asking_price) && 'asking price', blank(buyer.details.budget_max) && "buyer's funds"].filter(Boolean).join(' & ')}`
      : 'Not enough info';
    // "fitSoFar" ranks the incomplete ones: how well everything else lines up.
    return { score: null, level: 'incomplete', label: missingLabel, fitSoFar: weighted, need, parts, math: null };
  }
  let score = weighted;
  const capped = broken.length > 0 && score > 30;
  if (capped) score = 30;
  const lvl = levelFor(score);
  return {
    score,
    level: lvl.level,
    label: lvl.label,
    parts,
    math: {
      lines: counted.map((p) => ({ label: p.label, score: p.score, weightPct: Math.round((p.weight / totalWeight) * 1000) / 10 })),
      capped: capped && explain ? `Capped at 30 because ${broken.map((r) => r.label.toLowerCase()).join(' and ')} does not match.` : capped ? 'capped' : null,
    },
  };
}

// ---------- loading buyers & listings from the database ----------
function loadBuyers(db) {
  return db.prepare(`SELECT c.id, c.name, c.type, c.details, c.assigned_agent_id, u.name AS agent_name
    FROM clients c LEFT JOIN users u ON u.id = c.assigned_agent_id
    WHERE c.type IN ('buyer','both')`).all().map((r) => ({ ...r, details: parseDetails(r.details) }));
}

function isForSale(listing) {
  const st = listing.details.listing_status;
  return st ? st === 'For sale' : true; // a seller's property with no status yet counts as for sale
}

function loadListings(db) {
  return db.prepare(`SELECT p.id, p.address, p.details, p.client_id, c.name AS client_name, c.type AS client_type,
      c.assigned_agent_id, u.name AS agent_name
    FROM properties p JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = c.assigned_agent_id
    WHERE c.type IN ('seller','both')`).all()
    .map((r) => ({ ...r, details: parseDetails(r.details) }))
    .filter(isForSale);
}

const ORDER = { great: 0, good: 1, average: 2, poor: 3, incomplete: 4 };
const sortMatches = (a, b) => (ORDER[a.level] - ORDER[b.level]) || ((b.score ?? b.fitSoFar ?? -1) - (a.score ?? a.fitSoFar ?? -1));

function buyerSummary(b) {
  return { id: b.id, name: b.name, agent_name: b.agent_name, assigned_agent_id: b.assigned_agent_id,
    budget: b.details.budget_max ?? (blank(b.details.cash_injection) ? null : Number(b.details.cash_injection) * FUNDS_MULTIPLIER), cash: b.details.cash_injection ?? null, types: b.details.property_types || [],
    brands: b.details.brands || [], states: b.details.states || null, exchange_1031: b.details.exchange_1031 === 'yes' };
}
function listingSummary(l) {
  return { id: l.id, address: l.address, client_id: l.client_id, client_name: l.client_name, agent_name: l.agent_name,
    assigned_agent_id: l.assigned_agent_id, asking: l.details.asking_price ?? null, type: l.details.property_type || null,
    brand: l.details.brand || null };
}

module.exports = {
  statesOf, stateOfAddress,
  SELLER_QUESTIONS, BUYER_QUESTIONS, parseDetails, cleanDetails, changedLabels, compare,
  loadBuyers, loadListings, sortMatches, buyerSummary, listingSummary, isForSale,
};
