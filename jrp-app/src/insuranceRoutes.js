// Web routes for the Insurance section (admins only).
const fs = require('fs');
const multer = require('multer');
const ins = require('./insurance');
const { db } = require('./db');

const MAX_PDF_MB = Number(process.env.MAX_INSURANCE_PDF_MB || 150);
const memory = (mb) => multer({ storage: multer.memoryStorage(), limits: { fileSize: mb * 1024 * 1024, files: 1 } });
const isPdf = (f) => f && f.buffer && f.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
const nameOf = (f) => Buffer.from(f.originalname || 'policy.pdf', 'latin1').toString('utf8').slice(0, 200);

module.exports = function mount(app, { requireAuth, requireAdmin, fail, push }) {
  const guard = [requireAuth, requireAdmin];
  const one = (mb, field = 'file') => (req, res, next) => memory(mb).single(field)(req, res, (err) => {
    if (err) return fail(res, 400, err.code === 'LIMIT_FILE_SIZE' ? `The file must be under ${mb} MB` : 'Upload failed');
    if (!req.file) return fail(res, 400, 'No file selected');
    next();
  });
  const prop = (req, res) => {
    const p = db.prepare('SELECT * FROM ins_properties WHERE id = ?').get(Number(req.params.id));
    if (!p) fail(res, 404, 'Property not found');
    return p;
  };

  app.get('/api/insurance', ...guard, (req, res) => {
    res.json({ today: ins.today(), summary: ins.summary(), properties: ins.listProperties() });
  });
  // Small numbers for the home screen banner.
  app.get('/api/insurance/summary', ...guard, (req, res) => res.json(ins.summary()));

  app.post('/api/insurance/properties', ...guard, (req, res) => {
    const address = String(req.body.address || '').trim().slice(0, 300);
    if (!address) return fail(res, 400, 'Address is required');
    const r = db.prepare('INSERT INTO ins_properties (address, kind, notes, created_at) VALUES (?,?,?,?)')
      .run(address, String(req.body.kind || '').trim().slice(0, 80) || null, String(req.body.notes || '').trim().slice(0, 2000) || null, new Date().toISOString());
    ins.log(Number(r.lastInsertRowid), req.user.id, 'created', 'Property added');
    res.json({ id: Number(r.lastInsertRowid) });
  });
  app.get('/api/insurance/properties/:id', ...guard, (req, res) => {
    const p = ins.getProperty(req.params.id);
    if (!p) return fail(res, 404, 'Property not found');
    res.json(p);
  });
  app.patch('/api/insurance/properties/:id', ...guard, (req, res) => {
    const p = prop(req, res); if (!p) return;
    const address = req.body.address !== undefined ? String(req.body.address).trim().slice(0, 300) : p.address;
    if (!address) return fail(res, 400, 'Address is required');
    db.prepare('UPDATE ins_properties SET address = ?, kind = ?, notes = ? WHERE id = ?').run(address,
      req.body.kind !== undefined ? String(req.body.kind).trim().slice(0, 80) || null : p.kind,
      req.body.notes !== undefined ? String(req.body.notes).trim().slice(0, 2000) || null : p.notes, p.id);
    ins.log(p.id, req.user.id, 'edited', 'Property details changed');
    res.json({ ok: true });
  });
  app.delete('/api/insurance/properties/:id', ...guard, (req, res) => {
    const p = prop(req, res); if (!p) return;
    const files = db.prepare('SELECT * FROM ins_files WHERE property_id = ?').all(p.id);
    db.prepare('DELETE FROM ins_properties WHERE id = ?').run(p.id);
    for (const f of files) fs.rm(ins.filePath(f), { force: true }, () => {});
    res.json({ ok: true });
  });

  // Add a policy by hand, or save a renewal (replace = ids of the policies it renews).
  app.post('/api/insurance/properties/:id/policies', ...guard, (req, res) => {
    const p = prop(req, res); if (!p) return;
    const pol = ins.cleanPolicy(req.body);
    if (!pol.carrier && !pol.policy_number) return fail(res, 400, 'Add the insurance company or the policy number');
    if (!pol.end_date) return fail(res, 400, 'Add the expiration date');
    if (pol.start_date && pol.end_date < pol.start_date) return fail(res, 400, 'The expiration date is before the start date');
    const replace = (Array.isArray(req.body.replace) ? req.body.replace : []).map(Number).filter(Boolean);
    const fileId = req.body.file_id ? Number(req.body.file_id) : null;
    if (fileId && !db.prepare('SELECT 1 FROM ins_files WHERE id = ? AND (property_id IS NULL OR property_id = ?)').get(fileId, p.id)) {
      return fail(res, 400, 'That file was not found');
    }
    const id = ins.addPolicy(p.id, req.user.id, pol, { fileId, replaceIds: replace });
    if (fileId) ins.log(p.id, req.user.id, 'file_uploaded', 'Policy PDF attached');
    res.json({ id });
  });
  app.patch('/api/insurance/policies/:id', ...guard, (req, res) => {
    const pid = ins.updatePolicy(req.params.id, req.user.id, req.body || {});
    if (!pid) return fail(res, 404, 'Policy not found');
    res.json({ ok: true });
  });
  app.delete('/api/insurance/policies/:id', ...guard, (req, res) => {
    const pol = db.prepare('SELECT * FROM ins_policies WHERE id = ?').get(Number(req.params.id));
    if (!pol) return fail(res, 404, 'Policy not found');
    db.prepare('DELETE FROM ins_policies WHERE id = ?').run(pol.id);
    ins.log(pol.property_id, req.user.id, 'policy_removed', `${pol.carrier || ''} ${pol.policy_number || ''}`.trim());
    res.json({ ok: true });
  });

  // Upload a renewed policy PDF: saved, read, and the details suggested for the agent to confirm.
  app.post('/api/insurance/properties/:id/read-pdf', ...guard, one(40), async (req, res) => {
    const p = prop(req, res); if (!p) return;
    if (!isPdf(req.file)) return fail(res, 400, 'Please upload a PDF file');
    let text = ''; let pages = null;
    try {
      const r = await ins.pdfPagesText(req.file.buffer, 250);
      text = r.pages.join('\n'); pages = r.total;
    } catch { return fail(res, 400, 'This PDF could not be opened. It may be damaged or password-protected.'); }
    const fileId = ins.saveFile(req.file.buffer, nameOf(req.file), req.user.id, p.id, pages);
    const known = db.prepare('SELECT id, carrier, policy_number FROM ins_policies WHERE property_id = ?').all(p.id);
    const guess = text.trim().length > 40 ? ins.guessFields(text, known) : {};
    res.json({ file_id: fileId, pages, scanned: text.trim().length <= 40, guess });
  });

  // Attach a PDF to an existing policy (e.g. the current one on file).
  app.post('/api/insurance/policies/:id/file', ...guard, one(40), async (req, res) => {
    const pol = db.prepare('SELECT * FROM ins_policies WHERE id = ?').get(Number(req.params.id));
    if (!pol) return fail(res, 404, 'Policy not found');
    if (!isPdf(req.file)) return fail(res, 400, 'Please upload a PDF file');
    let pages = null;
    try { pages = (await ins.pdfPagesText(req.file.buffer, 1)).total; } catch { /* still keep it */ }
    const fileId = ins.saveFile(req.file.buffer, nameOf(req.file), req.user.id, pol.property_id, pages);
    db.prepare('UPDATE ins_policies SET file_id = ? WHERE id = ?').run(fileId, pol.id);
    ins.log(pol.property_id, req.user.id, 'file_uploaded', `Policy PDF attached to ${pol.carrier || 'policy'}`);
    res.json({ file_id: fileId });
  });

  app.get('/api/insurance/files/:id', ...guard, (req, res) => {
    const f = db.prepare('SELECT * FROM ins_files WHERE id = ?').get(Number(req.params.id));
    if (!f || !fs.existsSync(ins.filePath(f))) return fail(res, 404, 'File not found');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
    fs.createReadStream(ins.filePath(f)).pipe(res);
  });

  // Excel import (the "Insurances" sheets).
  app.post('/api/insurance/import', ...guard, one(20), (req, res) => {
    if (req.file.buffer.subarray(0, 2).toString('latin1') !== 'PK') return fail(res, 400, 'Please upload an Excel (.xlsx) file');
    try { res.json(ins.importWorkbook(req.file.buffer, req.user.id)); } catch (e) { fail(res, 400, e.message || 'Could not read this Excel file'); }
  });

  // Split one big PDF into one PDF per property.
  const splits = new Map(); // id -> { buffer, name, at } kept for 30 minutes
  setInterval(() => { for (const [k, v] of splits) if (Date.now() - v.at > 30 * 60e3) splits.delete(k); }, 60e3).unref();
  app.post('/api/insurance/split', ...guard, one(MAX_PDF_MB), async (req, res) => {
    if (!isPdf(req.file)) return fail(res, 400, 'Please upload a PDF file');
    try {
      const a = await ins.analyzeBigPdf(req.file.buffer);
      const id = require('crypto').randomUUID();
      splits.set(id, { buffer: req.file.buffer, name: nameOf(req.file), at: Date.now(), total: a.total, dec: new Set(a.pages.filter((x) => x.dec).map((x) => x.page)) });
      res.json({ split_id: id, name: nameOf(req.file), ...a });
    } catch { fail(res, 400, 'This PDF could not be opened. It may be damaged or password-protected.'); }
  });
  app.post('/api/insurance/split/:sid/save', ...guard, async (req, res) => {
    const s = splits.get(req.params.sid);
    if (!s) return fail(res, 410, 'This upload has expired. Please upload the PDF again.');
    const groups = Array.isArray(req.body.groups) ? req.body.groups.slice(0, 500) : [];
    const saved = [];
    for (const g of groups) {
      // g.pages: "39-49" or "39-44, 47"; g.property_ids: every property these pages belong to
      const list = ins.parsePageList(g.pages, s.total);
      const ids = [...new Set((Array.isArray(g.property_ids) ? g.property_ids : [g.property_id]).map(Number).filter(Boolean))];
      if (!list.length || !ids.length) continue;
      let out;
      try { out = await ins.extractPages(s.buffer, list); } catch (e) { return fail(res, 400, e.message || 'Could not split the PDF'); }
      const label = String(g.pages).replace(/\s+/g, '');
      const base = s.name.replace(/\.pdf$/i, '');
      const keys = (Array.isArray(g.keys) ? g.keys : []).map(ins.normPol);
      for (const pid of ids) {
        if (!db.prepare('SELECT 1 FROM ins_properties WHERE id = ?').get(pid)) continue;
        const isDec = list.some((n) => s.dec.has(n));
        const r = ins.savePagesTo(pid, out.buffer, `${base} (pages ${label}).pdf`, out.pages, req.user.id, keys, `Pages ${label} of ${s.name}`, isDec);
        saved.push({ property_id: pid, file_id: r.file_id, pages: label });
      }
    }
    res.json({ saved });
  });

  // ---------- alerts: checked every hour; sent to admins' phones ----------
  const run = () => {
    try {
      const a = ins.collectAlerts();
      if (!a) return;
      const admins = db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1").all().map((u) => u.id);
      push.notify(admins, a).catch(() => {});
    } catch (e) { console.error('Insurance alerts failed:', e.message); }
  };
  setTimeout(run, 15e3).unref();
  setInterval(run, 60 * 60e3).unref();
};
