// Automated checks for the JRP Client Book API.  Run with:  npm test
// Each run starts a real server on a spare port with a brand-new empty database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jrp-test-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let server;

// A tiny "browser" that remembers its login cookie.
function agent() {
  let cookie = '';
  return async function call(method, url, body, { csrf = true, raw = false } = {}) {
    const headers = {};
    if (csrf) headers['X-JRP'] = '1';
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    if (raw) return res;
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    return { status: res.status, data };
  };
}

const admin = agent();
const staff = agent();
const anon = agent();
const ids = {};

before(async () => {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_DIR, ADMIN_EMAIL: 'boss@test.com', ADMIN_PASSWORD: 'BossPass123', ADMIN_NAME: 'Boss Admin', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server did not start');
});

after(() => {
  server.kill();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

// ---------- login & security ----------
test('pages need a login', async () => {
  assert.equal((await anon('GET', '/api/clients')).status, 401);
  assert.equal((await anon('GET', '/api/me')).status, 401);
});

test('wrong password is rejected, right one works (email not case-sensitive)', async () => {
  assert.equal((await admin('POST', '/api/login', { email: 'boss@test.com', password: 'nope' })).status, 401);
  const r = await admin('POST', '/api/login', { email: 'BOSS@test.com', password: 'BossPass123' });
  assert.equal(r.status, 200);
  assert.equal(r.data.role, 'admin');
});

test('changes without the app header are blocked (stops cross-site attacks)', async () => {
  const r = await admin('POST', '/api/clients', { type: 'buyer', name: 'X' }, { csrf: false });
  assert.equal(r.status, 403);
});

test('admin can add a staff login; staff can log in', async () => {
  const short = await admin('POST', '/api/admin/users', { name: 'P', email: 'p@test.com', password: 'short', role: 'staff' });
  assert.equal(short.status, 400, 'passwords under 8 characters are refused');
  const r = await admin('POST', '/api/admin/users', { name: 'Priya Staff', email: 'priya@test.com', password: 'StaffPass1', role: 'staff' });
  assert.equal(r.status, 200);
  ids.staff = r.data.id;
  const dup = await admin('POST', '/api/admin/users', { name: 'Again', email: 'PRIYA@test.com', password: 'StaffPass1' });
  assert.equal(dup.status, 400, 'same email twice is refused');
  assert.equal((await staff('POST', '/api/login', { email: 'priya@test.com', password: 'StaffPass1' })).status, 200);
});

test('staff cannot open admin pages', async () => {
  assert.equal((await staff('GET', '/api/admin/users')).status, 403);
  assert.equal((await staff('POST', '/api/admin/users', { name: 'Z', email: 'z@test.com', password: 'Whatever123' })).status, 403);
});

// ---------- buyers & sellers ----------
test('add a seller with properties', async () => {
  const r = await staff('POST', '/api/clients', {
    type: 'seller', name: 'Maria Lopez', phone: '(209) 555-0142', email: 'maria@example.com', assigned_agent_id: ids.staff,
    properties: [{ address: '1420 Oak Ave, Modesto, CA' }, { address: '88 River Rd, Turlock, CA' }, { address: '  ' }],
  });
  assert.equal(r.status, 200);
  ids.maria = r.data.id;
  const c = (await staff('GET', `/api/clients/${ids.maria}`)).data;
  assert.equal(c.properties.length, 2, 'blank addresses are skipped');
  assert.equal(c.created_by_name, 'Priya Staff');
  assert.equal(c.agent_name, 'Priya Staff');
  assert.equal(c.activity[0].action, 'created');
});

test('name and type are required', async () => {
  assert.equal((await staff('POST', '/api/clients', { type: 'buyer', name: '' })).status, 400);
  assert.equal((await staff('POST', '/api/clients', { type: 'renter', name: 'Bob' })).status, 400);
});

test('add a buyer', async () => {
  const r = await staff('POST', '/api/clients', { type: 'buyer', name: 'James Carter', phone: '209-555-7781' });
  ids.james = r.data.id;
  assert.ok(ids.james);
});

test('search by name, phone digits, email and property address', async () => {
  const names = async (q) => (await staff('GET', `/api/clients?q=${encodeURIComponent(q)}`)).data.map((c) => c.name);
  assert.deepEqual(await names('maria'), ['Maria Lopez']);
  assert.deepEqual(await names('2095550142'), ['Maria Lopez'], 'phone without dashes');
  assert.deepEqual(await names('555-7781'), ['James Carter'], 'phone with dashes');
  assert.deepEqual(await names('example.com'), ['Maria Lopez']);
  assert.deepEqual(await names('river rd'), ['Maria Lopez'], 'address of 2nd property');
  assert.deepEqual(await names('zzz-nobody'), []);
});

test('filters: buyers, sellers, my clients', async () => {
  const names = async (qs) => (await staff('GET', `/api/clients?${qs}`)).data.map((c) => c.name).sort();
  assert.deepEqual(await names('type=buyer'), ['James Carter']);
  assert.deepEqual(await names('type=seller'), ['Maria Lopez']);
  assert.deepEqual(await names('mine=1'), ['Maria Lopez']);
});

test('editing a client is recorded in history with what changed', async () => {
  await staff('PATCH', `/api/clients/${ids.maria}`, { phone: '(209) 555-9999' });
  const c = (await staff('GET', `/api/clients/${ids.maria}`)).data;
  assert.equal(c.phone, '(209) 555-9999');
  assert.equal(c.activity[0].action, 'edited');
  assert.match(c.activity[0].detail, /Phone/);
  assert.equal(c.activity[0].user_name, 'Priya Staff');
  const found = (await staff('GET', '/api/clients?q=5559999')).data;
  assert.equal(found.length, 1, 'new phone is searchable');
});

// ---------- comments ----------
test('comments save name, date and time automatically', async () => {
  const before = Date.now();
  await staff('POST', `/api/clients/${ids.maria}/comments`, { body: 'Called Maria about spring listing.' });
  const c = (await staff('GET', `/api/clients/${ids.maria}`)).data;
  const m = c.comments[0];
  assert.equal(m.body, 'Called Maria about spring listing.');
  assert.equal(m.author, 'Priya Staff');
  assert.ok(Math.abs(new Date(m.created_at).getTime() - before) < 5000, 'timestamp is now');
  assert.equal(m.property_id, null);
  assert.equal((await staff('POST', `/api/clients/${ids.maria}/comments`, { body: '   ' })).status, 400, 'empty comments refused');
});

test('everyone sees who a client is assigned to and the last note', async () => {
  // Admin (not the assigned agent) looks at the list.
  const rows = (await admin('GET', '/api/clients')).data;
  const maria = rows.find((r) => r.id === ids.maria);
  assert.equal(maria.agent_name, 'Priya Staff');
  assert.equal(maria.last_comment, 'Called Maria about spring listing.');
  assert.equal(maria.last_comment_by, 'Priya Staff');
  assert.ok(maria.last_comment_at);
  const james = rows.find((r) => r.id === ids.james);
  assert.equal(james.agent_name, null);
  assert.equal(james.last_comment, null);
});

test("filter by another employee's clients, or unassigned", async () => {
  const names = async (qs) => (await admin('GET', `/api/clients?${qs}`)).data.map((c) => c.name);
  assert.deepEqual(await names(`agent=${ids.staff}`), ['Maria Lopez']);
  assert.deepEqual(await names('agent=none'), ['James Carter']);
  assert.deepEqual(await names(`agent=${ids.staff}&type=buyer`), [], 'agent and type filters combine');
});

// ---------- property pages ----------
test('property page shows owner and its own comments only', async () => {
  const c = (await staff('GET', `/api/clients/${ids.maria}`)).data;
  ids.oak = c.properties[0].id;
  ids.river = c.properties[1].id;
  await admin('POST', `/api/properties/${ids.oak}/comments`, { body: 'Showing booked Saturday.' });

  const oak = (await staff('GET', `/api/properties/${ids.oak}`)).data;
  assert.equal(oak.client_name, 'Maria Lopez');
  assert.equal(oak.comments.length, 1);
  assert.equal(oak.comments[0].author, 'Boss Admin');

  const river = (await staff('GET', `/api/properties/${ids.river}`)).data;
  assert.equal(river.comments.length, 0, "other property's comments don't leak in");

  const profile = (await staff('GET', `/api/clients/${ids.maria}`)).data;
  assert.equal(profile.comments.length, 2, 'profile shows all comments');
  const tagged = profile.comments.find((m) => m.property_id === ids.oak);
  assert.equal(tagged.property_address, '1420 Oak Ave, Modesto, CA');
  const oakCard = profile.properties.find((p) => p.id === ids.oak);
  assert.equal(oakCard.comment_count, 1);
});

test('add and edit a property from its page', async () => {
  const r = await staff('POST', `/api/clients/${ids.maria}/properties`, { address: '5 New St, Ceres, CA', notes: 'Lot' });
  assert.ok(r.data.id);
  await staff('PATCH', `/api/properties/${r.data.id}`, { address: '5 New Street, Ceres, CA' });
  const p = (await staff('GET', `/api/properties/${r.data.id}`)).data;
  assert.equal(p.address, '5 New Street, Ceres, CA');
  assert.equal(p.notes, 'Lot');
  assert.ok(p.activity.some((a) => a.action === 'property_edited'), 'edit shows in property history');
  ids.newProp = r.data.id;
});

test('unknown ids give a clean "not found"', async () => {
  assert.equal((await staff('GET', '/api/clients/99999')).status, 404);
  assert.equal((await staff('GET', '/api/properties/99999')).status, 404);
  assert.equal((await staff('POST', '/api/properties/99999/comments', { body: 'x' })).status, 404);
});

// ---------- files ----------
test('upload to a property, download it, staff cannot delete it', async () => {
  const fd = new FormData();
  fd.append('files', new Blob(['hello rent roll'], { type: 'application/pdf' }), 'rent-roll.pdf');
  assert.equal((await staff('POST', `/api/properties/${ids.oak}/files`, fd)).status, 200);

  const oak = (await staff('GET', `/api/properties/${ids.oak}`)).data;
  assert.equal(oak.files.length, 1);
  ids.file = oak.files[0].id;
  const profile = (await staff('GET', `/api/clients/${ids.maria}`)).data;
  assert.equal(profile.files[0].property_address, '1420 Oak Ave, Modesto, CA', 'file also on profile, tagged');

  const dl = await staff('GET', `/api/files/${ids.file}`, undefined, { raw: true });
  assert.equal(dl.status, 200);
  assert.equal(await dl.text(), 'hello rent roll');
  assert.match(dl.headers.get('content-disposition'), /attachment/);

  assert.equal((await anon('GET', `/api/files/${ids.file}`, undefined, { raw: true })).status, 401, 'no login, no file');
  assert.equal((await staff('DELETE', `/api/files/${ids.file}`)).status, 403);
});

test('upload with no file is refused', async () => {
  assert.equal((await staff('POST', `/api/clients/${ids.maria}/files`, new FormData())).status, 400);
});

// ---------- admin-only deletes ----------
test('staff cannot delete; admin removing a property keeps its comments on the profile', async () => {
  assert.equal((await staff('DELETE', `/api/properties/${ids.oak}`)).status, 403);
  assert.equal((await staff('DELETE', `/api/clients/${ids.james}`)).status, 403);

  assert.equal((await admin('DELETE', `/api/properties/${ids.oak}`)).status, 200);
  const profile = (await staff('GET', `/api/clients/${ids.maria}`)).data;
  assert.ok(!profile.properties.some((p) => p.id === ids.oak));
  assert.equal(profile.comments.length, 2, 'comments kept');
  assert.equal(profile.files.length, 1, 'files kept');
  assert.equal(profile.activity[0].action, 'property_removed');
});

test('admin can delete a client', async () => {
  assert.equal((await admin('DELETE', `/api/clients/${ids.james}`)).status, 200);
  assert.equal((await staff('GET', `/api/clients/${ids.james}`)).status, 404);
});

// ---------- accounts ----------
test('change my password', async () => {
  assert.equal((await staff('POST', '/api/me/password', { current: 'wrong', next: 'NewPass123' })).status, 400);
  assert.equal((await staff('POST', '/api/me/password', { current: 'StaffPass1', next: 'NewPass123' })).status, 200);
  const fresh = agent();
  assert.equal((await fresh('POST', '/api/login', { email: 'priya@test.com', password: 'NewPass123' })).status, 200);
});

test('admin cannot lock themselves out', async () => {
  const me = (await admin('GET', '/api/me')).data;
  assert.equal((await admin('PATCH', `/api/admin/users/${me.id}`, { role: 'staff' })).status, 400);
  assert.equal((await admin('PATCH', `/api/admin/users/${me.id}`, { active: false })).status, 400);
});

test('switching an employee off logs them out at once; their comments stay', async () => {
  assert.equal((await admin('PATCH', `/api/admin/users/${ids.staff}`, { active: false })).status, 200);
  assert.equal((await staff('GET', '/api/clients')).status, 401, 'kicked out');
  const again = agent();
  assert.equal((await again('POST', '/api/login', { email: 'priya@test.com', password: 'NewPass123' })).status, 401, 'cannot log back in');
  const profile = (await admin('GET', `/api/clients/${ids.maria}`)).data;
  assert.ok(profile.comments.some((m) => m.author === 'Priya Staff'), 'history kept');
});

test('too many wrong passwords locks the login for a while', async () => {
  const a = agent();
  for (let i = 0; i < 8; i++) await a('POST', '/api/login', { email: 'boss@test.com', password: 'bad' });
  assert.equal((await a('POST', '/api/login', { email: 'boss@test.com', password: 'BossPass123' })).status, 429);
});

test('logout ends the session', async () => {
  const b = agent();
  await admin('POST', '/api/admin/users', { name: 'Second Admin', email: 'two@test.com', password: 'TwoPass123', role: 'admin' });
  assert.equal((await b('POST', '/api/login', { email: 'two@test.com', password: 'TwoPass123' })).status, 200);
  assert.equal((await b('GET', '/api/me')).status, 200);
  await b('POST', '/api/logout');
  assert.equal((await b('GET', '/api/me')).status, 401);
});

test('the app page and phone-install files are served', async () => {
  for (const p of ['/', '/app.js', '/styles.css', '/manifest.webmanifest', '/sw.js', '/icons/icon-192.png', '/img/logo-white.png', '/fonts/space-grotesk.woff2']) {
    const r = await fetch(BASE + p);
    assert.equal(r.status, 200, p);
  }
  const html = await (await fetch(`${BASE}/client/5`)).text();
  assert.match(html, /JRP Client Book/, 'any page address loads the app');
});
