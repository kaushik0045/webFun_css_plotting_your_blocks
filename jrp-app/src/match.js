// Matching engine: compares every buyer with every property for sale and
// explains the result ("See why"). Rules and weights live in src/questions.js.
const { SELLER_QUESTIONS, BUYER_QUESTIONS, MATCH_RULES, LEVELS } = require('./questions');

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

function placesOf(text) {
  return String(text || '').split(/[,;/]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// Score one rule. status: match | partial | miss | missing | any
function scoreRule(rule, listing, buyer) {
  const s = listing.details[rule.seller];
  const b = buyer.details[rule.buyer];
  const base = { key: rule.key, label: rule.label, weight: rule.weight };

  if (rule.kind === 'price') {
    if (blank(s) || blank(b)) {
      const who = [blank(s) && "seller's asking price", blank(b) && "buyer's budget"].filter(Boolean).join(' and ');
      return { ...base, status: 'missing', score: null, text: `Add the ${who} to compare price.` };
    }
    const asking = Number(s);
    const budget = Number(b);
    const diff = asking - budget;
    if (diff <= 0) {
      const left = -diff;
      const leftPct = budget ? (left / budget) * 100 : 0;
      const calc = { asking, budget, difference: left, direction: 'under', pctOfBudget: leftPct };
      if (left === 0) return { ...base, status: 'match', score: 100, calc, text: `Exact match: asking price equals the buyer's budget (${money(budget)}).` };
      if (asking < budget * 0.6) {
        return { ...base, status: 'partial', score: 75, calc,
          text: `${money(left)} under budget (${pct(leftPct)} less). Much cheaper than they can spend, so it may be smaller than what they want.` };
      }
      return { ...base, status: 'match', score: 100, calc, text: `Within budget: ${money(left)} left over (${pct(leftPct)} under the budget).` };
    }
    const overPct = budget ? (diff / budget) * 100 : 100;
    const dropPct = (diff / asking) * 100;
    const score = Math.max(0, Math.round(100 - 5 * overPct));
    return { ...base, status: score >= 70 ? 'partial' : 'miss', score,
      calc: { asking, budget, difference: diff, direction: 'over', pctOfBudget: overPct, sellerDropPct: dropPct },
      text: `${money(diff)} over budget. The buyer would need ${pct(overPct)} more money, or the seller would need to lower the price by ${pct(dropPct)} to ${money(budget)}.` };
  }

  if (rule.kind === 'oneOf') {
    const wanted = Array.isArray(b) ? b : blank(b) ? [] : [b];
    if (!wanted.length) return { ...base, status: 'any', score: null, text: `Buyer is open to any ${rule.label.toLowerCase()}${blank(s) ? '' : ` (this one: ${s})`}.` };
    if (blank(s)) return { ...base, status: 'missing', score: null, text: `Add the ${rule.label.toLowerCase()} for this property.` };
    return wanted.includes(s)
      ? { ...base, status: 'match', score: 100, text: `${s}: the buyer wants this (${wanted.join(', ')}).` }
      : { ...base, status: 'miss', score: 0, text: `This is a ${s}, but the buyer wants ${wanted.join(', ')}.` };
  }

  if (rule.kind === 'place') {
    const wanted = placesOf(b);
    if (!wanted.length) return { ...base, status: 'any', score: null, text: 'Buyer is open to any location.' };
    const where = `${rule.seller === 'address' ? '' : s || ''} ${listing.address || ''}`.toLowerCase();
    const hit = wanted.find((w) => where.includes(w));
    return hit
      ? { ...base, status: 'match', score: 100, text: `In ${b.split(/[,;/]+/).map((x) => x.trim()).find((x) => x.toLowerCase() === hit)}, one of the buyer's preferred areas.` }
      : { ...base, status: 'miss', score: 0, text: `Buyer prefers ${b}; this property is at ${listing.address}.` };
  }

  if (rule.kind === 'atLeast') {
    if (blank(b)) return { ...base, status: 'any', score: null, text: `Buyer has no minimum ${rule.label.toLowerCase()}.` };
    if (blank(s)) return { ...base, status: 'missing', score: null, text: `Add the ${rule.label.toLowerCase()} for this property.` };
    const have = Number(s);
    const need = Number(b);
    if (have >= need) return { ...base, status: 'match', score: 100, text: `${num(have)} ${rule.unit || ''} meets the buyer's minimum of ${num(need)}.`.replace('  ', ' ') };
    const shortPct = ((need - have) / need) * 100;
    const score = Math.max(0, Math.round(100 - 3 * shortPct));
    return { ...base, status: score >= 70 ? 'partial' : 'miss', score,
      text: `${num(need - have)} ${rule.unit || ''} smaller than the buyer's minimum (${pct(shortPct)} short).`.replace('  ', ' ') };
  }
  return { ...base, status: 'any', score: null, text: '' };
}

function levelFor(score) {
  return LEVELS.find((l) => score >= l.min) || LEVELS[LEVELS.length - 1];
}

// Compare one buyer with one listing. Returns score, level and the full "See why" breakdown.
function compare(buyer, listing) {
  const parts = MATCH_RULES.map((r) => scoreRule(r, listing, buyer));
  const counted = parts.filter((p) => p.score !== null);
  const requiredMissing = MATCH_RULES.some((r) => r.required && parts.find((p) => p.key === r.key).status === 'missing');
  if (requiredMissing || !counted.length) {
    return { score: null, level: 'incomplete', label: 'Not enough info', parts, math: null };
  }
  const totalWeight = counted.reduce((a, p) => a + p.weight, 0);
  let score = Math.round(counted.reduce((a, p) => a + p.score * p.weight, 0) / totalWeight);
  const broken = MATCH_RULES.filter((r) => r.dealBreaker && parts.find((p) => p.key === r.key).status === 'miss');
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
      capped: capped ? `Capped at 30 because ${broken.map((r) => r.label.toLowerCase()).join(' and ')} does not match.` : null,
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
const sortMatches = (a, b) => (ORDER[a.level] - ORDER[b.level]) || ((b.score ?? -1) - (a.score ?? -1));

function buyerSummary(b) {
  return { id: b.id, name: b.name, agent_name: b.agent_name, assigned_agent_id: b.assigned_agent_id,
    budget: b.details.budget_max ?? null, types: b.details.property_types || [] };
}
function listingSummary(l) {
  return { id: l.id, address: l.address, client_id: l.client_id, client_name: l.client_name, agent_name: l.agent_name,
    assigned_agent_id: l.assigned_agent_id, asking: l.details.asking_price ?? null, type: l.details.property_type || null };
}

module.exports = {
  SELLER_QUESTIONS, BUYER_QUESTIONS, parseDetails, cleanDetails, changedLabels, compare,
  loadBuyers, loadListings, sortMatches, buyerSummary, listingSummary, isForSale,
};
