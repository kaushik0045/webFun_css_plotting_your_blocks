// JRP Client Book — main server.
// Serves the app (public/) and a JSON API under /api.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { db, UPLOAD_DIR, logActivity } = require('./src/db');
const SqliteStore = require('./src/sessionStore');
const match = require('./src/match');
const push = require('./src/push');
match.backfillCategories(db);
const { LEVELS } = require('./src/questions');

const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 20);

if (IS_PROD && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET must be set in production.');
  process.exit(1);
}

// First admin account: created automatically from environment variables if there are no users yet.
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
      .run(ADMIN_NAME || 'Admin', ADMIN_EMAIL.trim(), bcrypt.hashSync(ADMIN_PASSWORD, 12), 'admin');
    console.log(`Created first admin account: ${ADMIN_EMAIL}`);
  } else {
    console.warn('No users exist yet. Run "npm run create-admin" or set ADMIN_EMAIL and ADMIN_PASSWORD.');
  }
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      styleSrc: ["'self'"],
      styleSrcAttr: ["'unsafe-inline'"],
      scriptSrc: ["'self'"],
      // Only force https when live. On a Mac over Wi-Fi (http://192.168.x.x:3000) it would
      // make phones ask for https files that don't exist, leaving a blank page.
      upgradeInsecureRequests: IS_PROD ? [] : null,
    },
  },
  strictTransportSecurity: IS_PROD,
}));
app.use(compression());
app.use(express.json({ limit: '200kb' }));
app.use(session({
  store: new SqliteStore(db),
  secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  name: 'jrp.sid',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: 12 * 60 * 60 * 1000 },
}));

// ---------- helpers ----------
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const clean = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const digits = (v) => (v || '').replace(/\D/g, '');
const fail = (res, code, msg) => res.status(code).json({ error: msg });

// Every successful change bumps dataVersion, so cached match results are rebuilt.
let dataVersion = 0;
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 400) dataVersion += 1; });
  next();
});

// Blocks cross-site form posts: every change request from our app sends this header.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-JRP') !== '1') return fail(res, 403, 'Bad request origin');
  next();
});

function requireAuth(req, res, next) {
  const uid = req.session.userId;
  if (!uid) return fail(res, 401, 'Please log in');
  const user = db.prepare('SELECT id, name, email, role, active FROM users WHERE id = ?').get(uid);
  if (!user || !user.active) { req.session.destroy(() => {}); return fail(res, 401, 'Please log in'); }
  req.user = user;
  next();
}
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return fail(res, 403, 'Admins only');
  next();
}
function getClient(id) {
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(id));
}

// ---------- auth ----------
const attempts = new Map(); // simple brute-force protection
app.post('/api/login', (req, res) => {
  const email = clean(req.body.email, 200).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const key = `${req.ip}|${email}`;
  const a = attempts.get(key) || { n: 0, until: 0 };
  if (a.until > Date.now()) return fail(res, 429, 'Too many attempts. Try again in 15 minutes.');

  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
    return fail(res, 401, 'No employee logins exist in this copy of the app yet. In Terminal run "npm run demo-data" (sample data) or "npm run create-admin".');
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !user.active || !bcrypt.compareSync(password, user.password_hash)) {
    a.n += 1;
    if (a.n >= 8) { a.until = Date.now() + 15 * 60 * 1000; a.n = 0; }
    attempts.set(key, a);
    return fail(res, 401, 'Wrong email or password');
  }
  attempts.delete(key);
  req.session.regenerate((err) => {
    if (err) return fail(res, 500, 'Login failed');
    req.session.userId = user.id;
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), user.id);
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => { res.clearCookie('jrp.sid'); res.json({ ok: true }); });
});

app.get('/api/me', requireAuth, (req, res) => res.json(req.user));

app.post('/api/me/password', requireAuth, (req, res) => {
  const { current, next: newPw } = req.body;
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(current || ''), row.password_hash)) return fail(res, 400, 'Current password is wrong');
  if (typeof newPw !== 'string' || newPw.length < 8) return fail(res, 400, 'New password must be at least 8 characters');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPw, 12), req.user.id);
  res.json({ ok: true });
});

// List of employees (for the "assigned agent" dropdown).
app.get('/api/agents', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT id, name, title, role FROM users WHERE active = 1 ORDER BY name').all());
});

