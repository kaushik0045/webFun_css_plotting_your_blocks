// Keeps login sessions in SQLite so people stay logged in after a server restart.
const session = require('express-session');

class SqliteStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.getStmt = db.prepare('SELECT data, expires FROM sessions WHERE sid = ?');
    this.setStmt = db.prepare('INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?,?,?)');
    this.delStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    setInterval(() => db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()), 60 * 60 * 1000).unref();
  }
  expiry(sess) {
    const e = sess && sess.cookie && sess.cookie.expires;
    return e ? new Date(e).getTime() : Date.now() + 24 * 60 * 60 * 1000;
  }
  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.data));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try { this.setStmt.run(sid, JSON.stringify(sess), this.expiry(sess)); cb && cb(null); }
    catch (e) { cb && cb(e); }
  }
  destroy(sid, cb) {
    try { this.delStmt.run(sid); cb && cb(null); } catch (e) { cb && cb(e); }
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

module.exports = SqliteStore;
