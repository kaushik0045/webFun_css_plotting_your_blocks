// Groups pdf.js text items into lines in reading order (top to bottom, left to right).
// Kept separate from pdfText.js so it can be tested in Node.
export function itemsToLines(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) <= 2);
    if (!row) rows.push((row = { y, parts: [] }));
    row.parts.push({ x, str: it.str, w: it.width || 0 });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((row) => {
    row.parts.sort((a, b) => a.x - b.x);
    let text = '';
    let end = null;
    for (const part of row.parts) {
      if (end !== null) {
        const gap = part.x - end;
        if (gap > 15) text += '   ';
        else if (gap > 1 && !text.endsWith(' ') && !part.str.startsWith(' ')) text += ' ';
      }
      text += part.str;
      end = part.x + part.w;
    }
    return text.replace(/\s+$/, '');
  });
}