// ---------- admin: manage employees ----------
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT u.id, u.name, u.email, u.role, u.active, u.created_at, u.phone, u.title, u.last_login_at,
      (SELECT COUNT(*) FROM clients c WHERE c.assigned_agent_id = u.id) AS client_count,
      (SELECT COUNT(*) FROM reminders r WHERE r.user_id = u.id AND r.done_at IS NULL AND r.due_at < strftime('%Y-%m-%dT%H:%M:%SZ','now')) AS overdue_reminders
    FROM users u ORDER BY u.active DESC, u.name`).all());
});

app.post('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const name = clean(req.body.name, 100);
  const email = clean(req.body.email, 200).toLowerCase();
  const role = req.body.role === 'admin' ? 'admin' : 'staff';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!name || !email.includes('@')) return fail(res, 400, 'Name and a valid email are required');
  if (password.length < 8) return fail(res, 400, 'Password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return fail(res, 400, 'That email already has an account');
  const r = db.prepare('INSERT INTO users (name, email, password_hash, role, phone, title) VALUES (?,?,?,?,?,?)')
    .run(name, email, bcrypt.hashSync(password, 12), role, clean(req.body.phone, 50) || null, clean(req.body.title, 80) || null);
  res.json({ id: r.lastInsertRowid });
});

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return fail(res, 404, 'Not found');
  const name = req.body.name !== undefined ? clean(req.body.name, 100) : user.name;
  const role = req.body.role !== undefined ? (req.body.role === 'admin' ? 'admin' : 'staff') : user.role;
  const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : user.active;
  if (id === req.user.id && (role !== 'admin' || !active)) return fail(res, 400, "You can't remove your own admin access");
  const newPw = typeof req.body.password === 'string' ? req.body.password : '';
  if (newPw && newPw.length < 8) return fail(res, 400, 'Password must be at least 8 characters');
  const phone = req.body.phone !== undefined ? clean(req.body.phone, 50) || null : user.phone;
  const title = req.body.title !== undefined ? clean(req.body.title, 80) || null : user.title;
  db.prepare('UPDATE users SET name = ?, role = ?, active = ?, phone = ?, title = ? WHERE id = ?').run(name || user.name, role, active, phone, title, id);
  if (newPw) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPw, 12), id);
  // Deactivated users are logged out automatically: requireAuth checks "active" on every request.
  res.json({ ok: true });
});

// Reset a password: makes a new temporary one, shown to the admin once (it is never stored readable).
const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function tempPassword() {
  let out = '';
  const bytes = crypto.randomBytes(10);
  for (const b of bytes) out += PW_CHARS[b % PW_CHARS.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}
app.post('/api/admin/users/:id/reset-password', requireAuth, requireAdmin, (req, res) => {
  const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(Number(req.params.id));
  if (!user) return fail(res, 404, 'Not found');
  const pw = tempPassword();
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(pw, 12), user.id);
  // log them out everywhere (exact match on this user's id, so user 1 doesn't also hit 10, 11, ...)
  for (const row of db.prepare('SELECT sid, data FROM sessions').all()) {
    try { if (JSON.parse(row.data).userId === user.id) db.prepare('DELETE FROM sessions WHERE sid = ?').run(row.sid); } catch { /* skip bad rows */ }
  }
  res.json({ password: pw });
});

// ---------- office chat ----------
// Channels: 'announce' (admins post, all read), 'team' (everyone), 'dm:<low>-<high>' (two people only).
function parseChannel(ch, me) {
  if (ch === 'announce' || ch === 'team') return { ch, kind: ch };
  const m = /^dm:(\d+)-(\d+)$/.exec(String(ch || ''));
  if (!m) return null;
  const a = Number(m[1]); const b = Number(m[2]);
  if (a >= b || (me.id !== a && me.id !== b)) return null; // only the two people in it
  return { ch, kind: 'dm', otherId: me.id === a ? b : a };
}
const dmChannel = (x, y) => `dm:${Math.min(x, y)}-${Math.max(x, y)}`;
const lastReadStmt = () => db.prepare('SELECT last_read_id FROM chat_reads WHERE user_id = ? AND channel = ?');
function markRead(userId, ch, id) {
  db.prepare(`INSERT INTO chat_reads (user_id, channel, last_read_id) VALUES (?,?,?)
    ON CONFLICT(user_id, channel) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`).run(userId, ch, id);
}
function unreadIn(userId, ch) {
  const lr = (lastReadStmt().get(userId, ch) || { last_read_id: 0 }).last_read_id;
  return db.prepare('SELECT COUNT(*) AS n FROM messages WHERE channel = ? AND id > ? AND (sender_id IS NULL OR sender_id != ?)').get(ch, lr, userId).n;
}
function myChannels(user) {
  const people = db.prepare('SELECT id, name, title, role, active FROM users WHERE id != ? ORDER BY name').all(user.id);
  const list = [
    { channel: 'announce', kind: 'announce', title: 'Announcements', subtitle: 'From management to everyone' },
    { channel: 'team', kind: 'team', title: 'Team chat', subtitle: 'Everyone in the office' },
  ];
  for (const p of people) {
    const ch = dmChannel(user.id, p.id);
    // show switched-off colleagues only if there is history with them
    if (!p.active && !db.prepare('SELECT 1 FROM messages WHERE channel = ? LIMIT 1').get(ch)) continue;
    list.push({ channel: ch, kind: 'dm', title: p.name, subtitle: p.title || (p.role === 'admin' ? 'Admin' : 'Agent'), other: p });
  }
  return list;
}
const msgSelect = `SELECT m.id, m.channel, m.body, m.created_at, m.sender_id, u.name AS sender_name, u.title AS sender_title,
    m.client_id, c.name AS client_name, c.type AS client_type
  FROM messages m LEFT JOIN users u ON u.id = m.sender_id LEFT JOIN clients c ON c.id = m.client_id`;

app.get('/api/chat', requireAuth, (req, res) => {
  const convs = myChannels(req.user).map((c) => {
    const last = db.prepare(`${msgSelect} WHERE m.channel = ? ORDER BY m.id DESC LIMIT 1`).get(c.channel);
    return { ...c, last: last || null, unread: unreadIn(req.user.id, c.channel) };
  });
  // fixed channels first, then people with the most recent conversation
  const fixed = convs.slice(0, 2);
  const dms = convs.slice(2).sort((a, b) => (b.last ? b.last.id : 0) - (a.last ? a.last.id : 0) || a.title.localeCompare(b.title));
  const all = [...fixed, ...dms];
  res.json({ total_unread: all.reduce((n, c) => n + c.unread, 0), conversations: all });
});

// Small and fast: just the badge numbers, polled while the app is open.
app.get('/api/chat/unread', requireAuth, (req, res) => {
  const chans = myChannels(req.user);
  let total = 0;
  let newest = null; // the newest unread message from anyone, for the pop-up
  for (const c of chans) {
    const n = unreadIn(req.user.id, c.channel);
    if (!n) continue;
    total += n;
    const m = db.prepare(`${msgSelect} WHERE m.channel = ? AND (m.sender_id IS NULL OR m.sender_id != ?) ORDER BY m.id DESC LIMIT 1`)
      .get(c.channel, req.user.id);
    if (m && (!newest || m.id > newest.id)) newest = { ...m, kind: c.kind, title: c.title };
  }
  const announce = unreadIn(req.user.id, 'announce');
  let latest = null;
  if (announce) latest = db.prepare(`${msgSelect} WHERE m.channel = 'announce' ORDER BY m.id DESC LIMIT 1`).get();
  res.json({ total, announce, latest_announcement: latest || null, newest });
});

function seenStats(msgs) {
  // For announcements: how many active colleagues (not the sender) have read each one.
  const people = db.prepare('SELECT id FROM users WHERE active = 1').all().map((u) => u.id);
  const reads = new Map(db.prepare("SELECT user_id, last_read_id FROM chat_reads WHERE channel = 'announce'").all().map((r) => [r.user_id, r.last_read_id]));
  for (const m of msgs) {
    const audience = people.filter((id) => id !== m.sender_id);
    m.seen_count = audience.filter((id) => (reads.get(id) || 0) >= m.id).length;
    m.audience = audience.length;
  }
}

app.get('/api/chat/c/:channel', requireAuth, (req, res) => {
  const c = parseChannel(req.params.channel, req.user);
  if (!c) return fail(res, 404, 'Conversation not found');
  const after = Number(req.query.after) || 0;
  let msgs;
  if (after) {
    msgs = db.prepare(`${msgSelect} WHERE m.channel = ? AND m.id > ? ORDER BY m.id LIMIT 200`).all(c.ch, after);
  } else {
    msgs = db.prepare(`${msgSelect} WHERE m.channel = ? ORDER BY m.id DESC LIMIT 150`).all(c.ch).reverse();
  }
  if (c.kind === 'announce' && req.user.role === 'admin') seenStats(msgs);
  const top = db.prepare('SELECT MAX(id) AS id FROM messages WHERE channel = ?').get(c.ch).id;
  if (top) markRead(req.user.id, c.ch, top); // opening a conversation = reading it
  let other = null;
  if (c.kind === 'dm') {
    other = db.prepare('SELECT id, name, title, phone, active FROM users WHERE id = ?').get(c.otherId);
    if (other && req.user.role !== 'admin') delete other.phone; // contact details are for admins only
  }
  if (c.kind === 'dm' && !other) return fail(res, 404, 'Conversation not found');
  res.json({ channel: c.ch, kind: c.kind, other, can_post: c.kind !== 'announce' || req.user.role === 'admin', messages: msgs });
});

app.post('/api/chat/c/:channel', requireAuth, (req, res) => {
  const c = parseChannel(req.params.channel, req.user);
  if (!c) return fail(res, 404, 'Conversation not found');
  if (c.kind === 'announce' && req.user.role !== 'admin') return fail(res, 403, 'Only admins can post announcements');
  if (c.kind === 'dm') {
    const other = db.prepare('SELECT active FROM users WHERE id = ?').get(c.otherId);
    if (!other) return fail(res, 404, 'Conversation not found');
    if (!other.active) return fail(res, 400, 'This employee is switched off and can no longer receive messages');
  }
  const body = clean(req.body.body, 2000);
  let clientId = req.body.client_id ? Number(req.body.client_id) : null;
  if (clientId && !getClient(clientId)) clientId = null;
  if (!body && !clientId) return fail(res, 400, 'Message is empty');
  const r = db.prepare('INSERT INTO messages (channel, sender_id, body, client_id, created_at) VALUES (?,?,?,?,?)')
    .run(c.ch, req.user.id, body || '', clientId, now());
  markRead(req.user.id, c.ch, r.lastInsertRowid);
  const msg = db.prepare(`${msgSelect} WHERE m.id = ?`).get(r.lastInsertRowid);
  if (c.kind === 'announce') seenStats([msg]); // so "Seen by 0 of N" shows straight away
  res.json(msg);
  // Phone notifications: the other person for a private message, everyone else for team chat / announcements.
  const to = c.kind === 'dm' ? [c.otherId]
    : db.prepare('SELECT id FROM users WHERE active = 1 AND id != ?').all(req.user.id).map((u) => u.id);
  const text = msg.body || (msg.client_name ? `Shared a client: ${msg.client_name}` : '');
  const title = c.kind === 'announce' ? `📢 Announcement from ${req.user.name}`
    : c.kind === 'team' ? `${req.user.name} in Team chat` : req.user.name;
  push.notify(to, {
    title,
    body: (msg.body && msg.client_name ? `${text}\n(About ${msg.client_name})` : text).slice(0, 240),
    url: `/#/chat/${encodeURIComponent(c.ch)}`,
    tag: c.ch,
    id: msg.id,
  }).catch(() => {});
});

