// Insurance for JRP's own properties: policies, expiry status, renewal PDFs, alerts.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, UPLOAD_DIR } = require('./db');
const { readWorkbook, serialToDate } = require('./xlsx');

const INS_DIR = path.join(UPLOAD_DIR, 'insurance');
fs.mkdirSync(INS_DIR, { recursive: true });

db.exec(`
CREATE TABLE IF NOT EXISTS ins_properties (
  id         INTEGER PRIMARY KEY,
  address    TEXT NOT NULL,
  kind       TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ins_files (
  id            INTEGER PRIMARY KEY,
  property_id   INTEGER REFERENCES ins_properties(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  size          INTEGER,
  pages         INTEGER,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ins_policies (
  id            INTEGER PRIMARY KEY,
  property_id   INTEGER NOT NULL REFERENCES ins_properties(id) ON DELETE CASCADE,
  coverage      TEXT,
  carrier       TEXT,
  policy_number TEXT,
  start_date    TEXT,
  end_date      TEXT,
  premium       REAL,
  agent         TEXT,
  notes         TEXT,
  is_current    INTEGER NOT NULL DEFAULT 1,
  file_id       INTEGER REFERENCES ins_files(id) ON DELETE SET NULL,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ins_pol_prop ON ins_policies(property_id);
CREATE TABLE IF NOT EXISTS ins_alerts (
  policy_id INTEGER NOT NULL REFERENCES ins_policies(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL,
  sent_at   TEXT NOT NULL,
  PRIMARY KEY (policy_id, kind)
);
CREATE TABLE IF NOT EXISTS ins_log (
  id          INTEGER PRIMARY KEY,
  property_id INTEGER REFERENCES ins_properties(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  detail      TEXT,
  created_at  TEXT NOT NULL
);
`);

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const TZ = process.env.TZ_OFFICE || 'America/Los_Angeles';
// Today's date at the office, as YYYY-MM-DD.
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dayNum = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);
const daysLeft = (end) => (end ? dayNum(end) - dayNum(today()) : null);

function log(propertyId, userId, action, detail) {
  db.prepare('INSERT INTO ins_log (property_id, user_id, action, detail, created_at) VALUES (?,?,?,?,?)')
    .run(propertyId, userId || null, action, detail || null, now());
}

// ---------- dates & money from text ----------
function toISODate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v > 20000 && v < 80000 ? serialToDate(v) : null;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) return valid(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  return null;
}
function valid(y, mo, d) {
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return dt.toISOString().slice(0, 10);
}
function toMoney(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n * 100) / 100 : null;
}
const cleanText = (v, max = 300) => (v === null || v === undefined ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, max) || null);

// ---------- status ----------
const ORDER = { expired: 0, due30: 1, nodate: 2, due90: 3, active: 4, none: 5, info: 6 };
function policyStatus(p) {
  const d = daysLeft(p.end_date);
  if (d === null) return 'nodate';
  if (d < 0) return 'expired';
  if (d <= 30) return 'due30';
  if (d <= 90) return 'due90';
  return 'active';
}
const isLandLike = (kind) => /land|agri|farm/i.test(kind || '');

function policyRow(p) {
  return { ...p, days_left: daysLeft(p.end_date), status: policyStatus(p) };
}

function listProperties() {
  const props = db.prepare('SELECT * FROM ins_properties ORDER BY address COLLATE NOCASE').all();
  const pols = db.prepare('SELECT * FROM ins_policies WHERE is_current = 1').all().map(policyRow);
  const byProp = new Map();
  for (const p of pols) { if (!byProp.has(p.property_id)) byProp.set(p.property_id, []); byProp.get(p.property_id).push(p); }
  return props.map((pr) => {
    const current = (byProp.get(pr.id) || []).sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.days_left ?? 1e9) - (b.days_left ?? 1e9));
    const status = current.length ? current[0].status : isLandLike(pr.kind) ? 'info' : 'none';
    return { ...pr, status, policies: current, next: current[0] || null };
  }).sort((a, b) => ORDER[a.status] - ORDER[b.status]
    || (a.next && b.next ? (a.next.days_left ?? 1e9) - (b.next.days_left ?? 1e9) : 0)
    || a.address.localeCompare(b.address));
}

