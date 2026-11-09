// Health check: shows what this copy of the app sees.   Usage: npm run check
const net = require('net');
const path = require('path');
const { db, DATA_DIR } = require('../src/db');

const PORT = Number(process.env.PORT || 3000);
const line = (label, value) => console.log(`${label.padEnd(22)} ${value}`);

console.log('\n=== JRP Client Book: health check ===\n');
line('App folder:', path.resolve(__dirname, '..'));
line('Node.js version:', process.version);
line('Data folder:', DATA_DIR);

const users = db.prepare('SELECT email, role, active FROM users ORDER BY id').all();
line('Employee logins:', users.length || 'NONE. Run "npm run demo-data" or "npm run create-admin"');
for (const u of users) console.log(`   - ${u.email} (${u.role}${u.active ? '' : ', switched OFF'})`);
line('Buyers & sellers:', db.prepare('SELECT COUNT(*) AS n FROM clients').get().n);
line('Properties:', db.prepare('SELECT COUNT(*) AS n FROM properties').get().n);

const sock = net.connect(PORT, '127.0.0.1');
sock.setTimeout(1000);
sock.on('connect', () => {
  line(`Port ${PORT}:`, 'IN USE. An app is already running there (maybe an older copy in another Terminal window).');
  sock.destroy();
  console.log();
});
const free = () => { line(`Port ${PORT}:`, 'free. "npm run dev" can start here.'); console.log(); };
sock.on('error', free);
sock.on('timeout', () => { sock.destroy(); free(); });