// ---------- notifications (Web Push) ----------
app.get('/api/push/key', requireAuth, (req, res) => res.json({ publicKey: push.publicKey, devices: push.countFor(req.user.id) }));
app.post('/api/push/subscribe', requireAuth, (req, res) => {
  if (!push.validSubscription(req.body.subscription)) return fail(res, 400, 'This browser sent an invalid notification subscription');
  push.save(req.user.id, req.body.subscription);
  res.json({ ok: true, devices: push.countFor(req.user.id) });
});
app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
  push.remove(req.body.endpoint, req.user.id);
  res.json({ ok: true });
});
app.post('/api/push/test', requireAuth, async (req, res) => {
  const results = await push.notify([req.user.id], { title: 'JRP Client Book', body: 'Notifications are working ✅', url: '/#/chat', tag: 'test' });
  res.json({ sent: results.filter(Boolean).length, devices: results.length });
});

// Who has / hasn't seen an announcement (admins).
app.get('/api/chat/announce/:id/seen', requireAuth, requireAdmin, (req, res) => {
  const m = db.prepare("SELECT id, sender_id FROM messages WHERE id = ? AND channel = 'announce'").get(Number(req.params.id));
  if (!m) return fail(res, 404, 'Not found');
  const rows = db.prepare(`SELECT u.id, u.name, COALESCE(r.last_read_id, 0) >= ? AS seen
    FROM users u LEFT JOIN chat_reads r ON r.user_id = u.id AND r.channel = 'announce'
    WHERE u.active = 1 AND u.id != COALESCE(?, -1) ORDER BY u.name`).all(m.id, m.sender_id);
  res.json({ seen: rows.filter((r) => r.seen).map((r) => r.name), not_seen: rows.filter((r) => !r.seen).map((r) => r.name) });
});