function summary() {
  const c = { expired: 0, due30: 0, due90: 0, nodate: 0, active: 0, none: 0, info: 0 };
  for (const p of listProperties()) c[p.status] += 1;
  return c;
}

function getProperty(id) {
  const pr = db.prepare('SELECT * FROM ins_properties WHERE id = ?').get(Number(id));
  if (!pr) return null;
  const all = db.prepare(`SELECT p.*, f.original_name AS file_name, f.pages AS file_pages, u.name AS created_by_name
    FROM ins_policies p LEFT JOIN ins_files f ON f.id = p.file_id LEFT JOIN users u ON u.id = p.created_by
    WHERE p.property_id = ? ORDER BY p.is_current DESC, COALESCE(p.end_date, '') DESC, p.id DESC`).all(pr.id).map(policyRow);
  const files = db.prepare(`SELECT f.*, u.name AS uploaded_by_name FROM ins_files f LEFT JOIN users u ON u.id = f.uploaded_by
    WHERE f.property_id = ? ORDER BY f.id DESC`).all(pr.id);
  const history = db.prepare(`SELECT l.*, u.name AS user_name FROM ins_log l LEFT JOIN users u ON u.id = l.user_id
    WHERE l.property_id = ? ORDER BY l.id DESC LIMIT 100`).all(pr.id);
  const current = all.filter((p) => p.is_current);
  const status = current.length
    ? current.slice().sort((a, b) => ORDER[a.status] - ORDER[b.status])[0].status
    : isLandLike(pr.kind) ? 'info' : 'none';
  return { ...pr, status, current, past: all.filter((p) => !p.is_current), files, history };
}

// ---------- saving policies ----------
const POLICY_FIELDS = ['coverage', 'carrier', 'policy_number', 'start_date', 'end_date', 'premium', 'agent', 'notes'];
function cleanPolicy(input) {
  const o = input || {};
  return {
    coverage: cleanText(o.coverage, 100),
    carrier: cleanText(o.carrier, 150),
    policy_number: cleanText(o.policy_number, 80),
    start_date: toISODate(o.start_date),
    end_date: toISODate(o.end_date),
    premium: toMoney(o.premium),
    agent: cleanText(o.agent, 200),
    notes: o.notes ? String(o.notes).trim().slice(0, 4000) || null : null,
  };
}

// Add a policy. replaceIds: the policies this one renews (they move to history).
function addPolicy(propertyId, userId, input, { fileId = null, replaceIds = [] } = {}) {
  const p = cleanPolicy(input);
  return db.transaction(() => {
    for (const rid of replaceIds) {
      db.prepare('UPDATE ins_policies SET is_current = 0, updated_at = ? WHERE id = ? AND property_id = ?').run(now(), Number(rid), propertyId);
    }
    const r = db.prepare(`INSERT INTO ins_policies (property_id, ${POLICY_FIELDS.join(', ')}, is_current, file_id, created_by, created_at, updated_at)
      VALUES (?, ${POLICY_FIELDS.map(() => '?').join(', ')}, 1, ?, ?, ?, ?)`)
      .run(propertyId, ...POLICY_FIELDS.map((k) => p[k]), fileId, userId || null, now(), now());
    if (fileId) db.prepare('UPDATE ins_files SET property_id = ? WHERE id = ?').run(propertyId, fileId);
    log(propertyId, userId, replaceIds.length ? 'renewed' : 'policy_added',
      `${p.carrier || 'Policy'}${p.policy_number ? ` ${p.policy_number}` : ''}${p.end_date ? `, expires ${p.end_date}` : ''}`);
    return Number(r.lastInsertRowid);
  })();
}

