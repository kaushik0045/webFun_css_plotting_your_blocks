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
const kiran = addUser('Kiran Bains', 'kiran@demo.com', 'staff');
const setInfo = db.prepare('UPDATE users SET title = ?, phone = ?, last_login_at = ? WHERE id = ?');
setInfo.run('Broker / Owner', '(209) 555-0100', new Date(Date.now() - 2 * 3600e3).toISOString(), admin);
setInfo.run('Senior Agent', '(209) 555-0111', new Date(Date.now() - 26 * 3600e3).toISOString(), priya);
setInfo.run('Sales Agent', '(209) 555-0122', new Date(Date.now() - 50 * 60e3).toISOString(), mike);
setInfo.run('Junior Agent', '(209) 555-0133', null, kiran);

const ago = (days, hours = 0) => new Date(Date.now() - (days * 24 + hours) * 3600e3).toISOString().replace(/\.\d{3}Z$/, 'Z');

// props: [address, notes, listing details]     comments: [user, daysAgo, text, propertyIndex?]
const clients = [
  { type: 'seller', name: 'Maria Lopez', phone: '(209) 555-0142', email: 'maria.lopez@example.com', mail: '1420 Oak Ave, Modesto, CA 95350', agent: priya,
    props: [
      ['1420 Oak Ave, Modesto, CA 95350', '3 bed / 2 bath', { listing_status: 'For sale', property_type: 'Single-family home', asking_price: 519000, size_sqft: 1650 }],
      ['88 River Rd, Turlock, CA 95380', 'Vacant lot', { listing_status: 'Not for sale', property_type: 'Land / Lot', lot_acres: 0.4 }]],
    comments: [[priya, 20, 'First call. Maria wants to sell the Oak Ave house in spring. Expects around $520k.'],
      [admin, 14, 'Sent comparable sales for her street. She agreed $519k is fair.', 0],
      [priya, 6, 'Photographer booked for next Tuesday 10am.', 0],
      [mike, 4, 'River Rd lot: county says it is zoned residential. Maria may sell it later.', 1],
      [mike, 1, 'Buyer James Carter asked for a showing this weekend. Maria approved Saturday 2pm.', 0]] },
  { type: 'buyer', name: 'James Carter', phone: '209-555-7781', email: 'jcarter@example.com', mail: '', agent: mike,
    details: { property_types: ['Single-family home'], budget_max: 480000, cash_injection: 96000, states: 'CA', business_experience: 'no' },
    props: [['1420 Oak Ave, Modesto, CA 95350', 'Interested, showing Saturday', { listing_status: 'Not for sale' }]],
    comments: [[mike, 10, 'Pre-approved up to $480k with Valley Credit Union. Wants 3 bed in Modesto, good schools.'],
      [mike, 2, 'Likes Oak Ave but thinks it is over budget. Will try to stretch to $500k.']] },
  { type: 'seller', name: 'Raman Singh', phone: '(209) 555-4400', email: 'rsingh@example.com', mail: '3100 McHenry Ave, Modesto, CA 95350', agent: admin,
    props: [
      ['1150 Crows Landing Rd, Modesto, CA 95351', 'Fuel station with convenience store', { listing_status: 'For sale', property_type: 'Gas station', asking_price: 1000000, exchange_1031: 'yes', brand: 'Chevron', gas_volume: 85000, gas_margin: 32,
        cstore_sales: 60000, fuel_contract: 'Chevron supply agreement until 2028', mpds: 6, size_sqft: 2400, lot_acres: 0.9, tank_size: '2 × 12,000 gal + 1 × 10,000 gal diesel',
        double_walled: 'yes', rental_income: 'yes', rental_income_amount: 2500, gross_profit: 420000, nearest_freeway: 'Hwy 99, 0.6 mi', abc_license: 'Yes',
        cigarette_license: 'Yes', ebt: 'yes', lottery: 'yes', building_rent: 'N/A (owned)', hours: '5am–11pm, 7 days', additional_info: 'Owner retiring. Car wash bay could be reopened.' }],
      ['3100 McHenry Ave, Modesto, CA 95350', 'Retail strip, 6 units, 92% leased', { listing_status: 'For sale', property_type: 'Retail / Strip center', asking_price: 2850000, size_sqft: 14000 }],
      ['455 Main St, Ripon, CA 95366', '4-plex, all units rented', { listing_status: 'For sale', property_type: 'Multifamily (2–4 units)', asking_price: 1150000, size_sqft: 3800 }],
      ['2900 Geer Rd, Turlock, CA 95382', 'Hotel site, 2.1 acres', { listing_status: 'Not for sale', property_type: 'Land / Lot', lot_acres: 2.1 }],
      ['18 Hwy 99 Frontage Rd, Ceres, CA 95307', 'Truck stop with 40 truck spaces', { listing_status: 'For sale', property_type: 'Truck stop', asking_price: 3400000, lot_acres: 6 }],
      ['2250 Kietzke Ln, Reno, NV 89502', 'Unbranded station, high diesel volume', { listing_status: 'For sale', property_type: 'Gas station', asking_price: 900000, brand: 'Unbranded', gas_volume: 70000, mpds: 8 }],
      ['720 W Yosemite Ave, Manteca, CA 95337', 'Office building', { listing_status: 'Under contract', property_type: 'Office', asking_price: 2100000, size_sqft: 12000 }],
      ['901 Pelandale Ave, Modesto, CA 95356', 'Duplex', { listing_status: 'For sale', property_type: 'Multifamily (2–4 units)', asking_price: 640000, size_sqft: 2100 }]],
    comments: [[admin, 25, 'Raman wants to sell several properties this year to fund a new hotel project.'],
      [priya, 9, 'Sent him a pricing summary for the Ripon 4-plex and the duplex.'],
      [admin, 7, 'Two investors interested in Ripon. Want rent roll and last 2 years of expenses.', 2],
      [admin, 2, 'Gas station: fuel supplier contract runs until 2028. Need to disclose.', 0]] },
  { type: 'buyer', name: 'Gurpreet Dhillon', phone: '(209) 555-3001', email: 'gdhillon@example.com', mail: '', agent: priya,
    details: { property_types: ['Gas station', 'Truck stop'], brands: ['Chevron', 'Shell', 'ARCO'], states: 'CA', branding: 'Branded', cash_injection: 1000000, budget_max: 1000000, business_experience: 'yes', experience_where: 'Two gas stations in Fresno', experience_years: 8 },
    props: [], comments: [[priya, 5, 'Cash buyer, owns 2 stations in Fresno. Wants another along 99.']] },
  { type: 'buyer', name: 'Anil Patel', phone: '(209) 555-3002', email: 'apatel@example.com', mail: '', agent: mike,
    details: { property_types: ['Gas station', 'Hotel / Motel'], states: 'CA, NV', branding: 'Either', cash_injection: 250000, budget_max: 950000, business_experience: 'yes', experience_where: 'Motel in Merced', experience_years: 5 },
    props: [], comments: [[mike, 3, 'SBA pre-approval for $950k. Flexible on type.']] },
  { type: 'buyer', name: 'Sandeep Gill', phone: '(209) 555-3003', email: '', mail: '', agent: admin,
    details: { property_types: ['Gas station'], brands: ['ARCO', 'Valero'], states: 'CA', branding: 'Branded', cash_injection: 200000, budget_max: 880000, business_experience: 'no' },
    props: [], comments: [] },
  { type: 'buyer', name: 'Tom Reyes', phone: '(209) 555-3004', email: 'treyes@example.com', mail: '', agent: priya,
    details: { property_types: ['Gas station'], states: 'CA', branding: 'Independent', cash_injection: 120000, budget_max: 700000, business_experience: 'no' },
    props: [], comments: [[priya, 12, 'First-time buyer, still sorting out financing.']] },
  { type: 'buyer', name: 'David Nguyen', phone: '(916) 555-2044', email: 'dnguyen@example.com', mail: '', agent: priya,
    details: { property_types: ['Multifamily (2–4 units)', 'Single-family home'], states: 'CA', cash_injection: 1200000, budget_max: 1200000, business_experience: 'yes', experience_where: 'Rental properties in Sacramento', experience_years: 12 },
    props: [], comments: [[priya, 3, 'Investor looking for rental properties. Prefers 2-4 units.']] },
  { type: 'both', name: 'Harpreet & Simran Gill', phone: '(209) 555-3310', email: 'gill.family@example.com', mail: '502 Sylvan Ave, Modesto, CA 95355', agent: admin,
    details: { property_types: ['Single-family home'], states: 'CA', cash_injection: 150000, budget_max: 750000 },
    props: [['502 Sylvan Ave, Modesto, CA 95355', 'Selling current home', { listing_status: 'For sale', property_type: 'Single-family home', asking_price: 465000, size_sqft: 1500 }]],
    comments: [[admin, 30, 'Family is upsizing. Selling Sylvan Ave and buying a 4-bed nearby.'],
      [priya, 8, 'They loved a backyard on Coffee Rd. Waiting on their lender.']] },
  { type: 'seller', name: 'Linda Brooks', phone: '(209) 555-8890', email: '', mail: '77 Elm St, Ceres, CA 95307', agent: mike,
    props: [['77 Elm St, Ceres, CA 95307', '2 bed condo, HOA $210/mo', { listing_status: 'For sale', property_type: 'Condo / Townhouse', asking_price: 289000, size_sqft: 980 }]],
    comments: [[mike, 45, 'Inherited condo. Wants a quick sale.'], [mike, 40, 'Listed at $289,000.', 0], [admin, 12, 'Offer received at $275k. Linda countering at $284k.', 0]] },
  { type: 'buyer', name: 'Ahmed Khan', phone: '(209) 555-6620', email: 'ahmed.k@example.com', mail: '', agent: null,
    props: [], comments: [] },
];