// ---------- clients (buyers & sellers) ----------
app.get('/api/clients', requireAuth, (req, res) => {
  const q = clean(req.query.q, 100);
  const type = ['buyer', 'seller'].includes(req.query.type) ? req.query.type : '';
  const mine = req.query.mine === '1';
  const where = [];
  const params = {};
  if (q) {
    params.like = `%${q}%`;
    const d = digits(q);
    const parts = ['c.name LIKE @like', 'c.email LIKE @like', 'c.mailing_address LIKE @like',
      'EXISTS (SELECT 1 FROM properties p WHERE p.client_id = c.id AND p.address LIKE @like)'];
    if (d.length >= 3) { params.dlike = `%${d}%`; parts.push('c.phone_digits LIKE @dlike'); }
    where.push(`(${parts.join(' OR ')})`);
  }
  if (type) { where.push("(c.type = @type OR c.type = 'both')"); params.type = type; }
  if (mine) { where.push('c.assigned_agent_id = @me'); params.me = req.user.id; }
  if (req.query.agent === 'none') where.push('c.assigned_agent_id IS NULL');
  else if (/^\d+$/.test(req.query.agent || '')) { where.push('c.assigned_agent_id = @agent'); params.agent = Number(req.query.agent); }
  const sql = `
    SELECT c.id, c.type, c.name, c.phone, c.email, c.updated_at,
           u.name AS agent_name,
           (SELECT address FROM properties p WHERE p.client_id = c.id ORDER BY p.id LIMIT 1) AS first_property,
           (SELECT COUNT(*) FROM properties p WHERE p.client_id = c.id) AS property_count,
           lc.created_at AS last_comment_at, lc.body AS last_comment, lu.name AS last_comment_by
    FROM clients c
    LEFT JOIN users u ON u.id = c.assigned_agent_id
    LEFT JOIN comments lc ON lc.id = (SELECT m.id FROM comments m WHERE m.client_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1)
    LEFT JOIN users lu ON lu.id = lc.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${q ? 'c.name' : 'c.updated_at DESC'}
    LIMIT 100`;
  res.json(db.prepare(sql).all(params));
});

function readClientBody(body, existing = {}) {
  const pick = (k, max) => (body[k] !== undefined ? clean(body[k], max) : existing[k] || '');
  const type = body.type !== undefined ? body.type : existing.type;
  let agent = body.assigned_agent_id !== undefined ? body.assigned_agent_id : existing.assigned_agent_id;
  agent = agent ? Number(agent) : null;
  if (agent && !db.prepare('SELECT 1 FROM users WHERE id = ?').get(agent)) agent = null;
  return {
    type: ['buyer', 'seller', 'both'].includes(type) ? type : null,
    name: pick('name', 150),
    phone: pick('phone', 50),
    email: pick('email', 200),
    mailing_address: pick('mailing_address', 300),
    assigned_agent_id: agent,
  };
}

