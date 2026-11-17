// Invoices for JRP's properties (admins): upload, 3 questions (property, paid?, who paid),
// "remind me to pay" with a phone notification and a calendar file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { db, UPLOAD_DIR } = require('./db');
const ins = require('./insurance');

const INV_DIR = path.join(UPLOAD_DIR, 'invoices');
fs.mkdirSync(INV_DIR, { recursive: true });

db.exec(`
CREATE TABLE IF NOT EXISTS invoices (
  id             INTEGER PRIMARY KEY,
  property_id    INTEGER REFERENCES ins_properties(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'unpaid',   -- 'paid' | 'unpaid'
  paid_by        TEXT,
  paid_on        TEXT,
  vendor         TEXT,
  invoice_number TEXT,
  amount         REAL,
  due_date       TEXT,
  notes          TEXT,
  original_name  TEXT NOT NULL,
  stored_name    TEXT NOT NULL,
  mime           TEXT,
  size           INTEGER,
  remind_at      TEXT,
  remind_user    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  remind_sent    INTEGER NOT NULL DEFAULT 0,
  cal_key        TEXT,
  uploaded_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE TABLE IF NOT EXISTS invoice_log (
  id         INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);
`);

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const clean = (v, max = 200) => (v === null || v === undefined ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, max) || null);
const money = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n * 100) / 100 : null;
};
const isoOrNull = (v) => { const d = v ? new Date(v) : null; return d && Number.isFinite(d.getTime()) ? d.toISOString() : null; };
const log = (id, uid, action, detail) => db.prepare('INSERT INTO invoice_log (invoice_id, user_id, action, detail, created_at) VALUES (?,?,?,?,?)')
  .run(id, uid || null, action, detail || null, now());

