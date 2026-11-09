// Checks for buyer <-> seller matching.  Run with:  npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compare, cleanDetails, BUYER_QUESTIONS, SELLER_QUESTIONS } = require('../src/match');

// ---------- the scoring engine on its own ----------
const buyer = (details) => ({ id: 1, details });
const listing = (details, address = '1 Main St, Modesto, CA') => ({ id: 2, address, details });
const gasBuyer = (budget, extra = {}) => buyer({ budget_max: budget, property_types: ['Gas station'], ...extra });
const gasStation = (asking, extra = {}) => listing({ asking_price: asking, property_type: 'Gas station', ...extra });

test('exact price and type = great match, 100', () => {
  const m = compare(gasBuyer(1000000), gasStation(1000000));
  assert.equal(m.score, 100);
  assert.equal(m.level, 'great');
  assert.equal(m.label, 'Great match');
});

test('score falls as the asking price goes over budget', () => {
  const s = (ask) => compare(gasBuyer(1000000), gasStation(ask));
  assert.equal(s(1050000).level, 'good');      // 5% over
  assert.equal(s(1100000).level, 'average');   // 10% over
  assert.equal(s(1250000).level, 'poor');      // 25% over
  assert.ok(s(1050000).score > s(1100000).score);
});

test('calculator: difference, % of budget, and price drop needed', () => {
  const m = compare(gasBuyer(1000000), gasStation(1100000));
  const price = m.parts.find((p) => p.key === 'price');
  assert.equal(price.calc.direction, 'over');
  assert.equal(price.calc.difference, 100000);
  assert.equal(price.calc.pctOfBudget, 10);
  assert.equal(Math.round(price.calc.sellerDropPct * 10) / 10, 9.1);
  assert.match(price.text, /\$100,000 over budget/);
  assert.match(price.text, /10\.0% more/);
  assert.match(price.text, /9\.1%/);
});

test('under budget is shown with the amount left over', () => {
  const m = compare(gasBuyer(1000000), gasStation(900000));
  const price = m.parts.find((p) => p.key === 'price');
  assert.equal(m.level, 'great');
  assert.equal(price.calc.direction, 'under');
  assert.equal(price.calc.difference, 100000);
  assert.match(price.text, /\$100,000 left over/);
});

test('much cheaper than the budget is only a partial price match', () => {
  const price = compare(gasBuyer(1000000), gasStation(400000)).parts.find((p) => p.key === 'price');
  assert.equal(price.status, 'partial');
});

test('wrong property type caps the score: not a good match', () => {
  const m = compare(buyer({ budget_max: 1000000, property_types: ['Hotel / Motel'] }), gasStation(1000000));
  assert.equal(m.level, 'poor');
  assert.ok(m.score <= 30);
  assert.match(m.math.capped, /property type/);
});

test('buyer open to any type is not penalised', () => {
  const m = compare(buyer({ budget_max: 1000000 }), gasStation(1000000));
  assert.equal(m.level, 'great');
  assert.equal(m.parts.find((p) => p.key === 'type').status, 'any');
});

test('location and size count when the buyer sets them', () => {
  const far = compare(gasBuyer(1000000, { preferred_cities: 'Fresno' }), gasStation(1000000, { city: 'Modesto' }));
  const near = compare(gasBuyer(1000000, { preferred_cities: 'fresno, modesto' }), gasStation(1000000, { city: 'Modesto' }));
  assert.ok(near.score > far.score);
  assert.equal(near.parts.find((p) => p.key === 'location').status, 'match');
  const small = compare(gasBuyer(1000000, { min_size_sqft: 3000 }), gasStation(1000000, { size_sqft: 2800 }));
  assert.equal(small.parts.find((p) => p.key === 'size').status, 'partial');
});