app.post('/api/clients', requireAuth, (req, res) => {
  const c = readClientBody(req.body);
  if (!c.name) return fail(res, 400, 'Name is required');
  if (!c.type) return fail(res, 400, 'Choose buyer, seller or both');
  const tx = db.transaction(() => {
    const details = c.type === 'seller' ? {} : match.cleanDetails(match.BUYER_QUESTIONS, req.body.details);
    const r = db.prepare(`INSERT INTO clients (type, name, phone, phone_digits, email, mailing_address, assigned_agent_id, created_by, details)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(c.type, c.name, c.phone, digits(c.phone), c.email, c.mailing_address, c.assigned_agent_id, req.user.id, JSON.stringify(details));
    const id = r.lastInsertRowid;
    const props = Array.isArray(req.body.properties) ? req.body.properties : [];
    for (const p of props.slice(0, 50)) {
      const address = clean(p && p.address, 300);
      const pd = match.cleanDetails(match.SELLER_QUESTIONS, p && p.details);
      if (!pd.listing_status) pd.listing_status = c.type === 'buyer' ? 'Not for sale' : 'For sale';
      if (address) db.prepare('INSERT INTO properties (client_id, address, notes, created_by, details) VALUES (?,?,?,?,?)')
        .run(id, address, clean(p.notes, 1000), req.user.id, JSON.stringify(pd));
    }
    logActivity(id, req.user.id, 'created', `Added ${c.type} "${c.name}"`);
    return id;
  });
  res.json({ id: tx() });
});

app.get('/api/clients/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const client = db.prepare(`
    SELECT c.*, a.name AS agent_name, cb.name AS created_by_name
    FROM clients c
    LEFT JOIN users a ON a.id = c.assigned_agent_id
    LEFT JOIN users cb ON cb.id = c.created_by
    WHERE c.id = ?`).get(id);
  if (!client) return fail(res, 404, 'Client not found');
  delete client.phone_digits;
  client.properties = db.prepare(`SELECT p.*, u.name AS created_by_name,
      (SELECT COUNT(*) FROM comments m WHERE m.property_id = p.id) AS comment_count,
      (SELECT COUNT(*) FROM files f WHERE f.property_id = p.id) AS file_count,
      (SELECT MAX(created_at) FROM comments m WHERE m.property_id = p.id) AS last_comment_at
    FROM properties p LEFT JOIN users u ON u.id = p.created_by WHERE p.client_id = ? ORDER BY p.id`).all(id);
  client.details = match.parseDetails(client.details);
  const buyers = match.loadBuyers(db);
  for (const p of client.properties) {
    p.details = match.parseDetails(p.details);
    p.for_sale = ['seller', 'both'].includes(client.type) && match.isForSale(p);
    if (p.for_sale) {
      const listing = { ...p, details: p.details };
      const counts = { great: 0, good: 0 };
      for (const b of buyers) {
        if (b.id === client.id) continue;
        const m = match.compare(b, listing);
        if (m.level in counts) counts[m.level] += 1;
      }
      p.match_counts = counts;
    }
  }
  Object.assign(client, timeline('client_id', id));
  client.reminders = db.prepare(`SELECT r.id, r.due_at, r.note, r.user_id, u.name AS agent_name,
      CASE WHEN r.user_id = ? THEN r.cal_key END AS cal_key
    FROM reminders r JOIN users u ON u.id = r.user_id
    WHERE r.client_id = ? AND r.done_at IS NULL ORDER BY r.due_at`).all(req.user.id, id);
  res.json(client);
});

// Comments, files and history for a client (all of them) or for one property.
function timeline(column, id) {
  return {
    comments: db.prepare(`SELECT m.id, m.body, m.created_at, m.property_id, p.address AS property_address, u.name AS author
      FROM comments m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN properties p ON p.id = m.property_id
      WHERE m.${column} = ? ORDER BY m.created_at DESC, m.id DESC`).all(id),
    files: db.prepare(`SELECT f.id, f.original_name, f.mime, f.size, f.created_at, f.property_id, p.address AS property_address, u.name AS uploaded_by
      FROM files f LEFT JOIN users u ON u.id = f.user_id LEFT JOIN properties p ON p.id = f.property_id
      WHERE f.${column} = ? ORDER BY f.id DESC`).all(id),
    activity: db.prepare(`SELECT a.action, a.detail, a.created_at, a.property_id, u.name AS user_name
      FROM activity a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.${column} = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 200`).all(id),
  };
}

app.patch('/api/clients/:id', requireAuth, (req, res) => {
  const existing = getClient(req.params.id);
  if (!existing) return fail(res, 404, 'Client not found');
  const c = readClientBody(req.body, existing);
  if (!c.name) return fail(res, 400, 'Name is required');
  if (!c.type) return fail(res, 400, 'Choose buyer, seller or both');
  const labels = { type: 'Type', name: 'Name', phone: 'Phone', email: 'Email', mailing_address: 'Mailing address', assigned_agent_id: 'Assigned agent' };
  const changed = Object.keys(labels).filter((k) => String(c[k] ?? '') !== String(existing[k] ?? ''));
  const oldDetails = match.parseDetails(existing.details);
  const newDetails = req.body.details !== undefined ? match.cleanDetails(match.BUYER_QUESTIONS, req.body.details, oldDetails) : oldDetails;
  const changedAnswers = match.changedLabels(match.BUYER_QUESTIONS, oldDetails, newDetails);
  if (!changed.length && !changedAnswers.length) return res.json({ ok: true });
  db.prepare(`UPDATE clients SET type=?, name=?, phone=?, phone_digits=?, email=?, mailing_address=?, assigned_agent_id=?, details=?, updated_at=? WHERE id=?`)
    .run(c.type, c.name, c.phone, digits(c.phone), c.email, c.mailing_address, c.assigned_agent_id, JSON.stringify(newDetails), now(), existing.id);
  if (changed.length) logActivity(existing.id, req.user.id, 'edited', `Changed: ${changed.map((k) => labels[k]).join(', ')}`);
  if (changedAnswers.length) logActivity(existing.id, req.user.id, 'edited', `Updated buyer answers: ${changedAnswers.join(', ')}`);
  res.json({ ok: true });
});

app.delete('/api/clients/:id', requireAuth, requireAdmin, (req, res) => {
  const c = getClient(req.params.id);
  if (!c) return fail(res, 404, 'Client not found');
  const files = db.prepare('SELECT stored_name FROM files WHERE client_id = ?').all(c.id);
  db.prepare('DELETE FROM clients WHERE id = ?').run(c.id);
  for (const f of files) fs.rm(path.join(UPLOAD_DIR, f.stored_name), { force: true }, () => {});
  res.json({ ok: true });
});

// ---------- properties / sites ----------
app.post('/api/clients/:id/properties', requireAuth, (req, res) => {
  const c = getClient(req.params.id);
  if (!c) return fail(res, 404, 'Client not found');
  const address = clean(req.body.address, 300);
  if (!address) return fail(res, 400, 'Address is required');
  const pd = match.cleanDetails(match.SELLER_QUESTIONS, req.body.details);
  if (!pd.listing_status) pd.listing_status = c.type === 'buyer' ? 'Not for sale' : 'For sale';
  const r = db.prepare('INSERT INTO properties (client_id, address, notes, created_by, details) VALUES (?,?,?,?,?)')
    .run(c.id, address, clean(req.body.notes, 1000), req.user.id, JSON.stringify(pd));
  db.prepare('UPDATE clients SET updated_at = ? WHERE id = ?').run(now(), c.id);
  logActivity(c.id, req.user.id, 'property_added', address, r.lastInsertRowid);
  res.json({ id: r.lastInsertRowid });
});

// One property's own page: details, owner, and its comments, files and history.
app.get('/api/properties/:id', requireAuth, (req, res) => {
  const p = db.prepare(`SELECT p.*, u.name AS created_by_name, c.name AS client_name, c.type AS client_type,
      c.phone AS client_phone, c.email AS client_email
    FROM properties p JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = p.created_by
    WHERE p.id = ?`).get(Number(req.params.id));
  if (!p) return fail(res, 404, 'Property not found');
  p.details = match.parseDetails(p.details);
  p.for_sale = ['seller', 'both'].includes(p.client_type) && match.isForSale(p);
  Object.assign(p, timeline('property_id', p.id));
  res.json(p);
});

app.patch('/api/properties/:id', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM properties WHERE id = ?').get(Number(req.params.id));
  if (!p) return fail(res, 404, 'Not found');
  const address = req.body.address !== undefined ? clean(req.body.address, 300) : p.address;
  const notes = req.body.notes !== undefined ? clean(req.body.notes, 1000) : p.notes;
  if (!address) return fail(res, 400, 'Address is required');
  const oldDetails = match.parseDetails(p.details);
  const newDetails = req.body.details !== undefined ? match.cleanDetails(match.SELLER_QUESTIONS, req.body.details, oldDetails) : oldDetails;
  const changedAnswers = match.changedLabels(match.SELLER_QUESTIONS, oldDetails, newDetails);
  db.prepare('UPDATE properties SET address = ?, notes = ?, details = ? WHERE id = ?').run(address, notes, JSON.stringify(newDetails), p.id);
  db.prepare('UPDATE clients SET updated_at = ? WHERE id = ?').run(now(), p.client_id);
  if (address !== p.address || notes !== p.notes) {
    logActivity(p.client_id, req.user.id, 'property_edited', address === p.address ? address : `${p.address} → ${address}`, p.id);
  }
  if (changedAnswers.length) logActivity(p.client_id, req.user.id, 'property_edited', `${address}: updated ${changedAnswers.join(', ')}`, p.id);
  res.json({ ok: true });
});

app.delete('/api/properties/:id', requireAuth, requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM properties WHERE id = ?').get(Number(req.params.id));
  if (!p) return fail(res, 404, 'Not found');
  db.prepare('DELETE FROM properties WHERE id = ?').run(p.id);
  logActivity(p.client_id, req.user.id, 'property_removed', p.address);
  res.json({ ok: true });
});

// ---------- comments / remarks ----------
function addComment(req, res, clientId, propertyId) {
  const body = clean(req.body.body, 5000);
  if (!body) return fail(res, 400, 'Comment is empty');
  const t = now();
  db.prepare('INSERT INTO comments (client_id, property_id, user_id, body, created_at) VALUES (?,?,?,?,?)')
    .run(clientId, propertyId, req.user.id, body, t);
  db.prepare('UPDATE clients SET updated_at = ? WHERE id = ?').run(t, clientId);
  res.json({ ok: true });
}
app.post('/api/clients/:id/comments', requireAuth, (req, res) => {
  const c = getClient(req.params.id);
  if (!c) return fail(res, 404, 'Client not found');
  addComment(req, res, c.id, null);
});
app.post('/api/properties/:id/comments', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM properties WHERE id = ?').get(Number(req.params.id));
  if (!p) return fail(res, 404, 'Property not found');
  addComment(req, res, p.client_id, p.id);
});

// ---------- reminders ("call this person on ...") ----------
const reminderRow = (id) => db.prepare(`SELECT r.*, c.name AS client_name, c.phone AS client_phone, c.type AS client_type, u.name AS agent_name
  FROM reminders r JOIN clients c ON c.id = r.client_id JOIN users u ON u.id = r.user_id WHERE r.id = ?`).get(Number(id));

app.post('/api/clients/:id/reminders', requireAuth, (req, res) => {
  const c = getClient(req.params.id);
  if (!c) return fail(res, 404, 'Client not found');
  const when = new Date(String(req.body.due_at || ''));
  if (Number.isNaN(when.getTime())) return fail(res, 400, 'Pick a date and time for the reminder');
  const yearMs = 366 * 24 * 3600e3;
  if (when.getTime() < Date.now() - 24 * 3600e3 || when.getTime() > Date.now() + 2 * yearMs) return fail(res, 400, 'Pick a date between today and two years from now');
  const due = when.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const note = clean(req.body.note, 500);
  const r = db.prepare('INSERT INTO reminders (client_id, user_id, due_at, note, cal_key) VALUES (?,?,?,?,?)')
    .run(c.id, req.user.id, due, note || null, crypto.randomBytes(18).toString('base64url'));
  logActivity(c.id, req.user.id, 'reminder_set', due);
  const row = reminderRow(r.lastInsertRowid);
  res.json({ id: row.id, due_at: row.due_at, note: row.note, client_id: row.client_id, cal_key: row.cal_key });
});

// My open reminders (overdue first), for the home screen.
app.get('/api/reminders', requireAuth, (req, res) => {
  res.json(db.prepare(`SELECT r.id, r.due_at, r.note, r.client_id, r.cal_key, c.name AS client_name, c.phone AS client_phone, c.type AS client_type
    FROM reminders r JOIN clients c ON c.id = r.client_id
    WHERE r.user_id = ? AND r.done_at IS NULL ORDER BY r.due_at LIMIT 100`).all(req.user.id));
});

app.patch('/api/reminders/:id', requireAuth, (req, res) => {
  const r = reminderRow(req.params.id);
  if (!r) return fail(res, 404, 'Reminder not found');
  if (r.user_id !== req.user.id && req.user.role !== 'admin') return fail(res, 403, 'Only the agent who set this reminder can change it');
  if (req.body.done) {
    if (!r.done_at) {
      db.prepare('UPDATE reminders SET done_at = ? WHERE id = ?').run(now(), r.id);
      logActivity(r.client_id, req.user.id, 'reminder_done', r.due_at);
    }
  }
  res.json({ ok: true });
});

// Calendar file (.ics). iPhone shows "Add to Calendar"; Android opens it in the calendar app.
const icsText = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const icsTime = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function icsFold(line) { // calendar lines must be at most 75 characters
  const out = [];
  while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); }
  out.push(line);
  return out.join('\r\n');
}
// Opened either with the agent's login, or with the reminder's own secret key (?k=...).
app.get('/api/reminders/:id/calendar.ics', (req, res, next) => {
  const r = reminderRow(req.params.id);
  const k = typeof req.query.k === 'string' ? req.query.k : '';
  if (r && r.cal_key && k && k.length === r.cal_key.length
    && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(r.cal_key))) { req.reminder = r; return next(); }
  return requireAuth(req, res, () => {
    if (!r) return fail(res, 404, 'Reminder not found');
    if (r.user_id !== req.user.id && req.user.role !== 'admin') return fail(res, 403, 'Not your reminder');
    req.reminder = r;
    next();
  });
}, (req, res) => {
  const r = req.reminder;
  const start = new Date(r.due_at);
  const end = new Date(start.getTime() + 15 * 60e3);
  const link = `${req.protocol}://${req.get('host')}/#/client/${r.client_id}`;
  const desc = [`Call ${r.client_name}${r.client_phone ? ` at ${r.client_phone}` : ''}.`, r.note || '', `Open in JRP Client Book: ${link}`].filter(Boolean).join('\n');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JRP//Client Book//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:jrp-reminder-${r.id}@jrp-client-book`,
    `DTSTAMP:${icsTime(new Date().toISOString())}`,
    `DTSTART:${icsTime(start.toISOString())}`,
    `DTEND:${icsTime(end.toISOString())}`,
    `SUMMARY:${icsText(`Call ${r.client_name}`)}`,
    `DESCRIPTION:${icsText(desc)}`,
    `URL:${link}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(`Call ${r.client_name}`)}`, 'TRIGGER:-PT15M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].map(icsFold);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="call-${String(r.client_name).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics"`);
  res.send(lines.join('\r\n') + '\r\n');
});

// ---------- questions & matching ----------
app.get('/api/questions', requireAuth, (req, res) => {
  res.json({ seller: match.SELLER_QUESTIONS, buyer: match.BUYER_QUESTIONS, levels: LEVELS });
});

// All properties for sale, ranked for one buyer.
app.get('/api/clients/:id/matches', requireAuth, (req, res) => {
  const c = getClient(req.params.id);
  if (!c) return fail(res, 404, 'Client not found');
  if (!['buyer', 'both'].includes(c.type)) return res.json({ buyer: false, matches: [] });
  const buyer = match.loadBuyers(db).find((b) => b.id === c.id);
  const out = match.loadListings(db).filter((l) => l.client_id !== c.id)
    .map((l) => ({ listing: match.listingSummary(l), ...match.compare(buyer, l) }))
    .sort(match.sortMatches);
  res.json({ buyer: true, matches: out });
});

// All buyers, ranked for one property.
app.get('/api/properties/:id/matches', requireAuth, (req, res) => {
  const listing = match.loadListings(db).find((l) => l.id === Number(req.params.id));
  if (!listing) return res.json({ for_sale: false, matches: [] });
  const out = match.loadBuyers(db).filter((b) => b.id !== listing.client_id)
    .map((b) => ({ buyer: match.buyerSummary(b), ...match.compare(b, listing) }))
    .sort(match.sortMatches);
  res.json({ for_sale: true, matches: out });
});

// Every buyer x every listing, for the Matches page.
// Scores for all pairs are worked out once per data version (fast, no sentences),
// then only the rows actually sent get their full "See why" explanation.
let pairCache = { version: -1, rows: null, buyers: 0, listings: 0 };
function allPairs() {
  if (pairCache.version === dataVersion) return pairCache;
  const buyers = match.loadBuyers(db);
  const listings = match.loadListings(db);
  const rows = [];
  for (const b of buyers) {
    for (const l of listings) {
      if (b.id === l.client_id) continue;
      const m = match.compare(b, l, false);
      rows.push({ b, l, score: m.score, level: m.level });
    }
  }
  rows.sort(match.sortMatches);
  pairCache = { version: dataVersion, rows, buyers: buyers.length, listings: listings.length };
  return pairCache;
}

app.get('/api/matches', requireAuth, (req, res) => {
  const level = ['great', 'good', 'average', 'poor', 'incomplete'].includes(req.query.level) ? req.query.level : '';
  const mine = req.query.mine === '1';
  const { rows, buyers, listings } = allPairs();
  const counts = { great: 0, good: 0, average: 0, poor: 0, incomplete: 0 };
  const picked = [];
  for (const r of rows) {
    if (mine && r.b.assigned_agent_id !== req.user.id && r.l.assigned_agent_id !== req.user.id) continue;
    counts[r.level] += 1;
    if (!level || r.level === level) picked.push(r);
  }
  const shown = picked.slice(0, 300).map((r) => ({ buyer: match.buyerSummary(r.b), listing: match.listingSummary(r.l), ...match.compare(r.b, r.l) }));
  res.json({ counts, total: picked.length, buyers, listings, matches: shown });
});

// ---------- files ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 10 },
});

function handleUpload(req, res, clientId, propertyId) {
  upload.array('files', 10)(req, res, (err) => {
    if (err) return fail(res, 400, err.code === 'LIMIT_FILE_SIZE' ? `Each file must be under ${MAX_UPLOAD_MB} MB` : 'Upload failed');
    const files = req.files || [];
    if (!files.length) return fail(res, 400, 'No file selected');
    const ins = db.prepare('INSERT INTO files (client_id, property_id, user_id, original_name, stored_name, mime, size) VALUES (?,?,?,?,?,?,?)');
    for (const f of files) {
      const name = Buffer.from(f.originalname, 'latin1').toString('utf8').slice(0, 200);
      ins.run(clientId, propertyId, req.user.id, name, f.filename, f.mimetype, f.size);
      logActivity(clientId, req.user.id, 'file_uploaded', name, propertyId);
    }
    db.prepare('UPDATE clients SET updated_at = ? WHERE id = ?').run(now(), clientId);
    res.json({ ok: true });
  });
}
app.post('/api/clients/:id/files', requireAuth, (req, res) => {
  const c = getClient(req.params.id);
  if (!c) return fail(res, 404, 'Client not found');
  handleUpload(req, res, c.id, null);
});
app.post('/api/properties/:id/files', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM properties WHERE id = ?').get(Number(req.params.id));
  if (!p) return fail(res, 404, 'Property not found');
  handleUpload(req, res, p.client_id, p.id);
});

