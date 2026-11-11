import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { itemsToLines } from '../src/lib/textLines.js';
import { parseRateCon } from '../src/lib/rateconParser.js';

test('real PDF: text extraction + parsing, rate never returned', async () => {
  const data = new Uint8Array(await readFile(new URL('./fixtures/sample-ratecon.pdf', import.meta.url)));
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const lines = itemsToLines((await page.getTextContent()).items);
  const r = parseRateCon(lines);
  assert.equal(r.loadNumber, 'SFB-204551');
  assert.equal(r.stops.length, 2, JSON.stringify(lines, null, 1));
  assert.equal(r.stops[0].address, '1450 Industrial Pkwy, Fresno, CA 93725');
  assert.match(r.stops[0].appointment, /11\/12\/2026.*08:00/);
  assert.match(r.stops[0].pickup_number, /PU# 4471823/);
  assert.equal(r.stops[1].address, '2200 Distribution Way, Tolleson, AZ 85353');
  assert.match(r.stops[1].pickup_number, /DEL# DK-55120/);
  assert.doesNotMatch(JSON.stringify(r), /2,?450|2,?760|310|\$/);
});
