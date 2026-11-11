// Rate confirmation parser — text rules only, no AI, runs in the browser.
//
// Input:  the PDF's text as an array of lines (see pdfText.js).
// Output: { loadNumber, brokerName, stops: [{ type, facility_name, address, appointment, pickup_number }] }
//
// The RATE is never returned. Every line that mentions money is thrown away
// before any parsing happens, so no field can accidentally carry a dollar amount.
// Results are a best guess — the dispatcher reviews and edits them before saving.

const MONEY_LINE =
  /\$|\busd\b|\brate\b|\bline\s*haul\b|\blinehaul\b|\bfuel\s*surcharge\b|\bfsc\b|\baccessorial|\bdetention\b|\blumper\b|\btonu\b|\bcarrier\s*pay\b|\btotal\b|\bamount\b|\bpayment\b|\bpay\s*(?:to|terms)\b|\binvoice\b|\bquick\s*pay\b|\bflat\b|\ballowance\b/i;

const PICKUP_HEADER =
  /^\s*(?:stop\s*#?\s*\d+\s*[:\-–]?\s*)?(?:pick[\s-]*up|shipper|origin)\s*(?:#?\s*\d{1,2})?\s*(?:info(?:rmation)?|details|location|facility|address)?\s*(?:[:\-–]|$|\s{2,})/i;
const DELIVERY_HEADER =
  /^\s*(?:stop\s*#?\s*\d+\s*[:\-–]?\s*)?(?:deliver(?:y|ies)?|consignee|receiver|destination|drop(?:\s*off)?|stop\s*off)\s*(?:#?\s*\d{1,2})?\s*(?:info(?:rmation)?|details|location|facility|address)?\s*(?:[:\-–]|$|\s{2,})/i;
const STOP_HEADER_WITH_TYPE = /^\s*stop\s*#?\s*\d+\b.*?\b(pick[\s-]*up|shipper|origin|deliver(?:y)?|consignee|receiver|drop|destination)\b/i;

// Things that end a stop section.
const SECTION_END =
  /^\s*(?:carrier\s*(?:info|information|name)?|equipment|commodity|special\s*instructions|notes?|terms|conditions|signature|agreed|accepted|broker\s*(?:info|information)|dispatcher|driver\s*(?:name|info)|bill\s*to|remit|total|page\s*\d)\b/i;

const CITY_ST_ZIP = /([A-Za-z][A-Za-z .'-]*?),?\s+([A-Z]{2})\s*,?\s+(\d{5})(?:-\d{4})?\b/;
const STREET = /^\s*\d+[A-Za-z]?\s+\S+.*|^\s*(?:p\.?\s*o\.?\s*box|one|two|hwy|highway|route|rte|us\s*\d+)\b.*/i;
const DATE = /\b(\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{4})?)\b/i;
const TIME = /\b(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*[ap]\.?m\.?)?\b|\b(?:[01]\d|2[0-3])[0-5]\d\s*(?:hrs?|h)\b|\b\d{1,2}\s*[ap]\.?m\.?\b/i;
const APPT_WORD = /\b(?:appt|appointment|window|ready|pick[\s-]*up\s*(?:date|time)|deliver(?:y)?\s*(?:date|time)|date|time|eta|fcfs|first\s*come|open\s*until|by\s*appointment)\b/i;
const FCFS = /\bfcfs\b|first\s*come,?\s*first\s*serve/i;

// Reference numbers. Captures the label and the value.
const REF =
  /\b(p\/?u|pick[\s-]*up|pickup|shipper|release|bol|b\/l|po|p\.o\.|ref(?:erence)?|confirmation|conf|appt|appointment|deliver(?:y)?|del|so|sales\s*order|order|booking|seal|customer)\s*(?:#|no\.?|number|num)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]*(?:\s*[,&]\s*[A-Z0-9][A-Z0-9\-\/]*)*)/gi;
const NOT_A_REF = /\b(?:mc|dot|phone|ph|tel|fax|cell|scac|ein|tax)\b/i;

const LOAD_NUMBER = /\b(?:load|order|shipment|pro|confirmation|conf|trip|tender)\s*(?:#|no\.?|number|num|id)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-]{2,})/i;
const COMPANY_HINT = /\b(?:llc|inc\.?|corp\.?|co\.|company|logistics|freight|transport(?:ation)?|brokerage|solutions|express|shipping|supply\s*chain|group|ltd)\b/i;

export function sanitizeLines(lines) {
  return lines
    .map((l) => String(l ?? '').replace(/\s+$/g, ''))
    .filter((l) => l.trim() && !MONEY_LINE.test(l));
}

// "Pickup # 4471823" / "Delivery No: 88812" are reference numbers, not section headers.
const REF_LINE = /^\s*[a-z\/ -]{1,20}?\s*(?:#|no\.?|number|num)\s*[:#]?\s*[A-Z0-9-]{3,}/i;

function headerType(line) {
  if (REF_LINE.test(line)) return null;
  const typed = line.match(STOP_HEADER_WITH_TYPE);
  if (typed) return /pick|shipper|origin/i.test(typed[1]) ? 'pickup' : 'delivery';
  if (PICKUP_HEADER.test(line)) return 'pickup';
  if (DELIVERY_HEADER.test(line)) return 'delivery';
  return null;
}

// Value after "Label:" on a header line, e.g. "Shipper: ACME Foods" → "ACME Foods".
function afterLabel(line) {
  const m = line.match(/[:\-–]\s*(.+)$/);
  if (!m) return '';
  const v = m[1].trim();
  if (/^(?:pick|deliver|drop|shipper|consignee|receiver|origin|destination|stop)[a-z ]{0,12}$/i.test(v)) return '';
  if (DATE.test(v) || TIME.test(v) || REF.test(v)) { REF.lastIndex = 0; return ''; }
  REF.lastIndex = 0;
  return v;
}

function isLabelOnly(line) {
  return /^[A-Za-z /#&]+:\s*$/.test(line.trim()) && line.trim().split(/\s+/).length <= 3;
}

function cleanFacility(s) {
  return s.replace(/^\s*(?:name|facility|company|location)\s*[:\-–]\s*/i, '').replace(/\s{2,}.*$/, '').trim();
}

function extractRefs(lines, type) {
  const found = [];
  for (const line of lines) {
    REF.lastIndex = 0;
    let m;
    while ((m = REF.exec(line))) {
      const label = m[1].replace(/\s+/g, ' ').trim();
      const value = m[2].replace(/\s+/g, ' ').trim();
      const before = line.slice(Math.max(0, m.index - 6), m.index);
      if (NOT_A_REF.test(label) || NOT_A_REF.test(before)) continue;
      if (/^\d{1,2}[\/\-]\d{1,2}/.test(value)) continue; // a date, not a number
      if (value.length < 3) continue;
      found.push({ label, value });
    }
  }
  // Prefer the labels that matter for this stop type, but keep the rest too.
  const primary = type === 'pickup' ? /p\/?u|pick|shipper|release|bol|b\/l/i : /deliver|del|so|po|p\.o\.|appt|appointment|order/i;
  found.sort((a, b) => Number(primary.test(b.label)) - Number(primary.test(a.label)));
  const seen = new Set();
  return found
    .filter((r) => (seen.has(r.value) ? false : seen.add(r.value)))
    .map((r) => `${normalizeLabel(r.label)}# ${r.value}`)
    .join(', ');
}

function normalizeLabel(label) {
  const l = label.toLowerCase().replace(/\s+/g, ' ');
  if (/^(p\/?u|pick ?-?up|pickup)$/.test(l)) return 'PU';
  if (/^(deliver|delivery|del)$/.test(l)) return 'DEL';
  if (/^(po|p\.o\.)$/.test(l)) return 'PO';
  if (/^(bol|b\/l)$/.test(l)) return 'BOL';
  if (/^(ref|reference)$/.test(l)) return 'REF';
  if (/^(appt|appointment)$/.test(l)) return 'APPT';
  if (/^(conf|confirmation)$/.test(l)) return 'CONF';
  return label.toUpperCase();
}

function extractAppointment(lines) {
  if (lines.some((l) => FCFS.test(l)) && !lines.some((l) => DATE.test(l))) return 'FCFS';
  // Prefer labelled lines; fall back to any line with a date.
  const candidates = lines.filter((l) => (DATE.test(l) || TIME.test(l)) && !CITY_ST_ZIP.test(l));
  candidates.sort((a, b) => Number(APPT_WORD.test(b)) - Number(APPT_WORD.test(a)));
  const parts = [];
  for (const line of candidates.slice(0, 2)) {
    let v = line.replace(REF, '').trim();
    REF.lastIndex = 0;
    v = v.replace(/^\s*(?:(?:pick[\s-]*up|deliver(?:y)?|appt|appointment|ready|scheduled|sched)\s*)*(?:date|time|window|appt|appointment)?s?\s*(?:\/\s*time)?\s*[:\-–]\s*/i, '');
    v = v.replace(/\s{2,}/g, ' ').trim();
    if (v && !parts.includes(v)) parts.push(v);
  }
  let out = parts.join(' ');
  if (FCFS.test(lines.join(' ')) && !/fcfs/i.test(out)) out = `${out} (FCFS)`.trim();
  return out;
}

function extractAddress(lines) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(CITY_ST_ZIP);
    if (!m) continue;
    const cityLine = lines[i].trim();
    // Address may all be on one line: "123 Main St, Dallas, TX 75201"
    if (STREET.test(cityLine) && cityLine.indexOf(m[0]) > 3) {
      return { address: cityLine.replace(/\s{2,}.*$/, ''), index: i, streetIndex: i };
    }
    let streetIndex = -1;
    for (let j = i - 1; j >= Math.max(0, i - 2); j--) {
      if (STREET.test(lines[j]) && !DATE.test(lines[j])) { streetIndex = j; break; }
    }
    const street = streetIndex >= 0 ? lines[streetIndex].trim().replace(/^\s*address\s*[:\-–]\s*/i, '') : '';
    const cityPart = cityLine.replace(/^\s*(?:city|address)\s*[:\-–]\s*/i, '');
    return { address: [street, cityPart].filter(Boolean).join(', '), index: i, streetIndex: streetIndex >= 0 ? streetIndex : i };
  }
  return { address: '', index: -1, streetIndex: -1 };
}

function extractFacility(sectionLines, headerLine, streetIndex) {
  const fromHeader = afterLabel(headerLine);
  if (fromHeader && !CITY_ST_ZIP.test(fromHeader) && !STREET.test(fromHeader)) return cleanFacility(fromHeader);
  const named = sectionLines.find((l) => /^\s*(?:name|facility|company|location)\s*[:\-–]/i.test(l));
  if (named) return cleanFacility(named);
  const limit = streetIndex >= 0 ? streetIndex : sectionLines.length;
  for (let i = 0; i < limit; i++) {
    const l = sectionLines[i].trim();
    if (!l || isLabelOnly(l) || DATE.test(l) || TIME.test(l) || STREET.test(l) || CITY_ST_ZIP.test(l)) continue;
    REF.lastIndex = 0;
    if (REF.test(l)) { REF.lastIndex = 0; continue; }
    if (/^(?:contact|phone|tel|attn|hours)\b/i.test(l)) continue;
    return cleanFacility(l);
  }
  return '';
}

function splitSections(lines) {
  const sections = [];
  let current = null;
  for (const line of lines) {
    const type = headerType(line);
    if (type) {
      current = { type, header: line, lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    if (SECTION_END.test(line) || current.lines.length >= 18) { current = null; continue; }
    current.lines.push(line);
  }
  // A header line followed by nothing useful is usually a table heading — drop it.
  return sections.filter((s) => s.lines.length > 0 || CITY_ST_ZIP.test(s.header));
}

function findBroker(lines) {
  for (const line of lines.slice(0, 12)) {
    const t = line.trim();
    if (/carrier/i.test(t)) continue;
    if (COMPANY_HINT.test(t) && t.length < 70 && !CITY_ST_ZIP.test(t)) {
      return t.replace(/^\s*(?:broker|from|company)\s*[:\-–]\s*/i, '').replace(/\s{2,}.*$/, '').trim();
    }
  }
  return '';
}

export function parseRateCon(rawLines) {
  const lines = sanitizeLines(rawLines);
  const loadMatch = lines.join('\n').match(LOAD_NUMBER);
  const sections = splitSections(lines);

  const stops = sections
    .map((s) => {
      const all = [s.header, ...s.lines];
      const { address, streetIndex } = extractAddress(s.lines.length ? s.lines : [s.header]);
      return {
        type: s.type,
        facility_name: extractFacility(s.lines, s.header, streetIndex),
        address,
        appointment: extractAppointment(all),
        pickup_number: extractRefs(all, s.type),
      };
    })
    .filter((s) => s.address || s.facility_name || s.appointment || s.pickup_number);

  // Belt and braces: no output field may ever contain a money amount.
  for (const s of stops) {
    for (const k of Object.keys(s)) s[k] = String(s[k]).replace(/\$\s?[\d,]+(?:\.\d{1,2})?/g, '').trim();
  }

  return {
    loadNumber: loadMatch ? loadMatch[1] : '',
    brokerName: findBroker(lines),
    stops,
  };
}