const tx = db.transaction(() => {
  for (const c of clients) {
    const created = ago(c.comments.length ? c.comments[0][1] + 1 : 1);
    const id = db.prepare(`INSERT INTO clients (type, name, phone, phone_digits, email, mailing_address, assigned_agent_id, created_by, created_at, updated_at, details)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(c.type, c.name, c.phone, c.phone.replace(/\D/g, ''), c.email, c.mail, c.agent, admin, created, created, JSON.stringify(c.details || {})).lastInsertRowid;
    db.prepare('INSERT INTO activity (client_id, user_id, action, detail, created_at) VALUES (?,?,?,?,?)')
      .run(id, admin, 'created', `Added ${c.type} "${c.name}"`, created);
    const propIds = c.props.map(([address, notes, details]) => db.prepare('INSERT INTO properties (client_id, address, notes, created_by, created_at, details) VALUES (?,?,?,?,?,?)')
      .run(id, address, notes, admin, created, JSON.stringify(details || {})).lastInsertRowid);
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

// Sample office chat
const dm = (a, b) => `dm:${Math.min(a, b)}-${Math.max(a, b)}`;
const say = db.prepare('INSERT INTO messages (channel, sender_id, body, client_id, created_at) VALUES (?,?,?,?,?)');
const clientId = (name) => (db.prepare('SELECT id FROM clients WHERE name = ?').get(name) || {}).id || null;
const minsAgo = (m) => new Date(Date.now() - m * 60e3).toISOString().replace(/\.\d{3}Z$/, 'Z');
say.run('announce', admin, 'Welcome to JRP Client Book! From today, please log every call and showing here so the whole team can see the history.', null, minsAgo(60 * 26));
say.run('announce', admin, 'Team meeting Friday 9am at the office. Bring your top 3 buyer matches.', null, minsAgo(90));
say.run('team', mike, 'Anyone have a buyer for a duplex in Modesto under $650k?', null, minsAgo(240));
say.run('team', priya, 'David Nguyen might be interested. He wants 2-4 units.', clientId('David Nguyen'), minsAgo(230));
say.run('team', mike, 'Perfect, thanks! Calling him now.', null, minsAgo(225));
say.run(dm(admin, priya), admin, 'Priya, can you follow up with Gurpreet about the Crows Landing station? Great match.', clientId('Gurpreet Dhillon'), minsAgo(45));
say.run(dm(admin, priya), priya, 'On it. Calling him this afternoon.', null, minsAgo(40));
say.run(dm(mike, priya), mike, 'Can you cover my 3pm showing on Oak Ave tomorrow?', clientId('Maria Lopez'), minsAgo(20));
// people have read older messages
const read = db.prepare('INSERT OR REPLACE INTO chat_reads (user_id, channel, last_read_id) VALUES (?,?,?)');
read.run(priya, 'announce', 1); read.run(mike, 'announce', 2); read.run(admin, 'team', 5); read.run(priya, 'team', 5);

console.log('Demo data added. Logins (password demo1234): admin@demo.com (admin), priya@demo.com, mike@demo.com, kiran@demo.com (staff)');
