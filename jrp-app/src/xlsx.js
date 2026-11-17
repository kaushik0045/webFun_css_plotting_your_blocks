// A small Excel (.xlsx) reader with no extra libraries: an .xlsx file is a zip of XML files.
// It returns every sheet as rows of plain values. Cells under a "date" column that hold
// Excel date numbers are turned into "YYYY-MM-DD".
const zlib = require('zlib');

const MAX_UNZIPPED = 60 * 1024 * 1024; // refuse "zip bombs"

function unzip(buf) {
  // Find the "end of central directory" record (it is in the last 64 KB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This is not an Excel (.xlsx) file.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  let total = 0;
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('This Excel file looks damaged.');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!/^(xl\/(workbook\.xml|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml|_rels\/workbook\.xml\.rels))$/.test(name)) continue;
    total += usize;
    if (total > MAX_UNZIPPED) throw new Error('This Excel file is too large.');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    const xml = (method === 0 ? data : zlib.inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED })).toString('utf8');
    // Some programs write <x:row> instead of <row>: drop the tag prefixes so one set of patterns fits all.
    files[name] = xml.replace(/<(\/?)[A-Za-z][\w.-]*:/g, '<$1');
  }
  return files;
}

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');
const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');
const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
// Excel counts days from 1899-12-30.
function serialToDate(n) {
  const ms = Math.round((Number(n) - 25569) * 86400000);
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

function readWorkbook(buf) {
  const f = unzip(buf);
  if (!f['xl/workbook.xml']) throw new Error('This is not an Excel (.xlsx) file.');
  const shared = f['xl/sharedStrings.xml'] ? [...f['xl/sharedStrings.xml'].matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const rels = {};
  for (const m of (f['xl/_rels/workbook.xml.rels'] || '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0]); const target = /Target="([^"]+)"/.exec(m[0]);
    if (id && target) rels[id[1]] = target[1].replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const sheets = [];
  for (const m of f['xl/workbook.xml'].matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode((/name="([^"]*)"/.exec(m[0]) || [])[1] || '');
    const rid = (/r:id="([^"]+)"/.exec(m[0]) || [])[1];
    const xml = f[`xl/${rels[rid]}`];
    if (!xml) continue;
    const rows = [];
    for (const r of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells = [];
      for (const c of (r[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]; const inner = c[2] || '';
        const ref = (/r="([A-Z]+)\d+"/.exec(attrs) || [])[1];
        if (!ref) continue;
        const t = (/t="([^"]+)"/.exec(attrs) || [])[1];
        const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
        let val = null;
        if (t === 's') val = shared[Number(v)] ?? null;
        else if (t === 'inlineStr') val = textOf(inner);
        else if (t === 'str' || t === 'e') val = v !== undefined ? decode(v) : null;
        else if (t === 'b') val = v === '1';
        else if (t === 'd') val = v ? decode(v).slice(0, 10) : null; // ISO date cell
        else if (v !== undefined) val = Number(v);
        cells[colIndex(ref)] = val;
      }
      rows.push(cells);
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

module.exports = { readWorkbook, serialToDate };
