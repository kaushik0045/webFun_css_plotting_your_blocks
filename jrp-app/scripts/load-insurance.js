// One command to load your insurance into the app:
//   npm run load-insurance
// It looks in Downloads, Desktop and Documents for:
//   - the insurance Excel workbook (a .xlsx file with "insurance" in its name), and
//   - policy PDFs (a .pdf file with "policy" or "insurance" in its name),
// imports every property and policy, and saves each property's declarations pages as its own PDF.
// Or point it at a folder (or files):     npm run load-insurance -- "/path/to/My Insurance Folder"
// Safe to run again: nothing is added twice.
const fs = require('fs');
const os = require('os');
const path = require('path');
const ins = require('../src/insurance');
const { db } = require('../src/db');

function findFiles() {
  const roots = ['Downloads', 'Desktop', 'Documents'].map((d) => path.join(os.homedir(), d));
  const found = [];
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 2 && !/webFun_css|jrp-old/.test(e.name)) walk(full, depth + 1); continue; }
      if (/\.xlsx$/i.test(e.name) && /insur/i.test(e.name) && !e.name.startsWith('~$')) found.push(full);
      else if (/\.pdf$/i.test(e.name) && /polic|insur|declaration|\bdec\b/i.test(e.name)) found.push(full);
    }
  };
  roots.forEach((r) => walk(r, 0));
  return found;
}

(async () => {
  // Arguments can be files or folders (drag a folder into Terminal: every .xlsx and .pdf inside is used).
  const args = process.argv.slice(2).map((a) => a.trim().replace(/^['"]|['"]$/g, '')).filter((a) => a && fs.existsSync(a));
  const fromArgs = [];
  const walkAll = (dir, depth) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 3) walkAll(full, depth + 1); } else if (/\.(xlsx|pdf)$/i.test(e.name)) fromArgs.push(full);
    }
  };
  for (const a of args) { if (fs.statSync(a).isDirectory()) walkAll(a, 0); else fromArgs.push(a); }
  const files = args.length ? fromArgs : findFiles();
  const admin = db.prepare("SELECT id, name FROM users WHERE role = 'admin' AND active = 1 ORDER BY id").get();
  const uid = admin ? admin.id : null;

  // Newest workbook only (older copies of the same sheet would just repeat it).
  const books = files.filter((f) => /\.xlsx$/i.test(f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const pdfs = files.filter((f) => /\.pdf$/i.test(f) && !/expired|expiring|report/i.test(path.basename(f)));

  if (!books.length && !pdfs.length) {
    console.log('\nNo insurance files found in Downloads, Desktop or Documents.');
    console.log('Type:  npm run load-insurance -- ');
    console.log('then drag the Excel file (and policy PDFs) into this window, and press Enter.\n');
    process.exit(1);
  }

  if (books.length) {
    console.log(`\nExcel: ${path.basename(books[0])}`);
    try {
      const r = ins.importWorkbook(fs.readFileSync(books[0]), uid);
      console.log(`  ✓ ${r.properties_added} properties added, ${r.policies_added} policies added, ${r.renewals} renewals, ${r.policies_updated} updated`);
    } catch (e) { console.log(`  ✕ Could not read it: ${e.message}`); }
  } else {
    console.log('\nNo insurance Excel file found (skipping).');
  }

  const name = (id) => (db.prepare('SELECT address FROM ins_properties WHERE id = ?').get(id) || {}).address;
  for (const f of pdfs) {
    console.log(`\nPDF: ${path.basename(f)}`);
    let buf;
    try { buf = fs.readFileSync(f); } catch { console.log('  ✕ Could not open it'); continue; }
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') { console.log('  ✕ Not a PDF'); continue; }
    let a;
    try { a = await ins.analyzeBigPdf(buf); } catch { console.log('  ✕ Could not read it (damaged or password-protected)'); continue; }
    const base = path.basename(f).replace(/\.pdf$/i, '');
    let any = false;
    for (const g of a.groups) {
      if (!g.property_ids.length) continue;
      // Keep the declarations pages when there are some (the part people actually read).
      const pages = g.dec_pages.length ? g.dec_pages : Array.from({ length: g.to - g.from + 1 }, (_, i) => g.from + i);
      const label = g.dec_pages.length ? `pages ${pages[0]}-${pages[pages.length - 1]}` : `pages ${g.from}-${g.to}`;
      const out = await ins.extractPages(buf, pages);
      for (const pid of g.property_ids) {
        const r = ins.savePagesTo(pid, out.buffer, `${base} (${label}).pdf`, out.pages, uid, g.keys || [], `${label} of ${path.basename(f)}`, g.dec_pages.length > 0);
        console.log(`  ${r.duplicate ? '•' : '✓'} ${name(pid)}: ${out.pages} page${out.pages === 1 ? '' : 's'} (${label})${r.duplicate ? ' — already saved' : ''}`);
        any = true;
      }
    }
    if (!any) console.log(a.scanned ? '  • Scanned PDF (no text): open the property in the app and attach it there.' : '  • No property on file matched this PDF. Attach it in the app.');
  }

  const s = ins.summary();
  console.log(`\nInsurance now: ${s.expired} expired · ${s.due30} due within 30 days · ${s.due90} due within 90 days · ${s.active} active · ${s.none} with no policy`);
  console.log('Start the app with:  npm start\n');
})();
