// JRP Client Book — main server.
// Serves the app (public/) and a JSON API under /api.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { db, UPLOAD_DIR, logActivity } = require('./src/db');
const SqliteStore = require('./src/sessionStore');
const match = require('./src/match');
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
    },
  },
}));
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
  res.json(db.prepare('SELECT id, name FROM users WHERE active = 1 ORDER BY name').all());
});

// ---------- admin: manage employees ----------
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, name, email, role, active, created_at FROM users ORDER BY active DESC, name').all());
});

app.post('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const name = clean(req.body.name, 100);
  const email = clean(req.body.email, 200).toLowerCase();
  const role = req.body.role === 'admin' ? 'admin' : 'staff';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!name || !email.includes('@')) return fail(res, 400, 'Name and a valid email are required');
  if (password.length < 8) return fail(res, 400, 'Password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return fail(res, 400, 'That email already has an account');
  const r = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
    .run(name, email, bcrypt.hashSync(password, 12), role);
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
  db.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').run(name || user.name, role, active, id);
  if (newPw) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPw, 12), id);
  // Deactivated users are logged out automatically: requireAuth checks "active" on every request.
  res.json({ ok: true });
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
app.get('/api/matches', requireAuth, (req, res) => {
  const level = ['great', 'good', 'average', 'poor', 'incomplete'].includes(req.query.level) ? req.query.level : '';
  const mine = req.query.mine === '1';
  const buyers = match.loadBuyers(db);
  const listings = match.loadListings(db);
  const counts = { great: 0, good: 0, average: 0, poor: 0, incomplete: 0 };
  let rows = [];
  for (const b of buyers) {
    for (const l of listings) {
      if (b.id === l.client_id) continue;
      const m = match.compare(b, l);
      if (mine && b.assigned_agent_id !== req.user.id && l.assigned_agent_id !== req.user.id) continue;
      counts[m.level] += 1;
      if (level && m.level !== level) continue;
      rows.push({ buyer: match.buyerSummary(b), listing: match.listingSummary(l), ...m });
    }
  }
  rows.sort(match.sortMatches);
  const total = rows.length;
  rows = rows.slice(0, 300);
  res.json({ counts, total, buyers: buyers.length, listings: listings.length, matches: rows });
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
  console.error(err);
  fail(res, 500, 'Something went wrong');
});

app.listen(PORT, () => console.log(`JRP Client Book running on http://localhost:${PORT}`));