// What kind of file is it? (checked by its first bytes, not its name)
function fileKind(buf) {
  const h = buf.subarray(0, 12);
  if (h.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (h[0] === 0xff && h[1] === 0xd8) return 'image/jpeg';
  if (h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (h.subarray(4, 8).toString('latin1') === 'ftyp' && /hei|mif|avif/.test(h.subarray(8, 12).toString('latin1'))) return 'image/heic';
  if (h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

// Best guess at amount, invoice number, due date and vendor (agents confirm).
function guessInvoice(text) {
  const t = text.replace(/[ \t]+/g, ' ');
  const flat = t.replace(/\s+/g, ' ');
  const g = {};
  const amt = /(?:amount\s+due|balance\s+due|total\s+due|total\s+amount|invoice\s+total|grand\s+total|please\s+pay|total)\s*:?\s*(?:USD\s*)?\$?\s*([\d,]+\.\d{2})/i.exec(flat);
  if (amt) g.amount = money(amt[1]);
  const num = /invoice\s*(?:#|no\.?|number|num)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,24})/i.exec(flat);
  if (num && !/^(date|due|total)$/i.test(num[1])) g.invoice_number = num[1];
  const due = /(?:due\s+date|payment\s+due|due\s+by|due\s+on|pay\s+by)\s*:?\s*([A-Za-z]{3,9}\.? \d{1,2},? \d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})/i.exec(flat);
  if (due) {
    let iso = ins.toISODate(due[1]);
    if (!iso) { const d = new Date(`${due[1]} UTC`); iso = Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null; }
    if (iso) g.due_date = iso;
  }
  // Vendor: the first short line that is not just "Invoice".
  const first = t.split('\n').map((s) => s.trim()).find((s) => s.length >= 3 && s.length <= 60 && !/^(invoice|bill|statement|page \d)/i.test(s) && /[a-z]/i.test(s));
  if (first) g.vendor = first;
  return g;
}

function row(id) {
  return db.prepare(`SELECT i.*, p.address AS property, u.name AS uploaded_by_name, r.name AS remind_user_name
    FROM invoices i LEFT JOIN ins_properties p ON p.id = i.property_id
    LEFT JOIN users u ON u.id = i.uploaded_by LEFT JOIN users r ON r.id = i.remind_user WHERE i.id = ?`).get(Number(id));
}
const publicRow = (r) => { const { stored_name: _s, cal_key: _k, ...rest } = r; return rest; };

module.exports = function mount(app, { requireAuth, requireAdmin, fail, push }) {
  const guard = [requireAuth, requireAdmin];
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1 } });
  const pending = new Map(); // upload id -> { buffer, name, mime, at }
  setInterval(() => { for (const [k, v] of pending) if (Date.now() - v.at > 60 * 60e3) pending.delete(k); }, 60e3).unref();

  app.get('/api/invoices', ...guard, (req, res) => {
    const rows = db.prepare(`SELECT i.*, p.address AS property, u.name AS uploaded_by_name FROM invoices i
      LEFT JOIN ins_properties p ON p.id = i.property_id LEFT JOIN users u ON u.id = i.uploaded_by
      ORDER BY CASE WHEN i.status = 'unpaid' THEN 0 ELSE 1 END, COALESCE(i.due_date, '9999'), i.id DESC`).all().map(publicRow);
    const counts = { unpaid: rows.filter((r) => r.status === 'unpaid').length, paid: rows.filter((r) => r.status === 'paid').length };
    counts.unpaid_total = Math.round(rows.filter((r) => r.status === 'unpaid').reduce((a, r) => a + (r.amount || 0), 0) * 100) / 100;
    res.json({ counts, invoices: rows });
  });
  app.get('/api/invoices/summary', ...guard, (req, res) => {
    const u = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM invoices WHERE status = 'unpaid'").get();
    const due = db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE status = 'unpaid' AND due_date IS NOT NULL AND due_date <= ?").get(ins.today()).n;
    res.json({ unpaid: u.n, unpaid_total: u.total, due_now: due });
  });

  // Step 1: upload the file; the app reads what it can and suggests the property.
  app.post('/api/invoices/read', ...guard, (req, res) => {
    upload.single('file')(req, res, async (err) => {
      if (err) return fail(res, 400, err.code === 'LIMIT_FILE_SIZE' ? 'The file must be under 30 MB' : 'Upload failed');
      if (!req.file) return fail(res, 400, 'No file selected');
      const mime = fileKind(req.file.buffer);
      if (!mime) return fail(res, 400, 'Please upload a PDF or a photo of the invoice');
      const id = crypto.randomUUID();
      pending.set(id, { buffer: req.file.buffer, name: Buffer.from(req.file.originalname || 'invoice', 'latin1').toString('utf8').slice(0, 200), mime, at: Date.now() });
      let guess = {}; let propertyId = null;
      if (mime === 'application/pdf') {
        try {
          const { pages } = await ins.pdfPagesText(req.file.buffer, 10);
          const text = pages.join('\n');
          guess = guessInvoice(text);
          const h = ins.propertyHints()(text);
          if (h && h.ids.length === 1) propertyId = h.ids[0];
        } catch { /* unreadable PDF: just ask the questions */ }
      }
      res.json({ upload_id: id, mime, guess, property_id: propertyId });
    });
  });

  // Step 2: save with the answers.
  app.post('/api/invoices', ...guard, (req, res) => {
    const up = pending.get(String(req.body.upload_id || ''));
    if (!up) return fail(res, 410, 'The upload expired. Please choose the file again.');
    const b = req.body;
    let propertyId = b.property_id ? Number(b.property_id) : null;
    if (!propertyId && clean(b.new_property, 300)) {
      const r = db.prepare('INSERT INTO ins_properties (address, created_at) VALUES (?, ?)').run(clean(b.new_property, 300), now());
      propertyId = Number(r.lastInsertRowid);
    }
    if (!propertyId || !db.prepare('SELECT 1 FROM ins_properties WHERE id = ?').get(propertyId)) return fail(res, 400, 'Which property is this invoice for?');
    if (b.paid !== 'yes' && b.paid !== 'no') return fail(res, 400, 'Is it paid?');
    const paid = b.paid === 'yes';
    if (paid && !clean(b.paid_by)) return fail(res, 400, 'Who paid it?');
    const remindAt = !paid ? isoOrNull(b.remind_at) : null;
    const ext = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp' }[up.mime];
    const stored = `${crypto.randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(INV_DIR, stored), up.buffer);
    const r = db.prepare(`INSERT INTO invoices (property_id, status, paid_by, paid_on, vendor, invoice_number, amount, due_date, notes,
      original_name, stored_name, mime, size, remind_at, remind_user, cal_key, uploaded_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      propertyId, paid ? 'paid' : 'unpaid', paid ? clean(b.paid_by) : null, paid ? (ins.toISODate(b.paid_on) || ins.today()) : null,
      clean(b.vendor), clean(b.invoice_number, 60), money(b.amount), ins.toISODate(b.due_date), b.notes ? String(b.notes).slice(0, 2000) : null,
      up.name, stored, up.mime, up.buffer.length, remindAt, remindAt ? req.user.id : null, crypto.randomBytes(18).toString('base64url'),
      req.user.id, now(), now());
    pending.delete(String(b.upload_id));
    const id = Number(r.lastInsertRowid);
    log(id, req.user.id, 'uploaded', paid ? `Paid by ${clean(b.paid_by)}` : 'Not paid yet');
    if (remindAt) log(id, req.user.id, 'reminder_set', `Pay reminder for ${remindAt}`);
    res.json(publicRow(row(id)));
  });

  app.get('/api/invoices/:id', ...guard, (req, res) => {
    const r = row(req.params.id);
    if (!r) return fail(res, 404, 'Invoice not found');
    const history = db.prepare(`SELECT l.*, u.name AS user_name FROM invoice_log l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.invoice_id = ? ORDER BY l.id DESC`).all(r.id);
    res.json({ ...publicRow(r), cal_key: r.cal_key, history });
  });

  // Mark paid / unpaid, change property, set or clear the reminder, edit details.
  app.patch('/api/invoices/:id', ...guard, (req, res) => {
    const r = row(req.params.id);
    if (!r) return fail(res, 404, 'Invoice not found');
    const b = req.body || {};
    const next = { ...r };
    const changes = [];
    if (b.paid === 'yes') {
      if (!clean(b.paid_by)) return fail(res, 400, 'Who paid it?');
      Object.assign(next, { status: 'paid', paid_by: clean(b.paid_by), paid_on: ins.toISODate(b.paid_on) || ins.today(), remind_at: null, remind_sent: 0 });
      changes.push(['marked_paid', `Paid by ${next.paid_by} on ${next.paid_on}`]);
    } else if (b.paid === 'no') {
      Object.assign(next, { status: 'unpaid', paid_by: null, paid_on: null });
      changes.push(['marked_unpaid', '']);
    }
    if (b.remind_at !== undefined) {
      const at = isoOrNull(b.remind_at);
      Object.assign(next, { remind_at: at, remind_user: at ? req.user.id : null, remind_sent: 0 });
      changes.push([at ? 'reminder_set' : 'reminder_cleared', at ? `Pay reminder for ${at}` : '']);
    }
    if (b.property_id !== undefined) {
      const pid = Number(b.property_id);
      if (!db.prepare('SELECT 1 FROM ins_properties WHERE id = ?').get(pid)) return fail(res, 400, 'Property not found');
      next.property_id = pid; changes.push(['edited', 'Property changed']);
    }
    for (const k of ['vendor', 'invoice_number', 'notes']) if (b[k] !== undefined) { next[k] = k === 'notes' ? String(b[k]).slice(0, 2000) || null : clean(b[k], 200); changes.push(['edited', k.replace('_', ' ')]); }
    if (b.amount !== undefined) { next.amount = money(b.amount); changes.push(['edited', 'amount']); }
    if (b.due_date !== undefined) { next.due_date = ins.toISODate(b.due_date); changes.push(['edited', 'due date']); }
    db.prepare(`UPDATE invoices SET property_id = ?, status = ?, paid_by = ?, paid_on = ?, vendor = ?, invoice_number = ?, amount = ?, due_date = ?,
      notes = ?, remind_at = ?, remind_user = ?, remind_sent = ?, updated_at = ? WHERE id = ?`).run(
      next.property_id, next.status, next.paid_by, next.paid_on, next.vendor, next.invoice_number, next.amount, next.due_date,
      next.notes, next.remind_at, next.remind_user, next.remind_sent, now(), r.id);
    for (const [a, d] of changes) log(r.id, req.user.id, a, d);
    res.json(publicRow(row(r.id)));
  });

  app.delete('/api/invoices/:id', ...guard, (req, res) => {
    const r = row(req.params.id);
    if (!r) return fail(res, 404, 'Invoice not found');
    db.prepare('DELETE FROM invoices WHERE id = ?').run(r.id);
    fs.rm(path.join(INV_DIR, r.stored_name), { force: true }, () => {});
    res.json({ ok: true });
  });

  app.get('/api/invoices/:id/file', ...guard, (req, res) => {
    const r = row(req.params.id);
    if (!r || !fs.existsSync(path.join(INV_DIR, r.stored_name))) return fail(res, 404, 'File not found');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', r.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(r.original_name)}`);
    fs.createReadStream(path.join(INV_DIR, r.stored_name)).pipe(res);
  });

  // Calendar file for "pay this invoice" (opened with login, or with its secret key from a phone's calendar app).
  app.get('/api/invoices/:id/calendar.ics', (req, res, next) => {
    const r = row(req.params.id);
    const k = typeof req.query.k === 'string' ? req.query.k : '';
    if (r && r.cal_key && k.length === r.cal_key.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(r.cal_key))) { req.inv = r; return next(); }
    return requireAuth(req, res, () => requireAdmin(req, res, () => { if (!r) return fail(res, 404, 'Invoice not found'); req.inv = r; next(); }));
  }, (req, res) => {
    const r = req.inv;
    if (!r.remind_at) return fail(res, 400, 'No reminder set for this invoice');
    const t = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
    const fold = (line) => { const out = []; while (line.length > 74) { out.push(line.slice(0, 74)); line = ` ${line.slice(74)}`; } out.push(line); return out.join('\r\n'); };
    const start = new Date(r.remind_at);
    const title = `Pay invoice${r.vendor ? `: ${r.vendor}` : ''}${r.amount ? ` ($${r.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })})` : ''}`;
    const link = `${req.protocol}://${req.get('host')}/#/invoices/${r.id}`;
    const desc = [r.property ? `Property: ${r.property}` : '', r.invoice_number ? `Invoice # ${r.invoice_number}` : '', r.due_date ? `Due ${r.due_date}` : '', `Open: ${link}`].filter(Boolean).join('\n');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JRP//Client Book//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      `UID:jrp-invoice-${r.id}@jrp-client-book`, `DTSTAMP:${t(new Date().toISOString())}`, `DTSTART:${t(start.toISOString())}`,
      `DTEND:${t(new Date(start.getTime() + 15 * 60e3).toISOString())}`, `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(desc)}`, `URL:${link}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].map(fold);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="pay-invoice-${r.id}.ics"`);
    res.send(`${lines.join('\r\n')}\r\n`);
  });

  // Pay reminders: checked every minute; the phone notification goes to whoever set it.
  setInterval(() => {
    try {
      const due = db.prepare("SELECT * FROM invoices WHERE status = 'unpaid' AND remind_sent = 0 AND remind_at IS NOT NULL AND remind_at <= ?").all(new Date().toISOString());
      for (const d of due) {
        const r = row(d.id);
        db.prepare('UPDATE invoices SET remind_sent = 1 WHERE id = ?').run(d.id);
        const to = r.remind_user ? [r.remind_user] : db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1").all().map((u) => u.id);
        push.notify(to, {
          title: '💵 Time to pay an invoice',
          body: [r.vendor, r.amount ? `$${r.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : null, r.property].filter(Boolean).join(' · ') || 'Invoice reminder',
          url: `/#/invoices/${r.id}`, tag: `inv-${r.id}`,
        }).catch(() => {});
        log(r.id, null, 'reminder_sent', 'Pay reminder sent');
      }
    } catch (e) { console.error('Invoice reminders failed:', e.message); }
  }, 60e3).unref();
};

module.exports.guessInvoice = guessInvoice;
module.exports.fileKind = fileKind;