app.get('/api/files/:id', requireAuth, (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.id));
  if (!f) return fail(res, 404, 'File not found');
  const full = path.join(UPLOAD_DIR, f.stored_name);
  if (!fs.existsSync(full)) return fail(res, 404, 'File missing on disk');
  const inline = req.query.view === '1' && /^(image\/(png|jpeg|gif|webp|heic)|application\/pdf)$/.test(f.mime || '');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', inline ? f.mime : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
  fs.createReadStream(full).pipe(res);
});

app.delete('/api/files/:id', requireAuth, requireAdmin, (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.id));
  if (!f) return fail(res, 404, 'File not found');
  db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
  fs.rm(path.join(UPLOAD_DIR, f.stored_name), { force: true }, () => {});
  logActivity(f.client_id, req.user.id, 'file_removed', f.original_name, f.property_id);
  res.json({ ok: true });
});

// ---------- front end ----------
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use('/api', (req, res) => fail(res, 404, 'Not found'));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  // Problems with what the browser sent are the sender's fault (4xx), not a server error.
  if (err && err.type === 'entity.too.large') return fail(res, 413, 'That is too much text to save at once.');
  if (err && err.type === 'entity.parse.failed') return fail(res, 400, 'The request could not be read. Please try again.');
  console.error(err);
  fail(res, 500, 'Something went wrong');
});

// Start the server. If the port is taken (usually another copy of this app still
// running in another Terminal window), say so clearly instead of pretending to start.
function startupFailed(err) {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`\n*** Could not start: port ${PORT} is already in use. ***`);
    console.error('Another copy of JRP Client Book (or another app) is probably still running.');
    console.error('Close every other Terminal window (or press Control + C in it), then run "npm run dev" again.\n');
  } else {
    console.error('Could not start the server:', err);
  }
  process.exit(1);
}
const server = app.listen(PORT, (err) => {
  if (err) return startupFailed(err);
  console.log(`JRP Client Book running on http://localhost:${PORT}`);
});
server.on('error', startupFailed);
