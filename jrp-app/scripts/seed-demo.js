// Fills an EMPTY database with sample employees, buyers, sellers and comments for testing.
// Usage: npm run demo-data      (never run this on the live app)
const bcrypt = require('bcryptjs');
const { db } = require('../src/db');

if (db.prepare('SELECT COUNT(*) AS n FROM clients').get().n > 0) {
  console.log('Database already has clients. Demo data is only added to an empty database.');
  process.exit(0);
}

const addUser = (name, email, role) => {
  const ex = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (ex) return ex.id;
  return db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
    .run(name, email, bcrypt.hashSync('demo1234', 10), role).lastInsertRowid;
};
const admin = addUser('Jas Randhawa', 'admin@demo.com', 'admin');
const priya = addUser('Priya Sharma', 'priya@demo.com', 'staff');
const mike = addUser('Mike Torres', 'mike@demo.com', 'staff');

const ago = (days, hours = 0) => new Date(Date.now() - (days * 24 + hours) * 3600e3).toISOString().replace(/\.\d{3}Z$/, 'Z');

const clients = [
  { type: 'seller', name: 'Maria Lopez', phone: '(209) 555-0142', email: 'maria.lopez@example.com', mail: '1420 Oak Ave, Modesto, CA 95350', agent: priya,
    props: [['1420 Oak Ave, Modesto, CA 95350', '3 bed / 2 bath, 1,650 sq ft. Asking $519,000'], ['88 River Rd, Turlock, CA 95380', 'Vacant lot, 0.4 acre']],
    comments: [[priya, 20, 'First call. Maria wants to sell the Oak Ave house in spring. Expects around $520k.'],
      [admin, 14, 'Sent comparable sales for her street. She agreed $519k is fair.', 0],
      [priya, 6, 'Photographer booked for next Tuesday 10am.', 0],
      [mike, 4, 'River Rd lot: county says it is zoned residential. Maria may sell it later.', 1],
      [mike, 1, 'Buyer James Carter asked for a showing this weekend. Maria approved Saturday 2pm.', 0]] },
  { type: 'buyer', name: 'James Carter', phone: '209-555-7781', email: 'jcarter@example.com', mail: '', agent: mike,
    props: [['1420 Oak Ave, Modesto, CA 95350', 'Interested, showing Saturday']],
    comments: [[mike, 10, 'Pre-approved up to $480k with Valley Credit Union. Wants 3 bed in Modesto, good schools.'],
      [mike, 2, 'Likes Oak Ave but thinks it is over budget. Will try to stretch to $500k.']] },
  { type: 'both', name: 'Harpreet & Simran Gill', phone: '(209) 555-3310', email: 'gill.family@example.com', mail: '502 Sylvan Ave, Modesto, CA 95355', agent: admin,
    props: [['502 Sylvan Ave, Modesto, CA 95355', 'Selling current home'], ['2215 Coffee Rd, Modesto, CA 95355', 'Possible purchase, 4 bed']],
    comments: [[admin, 30, 'Family is upsizing. Selling Sylvan Ave and buying a 4-bed nearby.'],
      [priya, 8, 'Toured Coffee Rd. They loved the backyard. Waiting on their lender.']] },
  { type: 'seller', name: 'Raman Singh', phone: '(209) 555-4400', email: 'rsingh@example.com', mail: '3100 McHenry Ave, Modesto, CA 95350', agent: admin,
    props: [['3100 McHenry Ave, Modesto, CA 95350', 'Retail strip, 6 units, 92% leased'], ['1150 Crows Landing Rd, Modesto, CA 95351', 'Truck stop + fuel station'],
      ['455 Main St, Ripon, CA 95366', '4-plex, all units rented'], ['2900 Geer Rd, Turlock, CA 95382', 'Hotel site, 2.1 acres'],
      ['18 Hwy 99 Frontage Rd, Ceres, CA 95307', 'Vacant commercial lot'], ['720 W Yosemite Ave, Manteca, CA 95337', 'Office building, 12,000 sq ft'],
      ['901 Pelandale Ave, Modesto, CA 95356', 'Duplex']],
    comments: [[admin, 25, 'Raman wants to sell 3 of his 7 properties this year to fund a new hotel project.'],
      [priya, 9, 'Sent him a pricing summary for the Ripon 4-plex and the Ceres lot.'],
      [admin, 7, 'Two investors interested. Want rent roll and last 2 years of expenses.', 2],
      [mike, 3, 'Walked the Ceres lot with a developer. Asked about utility hookups.', 4],
      [admin, 2, 'Truck stop: fuel supplier contract runs until 2028. Need to disclose.', 1]] },
  { type: 'buyer', name: 'David Nguyen', phone: '(916) 555-2044', email: 'dnguyen@example.com', mail: '', agent: priya,
    props: [], comments: [[priya, 3, 'Investor looking for rental properties under $350k in Ceres or Turlock.']] },
  { type: 'seller', name: 'Linda Brooks', phone: '(209) 555-8890', email: '', mail: '77 Elm St, Ceres, CA 95307', agent: mike,
    props: [['77 Elm St, Ceres, CA 95307', '2 bed condo, HOA $210/mo']],
    comments: [[mike, 45, 'Inherited condo. Wants a quick sale.'], [mike, 40, 'Listed at $289,000.'], [admin, 12, 'Offer received at $275k. Linda countering at $284k.']] },
  { type: 'buyer', name: 'Ahmed Khan', phone: '(209) 555-6620', email: 'ahmed.k@example.com', mail: '', agent: null,
    props: [], comments: [] },
];

const tx = db.transaction(() => {
  for (const c of clients) {
    const created = ago(c.comments.length ? c.comments[0][1] + 1 : 1);
    const id = db.prepare(`INSERT INTO clients (type, name, phone, phone_digits, email, mailing_address, assigned_agent_id, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(c.type, c.name, c.phone, c.phone.replace(/\D/g, ''), c.email, c.mail, c.agent, admin, created, created).lastInsertRowid;
    db.prepare('INSERT INTO activity (client_id, user_id, action, detail, created_at) VALUES (?,?,?,?,?)')
      .run(id, admin, 'created', `Added ${c.type} "${c.name}"`, created);
    const propIds = c.props.map(([address, notes]) => db.prepare('INSERT INTO properties (client_id, address, notes, created_by, created_at) VALUES (?,?,?,?,?)')
      .run(id, address, notes, admin, created).lastInsertRowid);
    let last = created;
    for (const [uid, days, body, propIdx] of c.comments) {
      last = ago(days, Math.floor(Math.random() * 8));
      db.prepare('INSERT INTO comments (client_id, property_id, user_id, body, created_at) VALUES (?,?,?,?,?)')
        .run(id, propIdx === undefined ? null : propIds[propIdx], uid, body, last);
    }
    db.prepare('UPDATE clients SET updated_at = ? WHERE id = ?').run(last, id);
  }
});
tx();
console.log('Demo data added. Logins (password demo1234): admin@demo.com (admin), priya@demo.com, mike@demo.com (staff)');
