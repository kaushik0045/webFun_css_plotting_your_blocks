import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRateCon, sanitizeLines } from '../src/lib/rateconParser.js';

const lines = (s) => s.split('\n');

// Layout A: labelled blocks, one stop per section.
const LAYOUT_A = lines(`Summit Freight Brokerage LLC
RATE CONFIRMATION
Load # SFB-204551
Carrier: HS Logistics   MC# 1234567
Pickup 1
Shipper: Golden Valley Foods
1450 Industrial Pkwy
Fresno, CA 93725
Pickup Date: 11/12/2026  Appt 08:00 - 10:00
PU# 4471823   BOL# 99812
Contact: Mike  Phone# 559-555-0101
Delivery 1
Consignee: Kroger DC #014
2200 Distribution Way
Tolleson, AZ 85353
Delivery Date: 11/13/2026 Appt 06:00
Delivery # DK-55120  PO# 7781203
Line Haul: $2,450.00
Fuel Surcharge: $310.00
Total Carrier Pay: $2,760.00
Special Instructions
Driver must have 2 load bars.`);

// Layout B: "Stop N - Type" headings, address on one line, FCFS.
const LAYOUT_B = lines(`Ridgeline Logistics Inc.
Order Number: 8812044
Stop 1 - Pick Up
ACME PAPER MILL
500 River Rd, Longview, WA 98632
Ready 11/14/2026 0700 hrs - 1500 hrs FCFS
Release # REL-30022
Stop 2 - Delivery
Costco Depot 1290
18001 Hwy 99, Tracy, CA 95304
Appointment: 11/16/2026 13:30
SO# 4410098, 4410099
Rate  2100.00 USD
Terms and Conditions apply.`);

// Layout C: multi-stop with two deliveries and money on a stop line.
const LAYOUT_C = lines(`Big River Transport Co.
Load ID: BRT-77
Shipper
Prairie Grain Co
88 Elevator Ln
Salina, KS 67401
Pickup Time: Nov 18, 2026 9:00 AM
Pickup Number: PG-1182
Consignee 1
Midwest Mills
12 Mill St
Omaha, NE 68102
Delivery Date: 11/19/2026 by appointment
Del# MM-901   Lumper $150
Consignee 2
Heartland Bakery
4500 Oven Ave
Des Moines, IA 50309
Delivery Date: 11/20/2026 10:00
PO# HB-3321
Carrier Information
Total: 3,900.00`);

test('drops every line that mentions money', () => {
  const out = sanitizeLines(LAYOUT_A).join('\n');
  assert.doesNotMatch(out, /\$|2,450|310\.00|2,760/);
  for (const raw of [LAYOUT_A, LAYOUT_B, LAYOUT_C]) {
    const json = JSON.stringify(parseRateCon(raw));
    assert.doesNotMatch(json, /\$|2,?450|2,?760|2100|3,?900|150\b|usd|line haul|rate/i, json);
  }
});

test('layout A: labelled pickup + delivery', () => {
  const r = parseRateCon(LAYOUT_A);
  assert.equal(r.loadNumber, 'SFB-204551');
  assert.equal(r.brokerName, 'Summit Freight Brokerage LLC');
  assert.equal(r.stops.length, 2);
  const [pu, del] = r.stops;
  assert.equal(pu.type, 'pickup');
  assert.equal(pu.facility_name, 'Golden Valley Foods');
  assert.equal(pu.address, '1450 Industrial Pkwy, Fresno, CA 93725');
  assert.match(pu.appointment, /11\/12\/2026/);
  assert.match(pu.appointment, /08:00/);
  assert.match(pu.pickup_number, /^PU# 4471823/);
  assert.match(pu.pickup_number, /BOL# 99812/);
  assert.doesNotMatch(pu.pickup_number, /555|1234567/); // phone / MC are not refs
  assert.equal(del.type, 'delivery');
  assert.equal(del.facility_name, 'Kroger DC #014');
  assert.equal(del.address, '2200 Distribution Way, Tolleson, AZ 85353');
  assert.match(del.appointment, /11\/13\/2026/);
  assert.match(del.pickup_number, /DEL# DK-55120/);
  assert.match(del.pickup_number, /PO# 7781203/);
});

test('layout B: Stop N headings, one-line address, FCFS', () => {
  const r = parseRateCon(LAYOUT_B);
  assert.equal(r.loadNumber, '8812044');
  assert.equal(r.brokerName, 'Ridgeline Logistics Inc.');
  assert.equal(r.stops.length, 2);
  const [pu, del] = r.stops;
  assert.equal(pu.type, 'pickup');
  assert.equal(pu.facility_name, 'ACME PAPER MILL');
  assert.equal(pu.address, '500 River Rd, Longview, WA 98632');
  assert.match(pu.appointment, /11\/14\/2026/);
  assert.match(pu.appointment, /FCFS/);
  assert.match(pu.pickup_number, /RELEASE# REL-30022/);
  assert.equal(del.type, 'delivery');
  assert.equal(del.facility_name, 'Costco Depot 1290');
  assert.equal(del.address, '18001 Hwy 99, Tracy, CA 95304');
  assert.match(del.appointment, /11\/16\/2026 13:30/);
  assert.match(del.pickup_number, /SO# 4410098, 4410099/);
});

test('layout C: one pickup, two deliveries', () => {
  const r = parseRateCon(LAYOUT_C);
  assert.equal(r.loadNumber, 'BRT-77');
  assert.equal(r.brokerName, 'Big River Transport Co.');
  assert.deepEqual(r.stops.map((s) => s.type), ['pickup', 'delivery', 'delivery']);
  const [pu, d1, d2] = r.stops;
  assert.equal(pu.facility_name, 'Prairie Grain Co');
  assert.equal(pu.address, '88 Elevator Ln, Salina, KS 67401');
  assert.match(pu.appointment, /Nov 18, 2026 9:00 AM/);
  assert.match(pu.pickup_number, /PU# PG-1182/);
  assert.equal(d1.facility_name, 'Midwest Mills');
  assert.equal(d1.address, '12 Mill St, Omaha, NE 68102');
  assert.match(d1.appointment, /11\/19\/2026/);
  assert.equal(d1.pickup_number, ''); // the Del# line also had a lumper amount, so it was dropped
  assert.equal(d2.facility_name, 'Heartland Bakery');
  assert.match(d2.pickup_number, /PO# HB-3321/);
});

test('empty or unrelated text gives no stops', () => {
  assert.deepEqual(parseRateCon([]).stops, []);
  assert.deepEqual(parseRateCon(['Hello world']).stops, []);
});
