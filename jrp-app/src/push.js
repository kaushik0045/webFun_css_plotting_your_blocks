// Phone / computer notifications (Web Push), so chat messages arrive even when the app is closed.
// The keys that sign notifications are created once and kept in DATA_DIR/vapid.json
// (or set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY yourself).
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const { db, DATA_DIR } = require('./db');

db.exec(`CREATE TABLE IF NOT EXISTS push_subs (
  endpoint   TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL
)`);

function loadKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const file = path.join(DATA_DIR, 'vapid.json');
  try {
    const k = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (k.publicKey && k.privateKey) return k;
  } catch { /* first run */ }
  const k = webpush.generateVAPIDKeys();
  fs.writeFileSync(file, JSON.stringify(k), { mode: 0o600 });
  return k;
}
const keys = loadKeys();
// Apple rejects "localhost" here, so use a real-looking contact address.
const subject = process.env.VAPID_SUBJECT
  || (process.env.ADMIN_EMAIL ? `mailto:${process.env.ADMIN_EMAIL}` : 'mailto:alerts@jrp-client-book.app');
webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);

// Only send to the real push services of Apple, Google, Mozilla and Microsoft.
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];
function validSubscription(s) {
  if (!s || typeof s !== 'object' || typeof s.endpoint !== 'string' || s.endpoint.length > 1000) return false;
  const k = s.keys || {};
  if (typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || k.p256dh.length > 200 || k.auth.length > 100) return false;
  let u;
  try { u = new URL(s.endpoint); } catch { return false; }
  if (process.env.PUSH_ALLOW_ANY_HOST === '1') return ['https:', 'http:'].includes(u.protocol); // tests only
  return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
}

function save(userId, s) {
  // One device belongs to whoever logged in on it last.
  db.prepare(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
    .run(s.endpoint, userId, s.keys.p256dh, s.keys.auth, new Date().toISOString());
}
function remove(endpoint, userId) {
  db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').run(String(endpoint || ''), userId);
}
const countFor = (userId) => db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?').get(userId).n;

// Send to every device of these people. Never blocks the request; failures are only logged.
function notify(userIds, payload) {
  if (!userIds.length) return Promise.resolve([]);
  const subs = db.prepare(`SELECT s.* FROM push_subs s JOIN users u ON u.id = s.user_id
    WHERE u.active = 1 AND s.user_id IN (${userIds.map(() => '?').join(',')})`).all(...userIds);
  const data = JSON.stringify(payload);
  return Promise.all(subs.map((s) => webpush
    .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, data, { TTL: 60 * 60 * 24, urgency: 'high' })
    .then(() => true)
    .catch((err) => {
      // 404/410 = the person turned notifications off or uninstalled the app.
      if (err && (err.statusCode === 404 || err.statusCode === 410)) db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(s.endpoint);
      else console.error('Push failed:', err && (err.statusCode || err.message));
      return false;
    })));
}

module.exports = { publicKey: keys.publicKey, validSubscription, save, remove, countFor, notify };