test('missing price on either side = not enough info, with what to fill in', () => {
  const m = compare(gasBuyer(null), gasStation(1000000));
  assert.equal(m.level, 'incomplete');
  assert.equal(m.score, null);
  assert.match(m.parts.find((p) => p.key === 'price').text, /buyer's budget/);
});

test('form answers are cleaned: money text, unknown options and unknown questions', () => {
  const d = cleanDetails(BUYER_QUESTIONS, { budget_max: '$1,200,000', property_types: ['Gas station', 'Spaceship'], financing: 'Bitcoin', hacker: 'x' });
  assert.deepEqual(d, { budget_max: 1200000, property_types: ['Gas station'] });
  const s = cleanDetails(SELLER_QUESTIONS, { asking_price: '', listing_status: 'For sale' }, { asking_price: 5 });
  assert.deepEqual(s, { listing_status: 'For sale' }, 'blank answer clears the old one');
});

// ---------- through the real API ----------
const ROOT = path.join(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jrp-match-'));
const PORT = 4000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let cookie = '';
async function call(method, url, body) {
  const headers = { 'X-JRP': '1' };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, data: await res.json() };
}

before(async () => {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT), DATA_DIR, ADMIN_EMAIL: 'a@test.com', ADMIN_PASSWORD: 'AdminPass1', ADMIN_NAME: 'Admin', NODE_ENV: 'test' },
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  await call('POST', '/api/login', { email: 'a@test.com', password: 'AdminPass1' });
});
after(() => { server.kill(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });

const ids = {};
test('API: questions are available to the app', async () => {
  const q = (await call('GET', '/api/questions')).data;
  assert.ok(q.seller.some((x) => x.key === 'asking_price'));
  assert.ok(q.buyer.some((x) => x.key === 'budget_max'));
});

test('API: save seller listing answers and buyer answers', async () => {
  ids.seller = (await call('POST', '/api/clients', { type: 'seller', name: 'Seller One', properties: [{ address: '1 Fuel Way, Modesto' }] })).data.id;
  const seller = (await call('GET', `/api/clients/${ids.seller}`)).data;
  ids.station = seller.properties[0].id;
  assert.equal(seller.properties[0].details.listing_status, 'For sale', 'seller properties start as For sale');
  const r = await call('PATCH', `/api/properties/${ids.station}`, { details: { property_type: 'Gas station', asking_price: '1,000,000', city: 'Modesto' } });
  assert.equal(r.status, 200);
  const p = (await call('GET', `/api/properties/${ids.station}`)).data;
  assert.equal(p.details.asking_price, 1000000);
  assert.ok(p.activity.some((a) => /Asking price/.test(a.detail)), 'answer changes go in the history');

  ids.exact = (await call('POST', '/api/clients', { type: 'buyer', name: 'Exact Buyer', details: { budget_max: 1000000, property_types: ['Gas station'] } })).data.id;
  ids.short = (await call('POST', '/api/clients', { type: 'buyer', name: 'Short Buyer', details: { budget_max: 800000, property_types: ['Gas station'] } })).data.id;
  ids.hotel = (await call('POST', '/api/clients', { type: 'buyer', name: 'Hotel Buyer', details: { budget_max: 1000000, property_types: ['Hotel / Motel'] } })).data.id;
  ids.blank = (await call('POST', '/api/clients', { type: 'buyer', name: 'No Answers Buyer' })).data.id;
});

test('API: every buyer is ranked for a listing, best first', async () => {
  const d = (await call('GET', `/api/properties/${ids.station}/matches`)).data;
  assert.equal(d.for_sale, true);
  assert.equal(d.matches.length, 4, 'all 4 buyers are compared');
  assert.equal(d.matches[0].buyer.name, 'Exact Buyer');
  assert.equal(d.matches[0].level, 'great');
  assert.equal(d.matches.at(-1).level, 'incomplete');
  const short = d.matches.find((m) => m.buyer.name === 'Short Buyer');
  assert.equal(short.parts[0].calc.difference, 200000);
  assert.equal(short.parts[0].calc.pctOfBudget, 25);
});

test('API: a buyer sees all listings ranked', async () => {
  const d = (await call('GET', `/api/clients/${ids.exact}/matches`)).data;
  assert.equal(d.buyer, true);
  assert.equal(d.matches.length, 1);
  assert.equal(d.matches[0].listing.asking, 1000000);
  assert.equal(d.matches[0].listing.client_name, 'Seller One');
});

test('API: Matches page compares every buyer with every listing, with counts', async () => {
  const d = (await call('GET', '/api/matches')).data;
  assert.equal(d.buyers, 4);
  assert.equal(d.listings, 1);
  assert.equal(d.total, 4, '4 buyers x 1 listing');
  assert.equal(d.counts.great, 1);
  const great = (await call('GET', '/api/matches?level=great')).data;
  assert.equal(great.matches.length, 1);
  assert.equal(great.matches[0].buyer.name, 'Exact Buyer');
});

test('API: properties not "For sale" are left out of matching', async () => {
  await call('PATCH', `/api/properties/${ids.station}`, { details: { listing_status: 'Sold' } });
  assert.equal((await call('GET', '/api/matches')).data.listings, 0);
  assert.equal((await call('GET', `/api/properties/${ids.station}/matches`)).data.for_sale, false);
  await call('PATCH', `/api/properties/${ids.station}`, { details: { listing_status: 'For sale' } });
});

test('API: a buyer & seller is never matched with their own property', async () => {
  const id = (await call('POST', '/api/clients', {
    type: 'both', name: 'Both Ways', details: { budget_max: 500000 },
    properties: [{ address: '9 Self St', details: { asking_price: 500000, property_type: 'Office' } }],
  })).data.id;
  const d = (await call('GET', `/api/clients/${id}/matches`)).data;
  assert.ok(!d.matches.some((m) => m.listing.client_id === id));
});
