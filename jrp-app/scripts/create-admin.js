// Creates (or resets) an admin account from the command line.
// Usage: npm run create-admin -- "Full Name" email@company.com "password"
const bcrypt = require('bcryptjs');
const { db } = require('../src/db');

const [name, email, password] = process.argv.slice(2);
if (!name || !email || !password) {
  console.log('Usage: npm run create-admin -- "Full Name" email@company.com "password"');
  process.exit(1);
}
if (password.length < 8) {
  console.log('Password must be at least 8 characters.');
  process.exit(1);
}
const hash = bcrypt.hashSync(password, 12);
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
if (existing) {
  db.prepare("UPDATE users SET name = ?, password_hash = ?, role = 'admin', active = 1 WHERE id = ?").run(name, hash, existing.id);
  console.log(`Updated ${email}: now an active admin with the new password.`);
} else {
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,'admin')").run(name, email.toLowerCase(), hash);
  console.log(`Created admin ${email}.`);
}