function updatePolicy(id, userId, input) {
  const old = db.prepare('SELECT * FROM ins_policies WHERE id = ?').get(Number(id));
  if (!old) return null;
  const p = cleanPolicy({ ...old, ...input });
  db.prepare(`UPDATE ins_policies SET ${POLICY_FIELDS.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...POLICY_FIELDS.map((k) => p[k]), now(), old.id);
  if (input.file_id !== undefined) {
    const fid = input.file_id ? Number(input.file_id) : null;
    db.prepare('UPDATE ins_policies SET file_id = ? WHERE id = ?').run(fid, old.id);
    if (fid) db.prepare('UPDATE ins_files SET property_id = ? WHERE id = ?').run(old.property_id, fid);
  }
  const changed = POLICY_FIELDS.filter((k) => String(old[k] ?? '') !== String(p[k] ?? ''));
  if (old.end_date !== p.end_date) db.prepare('DELETE FROM ins_alerts WHERE policy_id = ?').run(old.id); // new date = new reminders
  if (changed.length) log(old.property_id, userId, 'policy_edited', `Changed ${changed.join(', ').replace(/_/g, ' ')}`);
  return old.property_id;
}

// ---------- PDF files ----------
function saveFile(buffer, originalName, userId, propertyId = null, pages = null) {
  const stored = `${crypto.randomUUID()}.pdf`;
  fs.writeFileSync(path.join(INS_DIR, stored), buffer);
  const r = db.prepare(`INSERT INTO ins_files (property_id, original_name, stored_name, size, pages, uploaded_by, created_at)
    VALUES (?,?,?,?,?,?,?)`).run(propertyId, String(originalName || 'policy.pdf').slice(0, 200), stored, buffer.length, pages, userId || null, now());
  return Number(r.lastInsertRowid);
}
const filePath = (f) => path.join(INS_DIR, f.stored_name);

let pdfjsP = null;
const pdfjs = () => (pdfjsP = pdfjsP || import('pdfjs-dist/legacy/build/pdf.mjs'));

// Text of every page (up to maxPages). Scanned PDFs give empty text.
async function pdfPagesText(buffer, maxPages = 500) {
  const { getDocument } = await pdfjs();
  const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const out = [];
  try {
    const n = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= n; i += 1) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let s = '';
      for (const it of tc.items) s += it.str + (it.hasEOL ? '\n' : ' ');
      out.push(s.replace(/[ \t]+/g, ' '));
      page.cleanup();
    }
    return { pages: out, total: doc.numPages };
  } finally { await task.destroy(); }
}

const CARRIERS = ['Safeco', 'Travelers', 'Nationwide', 'State Farm', 'Mercury', 'Allstate', 'Farmers', 'Universal', 'AEGIS', 'Steadily', 'Steadly',
  'Berkshire Hathaway', 'Zenith', 'Liberty Mutual', 'Progressive', 'Hartford', 'Chubb', 'CNA', 'Hanover', 'Kemper', 'Foremost', 'Lemonade',
  'Hippo', 'USAA', 'GEICO', 'Employers', 'biBERK', 'Markel', 'AmTrust', 'Philadelphia', 'Great American', 'Erie', 'American Family',
  'Encompass', 'Stillwater', 'Openly', 'Bamboo', 'Next Insurance', 'Hiscox', 'Cincinnati', 'Auto-Owners', 'Westfield', 'Selective',
  'Utica', 'Burns & Wilcox', 'Lloyd', 'Scottsdale', 'Nautilus', 'Kinsale', 'Capitol Specialty', 'Mt. Hawley', 'Guard', 'Pie Insurance', 'CSAA', 'AAA'];
const normPol = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Best guess at the policy details on a declarations page. Agents always confirm before saving.
function guessFields(text, known = []) {
  const t = text.replace(/\s+/g, ' ');
  const g = {};
  // 1) A policy number we already know (renewals usually keep it).
  const flat = normPol(t);
  for (const k of known) {
    const n = normPol(k.policy_number);
    if (n.length >= 5 && flat.includes(n)) { g.policy_number = k.policy_number; g.matched_policy_id = k.id; g.carrier = k.carrier; break; }
  }
  if (!g.policy_number) {
    const m = /Policy\s*(?:Number|No\.?|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9 -]{4,28}[A-Z0-9])/i.exec(t);
    if (m) g.policy_number = m[1].replace(/\s+(Policy|Named|Effective|Period|Agent|Insured|Page|Date)\b.*$/i, '').trim();
  }
  // 2) Policy period: two dates 6 or 12 months apart, preferring ones near "period / effective / expiration".
  const dates = [];
  for (const m of t.matchAll(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.? \d{1,2},? \d{4})\b/gi)) {
    let iso = toISODate(m[1]);
    if (!iso) { const d = new Date(`${m[1].replace(/Sept/i, 'Sep')} UTC`); iso = Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null; }
    if (iso) dates.push({ iso, at: m.index });
  }
  let best = null;
  for (let i = 0; i < dates.length && i < 80; i += 1) {
    for (let j = i + 1; j < Math.min(dates.length, i + 6); j += 1) {
      const gap = dayNum(dates[j].iso) - dayNum(dates[i].iso);
      const term = gap >= 360 && gap <= 370 ? 12 : gap >= 178 && gap <= 186 ? 6 : 0;
      if (!term) continue;
      const near = /period|effective|expir|term|from/i.test(t.slice(Math.max(0, dates[i].at - 60), dates[i].at)) ? 1 : 0;
      const score = near * 1000 - dates[i].at / 1000 + (term === 12 ? 1 : 0);
      if (!best || score > best.score) best = { start: dates[i].iso, end: dates[j].iso, score };
    }
  }
  if (best) { g.start_date = best.start; g.end_date = best.end; }
  // 3) Premium.
  const pm = /(?:Total\s+(?:Policy\s+|Annual\s+|Estimated\s+)?Premium|Annual\s+Premium|Policy\s+Premium|Total\s+(?:Amount|Cost))[^$\d]{0,40}\$?\s*([\d,]+\.\d{2}|[\d,]{3,})/i.exec(t);
  if (pm) g.premium = toMoney(pm[1]);
  // 4) Carrier name.
  if (!g.carrier) {
    let first = null;
    for (const c of CARRIERS) {
      const i = t.search(new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
      if (i >= 0 && (!first || i < first.i)) first = { c, i };
    }
    if (first) g.carrier = first.c === 'Steadly' ? 'Steadily' : first.c;
  }
  return g;
}

// Which insured property does this page belong to? (policy numbers first, then street addresses)
function propertyHints() {
  const props = db.prepare('SELECT id, address FROM ins_properties').all();
  const pols = db.prepare('SELECT property_id, policy_number FROM ins_policies WHERE policy_number IS NOT NULL').all();
  const byNumber = pols.map((p) => ({ id: p.property_id, key: normPol(p.policy_number) })).filter((x) => x.key.length >= 6);
  const byAddress = props.map((p) => {
    const m = /(\d{2,6})\s+(?:[NSEW]\.?\s+)?([A-Za-z]{3,})/.exec(p.address);
    return m ? { id: p.id, re: new RegExp(`\\b${m[1]}\\s+(?:[NSEW]\\.?\\s+)?${m[2]}`, 'i') } : null;
  }).filter(Boolean);
  // One policy can cover several properties (e.g. a combined business policy), so this returns a list.
  return (text) => {
    const flat = normPol(text);
    const byNum = [...new Set(byNumber.filter((x) => flat.includes(x.key)).map((x) => x.id))];
    const byAddr = byAddress.filter((x) => x.re.test(text)).map((x) => x.id);
    if (byNum.length) {
      const keys = [...new Set(byNumber.filter((x) => flat.includes(x.key)).map((x) => x.key))];
      return { ids: byNum, by: 'policy number', keys };
    }
    return byAddr.length ? { ids: [...new Set(byAddr)], by: 'address', address_ids: byAddr } : null;
  };
}

// Split a big PDF: group pages by the property they mention.
async function analyzeBigPdf(buffer) {
  const { pages, total } = await pdfPagesText(buffer, 1000);
  const hint = propertyHints();
  const perPage = pages.map((txt, i) => {
    const h = hint(txt);
    return {
      page: i + 1, property_ids: h ? h.ids : [], by: h ? h.by : null, keys: h && h.keys ? h.keys : [],
      // A declarations page names the policy period ("Policy Period: From 05-10-2026 To 05-10-2027").
      dec: /policy\s+period|policy\s+term|effective\s+date[\s\S]{0,80}expiration\s+date/i.test(txt), chars: txt.trim().length, snippet: txt.replace(/\s+/g, ' ').trim().slice(0, 140),
    };
  });
  // Pages with no match join the group before them (forms continue onto following pages).
  const groups = [];
  const key = (ids) => ids.slice().sort((a, b) => a - b).join(',');
  for (const p of perPage) {
    const last = groups[groups.length - 1];
    if (last && (!p.property_ids.length || key(p.property_ids) === key(last.property_ids))) { last.to = p.page; continue; }
    groups.push({ from: p.page, to: p.page, property_ids: p.property_ids });
  }
  for (const g of groups) {
    const inG = perPage.filter((p) => p.page >= g.from && p.page <= g.to);
    g.dec_pages = inG.filter((p) => p.dec).map((p) => p.page);
    g.keys = [...new Set(inG.flatMap((p) => p.keys))];
  }
  return { total, scanned: pages.every((t) => t.trim().length < 20), pages: perPage, groups };
}

// Copy some pages (1-based page numbers) into a new PDF.
async function extractPages(buffer, pageNumbers) {
  const { PDFDocument } = require('pdf-lib');
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const n = src.getPageCount();
  const list = [...new Set(pageNumbers.map(Number))].filter((x) => Number.isInteger(x) && x >= 1 && x <= n).sort((a, b) => a - b);
  if (!list.length) throw new Error(`Those pages are not in this PDF (it has ${n} pages).`);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, list.map((x) => x - 1));
  copied.forEach((p) => out.addPage(p));
  return { buffer: Buffer.from(await out.save()), pages: list.length };
}
// Save already-cut pages to a property and attach them to the right current policy
// (the one whose policy number is on those pages, else the one still missing a PDF).
// The same file name on the same property is not saved twice.
// isDeclarations: only declarations pages replace a policy's existing one-click PDF.
function savePagesTo(propertyId, pdfBuffer, fileName, pageCount, userId, keys = [], note = '', isDeclarations = true) {
  const dup = db.prepare('SELECT id FROM ins_files WHERE property_id = ? AND original_name = ?').get(propertyId, fileName);
  if (dup) return { file_id: dup.id, duplicate: true };
  const fileId = saveFile(pdfBuffer, fileName, userId, propertyId, pageCount);
  const cur = db.prepare('SELECT * FROM ins_policies WHERE property_id = ? AND is_current = 1').all(propertyId);
  const pick = cur.find((p) => keys.includes(normPol(p.policy_number)))
    || cur.slice().sort((a, b) => (a.file_id ? 1 : 0) - (b.file_id ? 1 : 0) || (a.end_date || '9999').localeCompare(b.end_date || '9999'))[0];
  const attach = pick && (!pick.file_id || isDeclarations);
  if (attach) db.prepare('UPDATE ins_policies SET file_id = ? WHERE id = ?').run(fileId, pick.id);
  log(propertyId, userId, 'file_uploaded', note || fileName);
  return { file_id: fileId, policy_id: attach ? pick.id : null };
}

// "39-49, 51" -> [39..49, 51]
function parsePageList(s, max) {
  const out = [];
  for (const part of String(s || '').split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]); const b = Number(m[2] || m[1]);
    for (let i = Math.min(a, b); i <= Math.max(a, b) && i <= max && out.length < 2000; i += 1) out.push(i);
  }
  return out;
}

// ---------- Excel import ----------
const normAddr = (s) => String(s || '').toLowerCase().replace(/\b(ca|california)\b/g, '').replace(/\b\d{5}\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function headerMap(row) {
  const h = (row || []).map((v) => String(v ?? '').toLowerCase().trim());
  const find = (...res) => h.findIndex((x) => x && res.some((re) => re.test(x)));
  return {
    address: find(/address/, /location/), kind: find(/property type/, /^type$/), carrier: find(/company/, /carrier/, /issued by/, /issueed by/),
    policy: find(/policy (number|no|#)/), start: find(/start/, /effective/), end: find(/end date/, /^end/, /expir/), premium: find(/premium/, /^amount$/),
    notes: find(/renewal notes/, /^notes/), agent: find(/^agent/), insured: find(/named insured/), status: find(/^status/),
  };
}

function importWorkbook(buffer, userId) {
  const sheets = readWorkbook(buffer);
  const result = { properties_added: 0, policies_added: 0, policies_updated: 0, renewals: 0, sheets: [] };
  const findProp = (address) => db.prepare('SELECT * FROM ins_properties').all().find((p) => normAddr(p.address) === normAddr(address));
  const getOrAddProp = (address, kind, note) => {
    let p = findProp(address);
    if (p) return p;
    const r = db.prepare('INSERT INTO ins_properties (address, kind, notes, created_at) VALUES (?,?,?,?)').run(cleanText(address, 300), cleanText(kind, 80), cleanText(note, 500), now());
    result.properties_added += 1;
    p = db.prepare('SELECT * FROM ins_properties WHERE id = ?').get(Number(r.lastInsertRowid));
    log(p.id, userId, 'imported', 'Added from Excel');
    return p;
  };
  const upsert = (prop, row, isRenewSheet) => {
    const pol = cleanPolicy(row);
    if (!pol.carrier && !pol.policy_number) return;
    const key = normPol(pol.policy_number);
    const existing = db.prepare('SELECT * FROM ins_policies WHERE property_id = ?').all(prop.id)
      .filter((p) => (key ? normPol(p.policy_number) === key : (p.carrier || '').toLowerCase() === (pol.carrier || '').toLowerCase()));
    const same = existing.find((p) => (p.end_date || '') === (pol.end_date || ''));
    if (same) {
      const fill = {};
      for (const k of POLICY_FIELDS) if ((same[k] === null || same[k] === '') && pol[k] !== null) fill[k] = pol[k];
      if (Object.keys(fill).length) { updatePolicy(same.id, userId, fill); result.policies_updated += 1; }
      return;
    }
    if (isRenewSheet && !pol.end_date) return; // renew sheet rows without new dates = nothing new yet
    const current = existing.filter((p) => p.is_current);
    const newer = !current.length || current.every((p) => (p.end_date || '') < (pol.end_date || '9999'));
    if (!newer) {
      // An older term than the one on file: keep it as history.
      db.prepare(`INSERT INTO ins_policies (property_id, ${POLICY_FIELDS.join(', ')}, is_current, created_by, created_at, updated_at)
        VALUES (?, ${POLICY_FIELDS.map(() => '?').join(', ')}, 0, ?, ?, ?)`).run(prop.id, ...POLICY_FIELDS.map((k) => pol[k]), userId || null, now(), now());
      result.policies_added += 1;
      return;
    }
    addPolicy(prop.id, userId, pol, { replaceIds: current.map((p) => p.id) });
    if (current.length) result.renewals += 1; else result.policies_added += 1;
  };

  // Main sheets first, then "Renew" sheets so newer terms win.
  const relevant = sheets.filter((s) => /insur|vehicle/i.test(s.name) && !/dec details|summary|tax/i.test(s.name))
    .sort((a, b) => (/renew/i.test(a.name) ? 1 : 0) - (/renew/i.test(b.name) ? 1 : 0));
  for (const sh of relevant) {
    const hi = sh.rows.findIndex((r) => { const m = headerMap(r); return m.policy >= 0 && (m.address >= 0 || m.insured >= 0); });
    if (hi < 0) continue;
    const m = headerMap(sh.rows[hi]);
    const title = (sh.rows.slice(0, hi).flat().filter(Boolean).join(' ') + ' ' + sh.name).toLowerCase();
    const isRenew = /renew/i.test(sh.name);
    let count = 0;
    for (const r of sh.rows.slice(hi + 1)) {
      const get = (i) => (i >= 0 ? r[i] : null);
      let address = cleanText(get(m.address), 300);
      if (!address && m.insured >= 0 && get(m.insured)) address = `${/vehicle|mercury|auto/.test(title) ? 'Vehicles – ' : ''}${cleanText(get(m.insured), 200)}`;
      if (!address) continue;
      address = address.replace(/^\d+\)\s*/, '');
      const kind = cleanText(get(m.kind), 80) || (/vehicle|mercury|auto/.test(title) ? 'Vehicles' : null);
      const prop = getOrAddProp(address, kind, cleanText(get(m.status), 500));
      const coverage = kind && prop.kind && kind.toLowerCase() !== prop.kind.toLowerCase() ? kind : null;
      upsert(prop, {
        coverage, carrier: get(m.carrier), policy_number: get(m.policy) === null ? null : String(get(m.policy)).replace(/\.0$/, ''),
        start_date: get(m.start), end_date: get(m.end), premium: get(m.premium), agent: get(m.agent), notes: get(m.notes),
      }, isRenew);
      count += 1;
    }
    result.sheets.push({ name: sh.name.trim(), rows: count });
  }
  return result;
}

// ---------- alerts ----------
const THRESHOLDS = [60, 30, 14, 7, 1];
// The alert a policy should have had by now: d60 … d1, then "expired".
function dueAlert(p) {
  const d = daysLeft(p.end_date);
  if (d === null) return null;
  if (d < 0) return { kind: 'expired', d };
  if (d === 0) return { kind: 'today', d };
  const t = THRESHOLDS.filter((x) => d <= x).pop();
  return t ? { kind: `d${t}`, d } : null;
}
const fmtUS = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : '');

// Finds alerts not sent yet, records them, and returns what to tell people.
function collectAlerts() {
  const rows = db.prepare(`SELECT p.*, pr.address FROM ins_policies p JOIN ins_properties pr ON pr.id = p.property_id
    WHERE p.is_current = 1 AND p.end_date IS NOT NULL`).all();
  const fresh = [];
  for (const p of rows) {
    const a = dueAlert(p);
    if (!a) continue;
    const had = db.prepare('SELECT 1 FROM ins_alerts WHERE policy_id = ? AND kind = ?').get(p.id, a.kind);
    if (had) continue;
    db.prepare('INSERT OR IGNORE INTO ins_alerts (policy_id, kind, sent_at) VALUES (?,?,?)').run(p.id, a.kind, now());
    fresh.push({ ...a, property_id: p.property_id, address: p.address, end_date: p.end_date, carrier: p.carrier });
  }
  if (!fresh.length) return null;
  fresh.sort((a, b) => a.d - b.d); // expired first
  if (fresh.length === 1) {
    const f = fresh[0];
    const when = f.kind === 'expired' ? `EXPIRED on ${fmtUS(f.end_date)}` : f.kind === 'today' ? 'expires TODAY' : `expires in ${f.d} day${f.d === 1 ? '' : 's'} (${fmtUS(f.end_date)})`;
    return { title: `🛡 Insurance ${f.kind === 'expired' ? 'expired' : 'due'}`, body: `${f.address}: ${when}`, url: `/#/insurance/${f.property_id}`, tag: `ins-${f.property_id}` };
  }
  const exp = fresh.filter((f) => f.kind === 'expired').length;
  const due = fresh.length - exp;
  return {
    title: '🛡 Insurance needs attention',
    body: [exp && `${exp} expired`, due && `${due} expiring soon`].filter(Boolean).join(', ') + `: ${fresh.slice(0, 3).map((f) => f.address).join('; ')}${fresh.length > 3 ? '…' : ''}`,
    url: '/#/insurance', tag: 'ins-summary',
  };
}

module.exports = {
  INS_DIR, today, daysLeft, policyStatus, listProperties, summary, getProperty, addPolicy, updatePolicy, cleanPolicy,
  saveFile, savePagesTo, normPol, propertyHints, filePath, pdfPagesText, guessFields, analyzeBigPdf, extractPages, parsePageList, importWorkbook, collectAlerts, dueAlert, log, toISODate,
};
