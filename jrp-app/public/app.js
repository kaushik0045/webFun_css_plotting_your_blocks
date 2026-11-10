// JRP Client Book — front end.
// A small single-page app: each "#/..." address in the URL shows a different screen.
'use strict';

const $app = document.getElementById('app');
let me = null;            // the logged-in employee
let agentsCache = null;   // employee list for dropdowns

// ---------- tiny helpers ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 7) { const d = Math.floor(s / 86400); return d === 1 ? 'yesterday' : `${d} days ago`; }
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
const typeLabel = { buyer: 'Buyer', seller: 'Seller', both: 'Buyer & Seller' };
const badge = (t) => `<span class="badge ${esc(t)}">${esc(typeLabel[t] || t)}</span>`;
const mapsUrl = (addr) => `https://maps.google.com/?q=${encodeURIComponent(addr)}`;
const telUrl = (p) => `tel:${String(p).replace(/[^\d+]/g, '')}`;

let toastTimer;
function toast(msg, isErr = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}

async function api(method, url, body) {
  const opts = { method, headers: { 'X-JRP': '1' }, credentials: 'same-origin' };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && url !== '/api/login') { me = null; go('#/login'); throw new Error(data.error || 'Please log in'); }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

async function agents() {
  if (!agentsCache) agentsCache = await api('GET', '/api/agents');
  return agentsCache;
}

function go(hash) {
  if (location.hash === hash) route(); else location.hash = hash;
}

function setNav(active) {
  document.getElementById('topbar').hidden = !me;
  document.getElementById('nav-admin').hidden = !(me && me.role === 'admin');
  $$('.topnav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === active));
}

// ---------- chat badge: checks for new messages every 15 seconds while the app is open ----------
let unreadInfo = { total: 0, announce: 0, latest_announcement: null };
async function refreshUnread() {
  if (!me || document.visibilityState === 'hidden') return;
  try {
    unreadInfo = await api('GET', '/api/chat/unread');
    const b = document.getElementById('chat-badge');
    if (b) { b.hidden = !unreadInfo.total; b.textContent = unreadInfo.total > 99 ? '99+' : String(unreadInfo.total); }
    document.title = unreadInfo.total ? `(${unreadInfo.total}) JRP Client Book` : 'JRP Client Book';
    maybePopup(unreadInfo);
  } catch { /* offline or logged out */ }
}
setInterval(refreshUnread, 5000);
document.addEventListener('visibilitychange', refreshUnread);

// ---------- new-message pop-up ----------
// A big pop-up for every new message, so nobody misses one. "Later" hides it until the next new message.
const popKey = () => `jrp-pop-seen-${me ? me.id : 0}`;
function popSeen() { try { return Number(localStorage.getItem(popKey()) || 0); } catch { return popSeenMem; } }
let popSeenMem = 0;
function setPopSeen(id) { popSeenMem = id; try { localStorage.setItem(popKey(), String(id)); } catch { /* private mode */ } }

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    beep.ctx = beep.ctx || new Ctx();
    const ctx = beep.ctx;
    [0, 0.18].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = i ? 1046 : 784;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.17);
    });
  } catch { /* sound not allowed yet */ }
  try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch { /* not supported */ }
}

function closePopup() { const el = document.getElementById('msg-pop'); if (el) el.remove(); }

function maybePopup(info) {
  const m = info && info.newest;
  if (!m || m.id <= popSeen()) return;
  const here = `#/chat/${encodeURIComponent(m.channel)}`;
  if (location.hash === here && document.visibilityState === 'visible') { setPopSeen(m.id); return; } // already reading it
  const existing = document.getElementById('msg-pop');
  if (existing && Number(existing.dataset.id) === m.id) return;
  closePopup();
  const isAnn = m.kind === 'announce';
  const heading = isAnn ? '📢 Announcement' : m.kind === 'team' ? '💬 Team chat' : '💬 New message';
  const more = info.total - 1;
  const el = document.createElement('div');
  el.id = 'msg-pop';
  el.className = `msg-pop${isAnn ? ' is-ann' : ''}`;
  el.dataset.id = String(m.id);
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-labelledby', 'msg-pop-h');
  el.innerHTML = `
    <div class="mp-card">
      <p class="kicker" id="msg-pop-h">${heading}</p>
      <p class="mp-from">${esc(m.sender_name || 'Management')}<span> · ${esc(fmtAgo(m.created_at))}</span></p>
      ${m.body ? `<p class="mp-body">${esc(m.body)}</p>` : ''}
      ${m.client_id ? `<p class="mp-client">About: <b>${esc(m.client_name || 'a client')}</b></p>` : ''}
      ${more > 0 ? `<p class="muted small">+ ${more} more unread</p>` : ''}
      <div class="row">
        <a class="btn" href="${here}" id="mp-open">${isAnn ? 'Open' : 'Open &amp; reply'}</a>
        <button type="button" class="btn ghost" id="mp-later">${isAnn ? 'Got it' : 'Later'}</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  const done = () => { setPopSeen(m.id); closePopup(); };
  el.querySelector('#mp-open').addEventListener('click', done);
  el.querySelector('#mp-later').addEventListener('click', done);
  el.addEventListener('click', (e) => { if (e.target === el) done(); });
  el.querySelector('#mp-open').focus({ preventScroll: true });
  beep();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('msg-pop')) document.getElementById('mp-later').click(); });

// ---------- router ----------
// Every screen change bumps navToken. A screen that finishes loading after the
// person has already moved on checks it and quietly does nothing.
let navToken = 0;
// True only while the address bar still shows this screen.
const onPage = (hash) => (location.hash || '#/') === hash;
async function route() {
  navToken += 1;
  if (chatPoll) { clearInterval(chatPoll); chatPoll = null; }
  whyStore.clear();
  const hash = location.hash || '#/';
  if (!me && hash !== '#/login') {
    try { me = await api('GET', '/api/me'); } catch { return; }
  }
  const parts = hash.slice(2).split('/');
  window.scrollTo(0, 0);
  try {
    if (parts[0] === 'login') return await viewLogin();
    refreshUnread();
    if (parts[0] === '' ) return await viewSearch();
    if (parts[0] === 'new') return await viewClientForm(null);
    if (parts[0] === 'client' && parts[1] && parts[2] === 'edit') return await viewClientForm(Number(parts[1]));
    if (parts[0] === 'client' && parts[1]) return await viewClient(Number(parts[1]));
    if (parts[0] === 'property' && parts[1]) return await viewProperty(Number(parts[1]), parts[2] === 'edit');
    if (parts[0] === 'matches') return await viewMatches();
    if (parts[0] === 'chat' && parts[1]) return await viewThread(decodeURIComponent(parts.slice(1).join('/')));
    if (parts[0] === 'chat') return await viewChatList();
    if (parts[0] === 'admin') return await viewAdmin();
    if (parts[0] === 'account') return await viewAccount();
    $app.innerHTML = '<div class="empty">Page not found. <a href="#/">Go to search</a></div>';
  } catch (e) {
    setNav('search');
    $app.innerHTML = `<div class="card"><p class="error">${esc(e.message)}</p><a class="back" href="#/">← Back to search</a></div>`;
  }
}
window.addEventListener('hashchange', route);

// ---------- login ----------
function viewLogin() {
  me = null; agentsCache = null;
  setNav(null);
  $app.innerHTML = `
    <div class="login-wrap">
      <div class="card login-card">
        <div class="emblem" aria-hidden="true"><span><b>J</b>RP</span></div>
        <img class="logo" src="/img/logo-white.png" alt="JRP Investment Group" width="144" height="28">
        <p class="kicker">Client Book · Employees only</p>
        <p class="muted small">Log in with your work email.</p>
        <form id="login-form" autocomplete="on">
          <div class="field"><label for="email">Email</label>
            <input id="email" name="email" type="email" autocomplete="username" required autofocus></div>
          <div class="field"><label for="password">Password</label>
            <div class="pw-wrap">
              <input id="password" name="password" type="password" autocomplete="current-password" required>
              <button type="button" class="pw-toggle" id="pw-toggle" aria-label="Show password" aria-pressed="false">Show</button>
            </div></div>
          <p class="error" id="login-err"></p>
          <button class="btn block" type="submit">Log in</button>
        </form>
      </div>
    </div>`;
  $('#pw-toggle').addEventListener('click', () => {
    const pw = $('#password');
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    $('#pw-toggle').textContent = show ? 'Hide' : 'Show';
    $('#pw-toggle').setAttribute('aria-pressed', String(show));
    $('#pw-toggle').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', e.target);
    btn.disabled = true;
    try {
      me = await api('POST', '/api/login', { email: $('#email').value, password: $('#password').value });
      go('#/');
      setTimeout(refreshUnread, 800);
      pushSync();
    } catch (err) {
      $('#login-err').textContent = err.message;
    } finally { btn.disabled = false; }
  });
}

// ---------- search (home) ----------
// type: all | buyer | seller     agent: '' (everyone) | 'me' | 'none' (unassigned) | employee id
const searchState = { q: '', type: 'all', agent: '' };
async function viewSearch() {
  const navAt = navToken;
  setNav('search');
  const [team, myRem, unread] = await Promise.all([agents(), api('GET', '/api/reminders'), api('GET', '/api/chat/unread')]);
  const ann = unread.latest_announcement;
  if (navAt !== navToken || !onPage('#/')) return;
  $app.innerHTML = `
    <p class="kicker">Client Book</p>
    <h1>Hi, ${esc(me.name.split(' ')[0])}</h1>
    ${ann ? `
    <a class="card announce-banner" href="#/chat/announce">
      <span class="ab-k">📢 New announcement${unread.announce > 1 ? `s (${unread.announce})` : ''}</span>
      <span class="ab-from">${esc(ann.sender_name || 'Management')} · ${esc(fmtAgo(ann.created_at))}</span>
      <span class="ab-body">${esc(ann.body)}</span>
      <span class="ab-open">Open →</span>
    </a>` : ''}
    ${pushAskHtml()}
    ${myRem.length ? `
    <div class="card my-reminders">
      <h2>My reminders <span class="count">${myRem.length}</span></h2>
      <ul class="rem-list">${myRem.slice(0, 6).map((r) => reminderLine(r, { showClient: true })).join('')}</ul>
      ${myRem.length > 6 ? `<p class="muted small">+ ${myRem.length - 6} more later</p>` : ''}
    </div>` : ''}
    <div class="searchbar">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="q" type="search" placeholder="Name, phone, email or address" autocomplete="off" value="${esc(searchState.q)}" aria-label="Search clients">
    </div>
    <div class="filters-row">
      <div class="chips" role="group" aria-label="Buyer or seller">
        ${[['all', 'All'], ['buyer', 'Buyers'], ['seller', 'Sellers']]
          .map(([k, l]) => `<button class="chip ${searchState.type === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}
      </div>
      <label class="agent-filter">
        <span>Agent</span>
        <select id="agent-filter" aria-label="Filter by assigned agent">
          <option value="">Everyone's clients</option>
          <option value="me">My clients</option>
          ${team.filter((a) => a.id !== me.id).map((a) => `<option value="${a.id}">${esc(a.name)}'s clients</option>`).join('')}
          <option value="none">Unassigned</option>
        </select>
      </label>
    </div>
    <div class="spread small muted" style="margin:4px 0 10px"><span id="count"></span><a class="btn small" href="#/new">+ New buyer / seller</a></div>
    <ul class="results" id="results"><li class="empty">Loading…</li></ul>`;

  $('#agent-filter').value = searchState.agent;
  let timer;
  bindPushAsk();
  const input = $('#q');
  input.addEventListener('input', () => {
    searchState.q = input.value;
    clearTimeout(timer);
    timer = setTimeout(runSearch, 250);
  });
  $$('.chip[data-t]').forEach((c) => c.addEventListener('click', () => {
    searchState.type = c.dataset.t;
    $$('.chip[data-t]').forEach((x) => x.classList.toggle('on', x === c));
    runSearch();
  }));
  $('#agent-filter').addEventListener('change', (e) => { searchState.agent = e.target.value; runSearch(); });
  bindReminderDone(() => viewSearch());
  runSearch();
}

// "Last note" box used on search cards and at the top of a profile.
function lastNoteHtml(body, by, at, extra = '') {
  if (!body) return '<div class="last-note none">No notes yet</div>';
  return `<div class="last-note">
      <div class="ln-head"><span class="ln-label">Last note</span> <b>${esc(by || 'Former employee')}</b> · ${esc(fmtAgo(at))} ${extra}</div>
      <div class="ln-body">${esc(body)}</div>
    </div>`;
}

let searchSeq = 0;
async function runSearch() {
  const seq = ++searchSeq;
  const p = new URLSearchParams();
  if (searchState.q.trim()) p.set('q', searchState.q.trim());
  if (searchState.type !== 'all') p.set('type', searchState.type);
  if (searchState.agent === 'me') p.set('mine', '1');
  else if (searchState.agent) p.set('agent', searchState.agent);
  const rows = await api('GET', `/api/clients?${p}`);
  if (seq !== searchSeq || !$('#results')) return;
  $('#count').textContent = searchState.q.trim() || searchState.agent
    ? `${rows.length} result${rows.length === 1 ? '' : 's'}`
    : 'Recently updated';
  $('#results').innerHTML = rows.length ? rows.map((r) => `
    <li><a class="result" href="#/client/${r.id}">
      <div class="spread"><span class="name">${esc(r.name)}</span>${badge(r.type)}</div>
      <div class="agent-line ${r.agent_name ? '' : 'none'}">${r.agent_name ? `Agent: ${esc(r.agent_name)}${r.agent_name === me.name ? ' (you)' : ''}` : 'Unassigned'}</div>
      <div class="meta">${[r.phone, r.email].filter(Boolean).map(esc).join(' · ') || 'No contact info'}</div>
      ${r.first_property ? `<div class="meta">${esc(r.first_property)}${r.property_count > 1 ? ` +${r.property_count - 1} more` : ''}</div>` : ''}
      ${lastNoteHtml(r.last_comment, r.last_comment_by, r.last_comment_at)}
    </a></li>`).join('')
    : `<li class="empty">No matches. <a href="#/new">Add a new buyer or seller</a></li>`;
}

// ---------- reminders: "call this person on ..." + phone calendar ----------
let pendingReminder = null; // set right after a comment is saved, so the next screen asks "Set a reminder?"
const pad2 = (n) => String(n).padStart(2, '0');
function tomorrowAt10() {
  const d = new Date(Date.now() + 24 * 3600e3);
  return { date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, time: '10:00' };
}
function fmtWhen(iso) {
  const d = new Date(iso);
  const today = new Date(); const tmr = new Date(Date.now() + 24 * 3600e3);
  const same = (a, b) => a.toDateString() === b.toDateString();
  const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (same(d, today)) return `Today, ${t}`;
  if (same(d, tmr)) return `Tomorrow, ${t}`;
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
const gcalTime = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function googleCalUrl(r, who) {
  const end = new Date(new Date(r.due_at).getTime() + 15 * 60e3).toISOString();
  const details = [`Call ${who.name}${who.phone ? ` at ${who.phone}` : ''}.`, r.note || '', `${location.origin}/#/client/${who.id}`].filter(Boolean).join('\n');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`Call ${who.name}`)}&dates=${gcalTime(r.due_at)}/${gcalTime(end)}&details=${encodeURIComponent(details)}`;
}

// The box: asks "Set a reminder?" (or goes straight to the form), then offers "Add to my phone's calendar".
function reminderBoxHtml(who, { ask = true, note = '' } = {}) {
  const def = tomorrowAt10();
  return `<div class="reminder-box" id="reminder-box">
      <p class="rb-q">⏰ Set a reminder to call <b>${esc(who.name)}</b>?</p>
      <div class="row" id="rb-ask" ${ask ? '' : 'hidden'}>
        <button type="button" class="btn small" id="rb-yes">Yes, set reminder</button>
        <button type="button" class="btn small ghost" id="rb-no">No thanks</button>
      </div>
      <form id="rb-form" ${ask ? 'hidden' : ''}>
        <div class="grid2">
          <div class="field"><label for="rb-date">Date</label><input type="date" id="rb-date" required value="${def.date}"></div>
          <div class="field"><label for="rb-time">Time</label><input type="time" id="rb-time" required value="${def.time}"></div>
        </div>
        <div class="field"><label for="rb-note">Note (optional)</label><input id="rb-note" maxlength="500" value="${esc(note)}" placeholder="e.g. Ask if the lender approved"></div>
        <div class="row"><button class="btn small" type="submit">Save reminder</button><button type="button" class="btn small ghost" id="rb-cancel">Cancel</button></div>
        <p class="error" id="rb-err"></p>
      </form>
      <div id="rb-done" hidden></div>
    </div>`;
}
function bindReminderBox(who, onSaved) {
  const box = $('#reminder-box');
  if (!box) return;
  const close = () => box.remove();
  const yes = $('#rb-yes', box);
  if (yes) yes.addEventListener('click', () => { $('#rb-ask', box).hidden = true; $('#rb-form', box).hidden = false; $('#rb-date', box).focus(); });
  const no = $('#rb-no', box);
  if (no) no.addEventListener('click', close);
  $('#rb-cancel', box).addEventListener('click', close);
  $('#rb-form', box).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', e.target); btn.disabled = true;
    const when = new Date(`${$('#rb-date', box).value}T${$('#rb-time', box).value}`);
    if (Number.isNaN(when.getTime())) { $('#rb-err', box).textContent = 'Pick a date and time.'; btn.disabled = false; return; }
    try {
      const r = await api('POST', `/api/clients/${who.id}/reminders`, { due_at: when.toISOString(), note: $('#rb-note', box).value });
      $('#rb-form', box).hidden = true;
      $('.rb-q', box).innerHTML = `✅ Reminder saved: call <b>${esc(who.name)}</b> ${esc(fmtWhen(r.due_at))}.`;
      const done = $('#rb-done', box);
      done.innerHTML = `
        <a class="btn block" id="rb-ics" href="/api/reminders/${r.id}/calendar.ics?k=${encodeURIComponent(r.cal_key || '')}">📅 Add to my phone's calendar</a>
        <a class="btn ghost small block" id="rb-gcal" href="${esc(googleCalUrl(r, who))}" target="_blank" rel="noopener">Or add to Google Calendar</a>
        <p class="help">iPhone: tap the button, then <b>Add</b>. Android: open the file with your Calendar app, or use Google Calendar.</p>
        <button type="button" class="btn small ghost" id="rb-close">Close</button>`;
      done.hidden = false;
      $('#rb-close', box).addEventListener('click', () => { close(); if (onSaved) onSaved(); });
    } catch (err) { $('#rb-err', box).textContent = err.message; btn.disabled = false; }
  });
}

// One open reminder line (profile + home screen).
function reminderLine(r, { showClient = false } = {}) {
  const overdue = new Date(r.due_at).getTime() < Date.now();
  const mine = r.user_id === undefined || r.user_id === me.id;
  return `<li class="rem ${overdue ? 'overdue' : ''}" data-rem="${r.id}">
      <div class="rem-main">
        <span class="rem-when">${overdue ? 'Overdue · ' : ''}${esc(fmtWhen(r.due_at))}</span>
        ${showClient ? `<a class="rem-who" href="#/client/${r.client_id}">Call ${esc(r.client_name)}</a>` : `<span class="rem-who">${esc(r.agent_name || '')}</span>`}
        ${r.note ? `<span class="rem-note">${esc(r.note)}</span>` : ''}
      </div>
      <div class="rem-actions">
        ${showClient && r.client_phone ? `<a class="btn small" href="${esc(telUrl(r.client_phone))}">Call</a>` : ''}
        ${mine ? `<a class="btn small ghost" href="/api/reminders/${r.id}/calendar.ics?k=${encodeURIComponent(r.cal_key || '')}" title="Add to calendar">📅</a>` : ''}
        ${mine || me.role === 'admin' ? `<button type="button" class="btn small ghost" data-rem-done="${r.id}">Done</button>` : ''}
      </div>
    </li>`;
}
function bindReminderDone(reload) {
  $$('[data-rem-done]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api('PATCH', `/api/reminders/${b.dataset.remDone}`, { done: true }); toast('Reminder done'); reload(); }
    catch (err) { toast(err.message, true); b.disabled = false; }
  }));
}

// ---------- shared: comments / history / files block ----------
// Used on both the person's profile (everything) and a property page (just that property).
let activeTab = 'comments';

function renderLog(d, { propTags, placeholder, who }) {
  const askReminder = who && pendingReminder && pendingReminder.clientId === who.id;
  const isAdmin = me.role === 'admin';
  const tag = (x) => (propTags && x.property_id
    ? `<a class="prop-tag" href="#/property/${x.property_id}">${esc(x.property_address || 'Property')}</a>` : '');
  const history = [
    ...d.comments.map((m) => ({ t: m.created_at, who: m.author || 'Former employee', body: m.body, kind: 'comment', x: m })),
    ...d.activity.map((a) => ({ t: a.created_at, who: a.user_name || 'Former employee', body: activityText(a), kind: 'sys', x: {} })),
  ].sort((a, b) => (a.t < b.t ? 1 : -1));

  return `
    <div class="card">
      <div class="tabs" role="tablist">
        <button class="tab" data-tab="comments" role="tab">Comments (${d.comments.length})</button>
        <button class="tab" data-tab="history" role="tab">Full history</button>
        <button class="tab" data-tab="files" role="tab">Files (${d.files.length})</button>
      </div>

      <section data-panel="comments">
        ${askReminder ? reminderBoxHtml(who, { note: pendingReminder.note }) : ''}
        <form id="comment-form">
          <label for="comment">What happened? (call, meeting, showing, offer…)</label>
          <textarea id="comment" maxlength="5000" required placeholder="${esc(placeholder)}"></textarea>
          <div class="spread" style="margin-top:8px">
            <span class="muted small">Saved with your name and the current date &amp; time.</span>
            <button class="btn" type="submit">Save comment</button>
          </div>
        </form>
        <ul class="timeline" style="margin-top:14px">
          ${d.comments.length ? d.comments.map((m) => `
            <li><span class="who">${esc(m.author || 'Former employee')}</span>
              <span class="when"> · ${esc(fmtDate(m.created_at))}</span> ${tag(m)}
              <div class="body">${esc(m.body)}</div></li>`).join('') : '<li class="sys muted">No comments yet.</li>'}
        </ul>
      </section>

      <section data-panel="history">
        <p class="muted small">Every comment and change, recorded automatically.</p>
        <ul class="timeline">
          ${history.map((h) => `
            <li class="${h.kind === 'sys' ? 'sys' : ''}"><span class="who">${esc(h.who)}</span>
              <span class="when"> · ${esc(fmtDate(h.t))}</span> ${tag(h.x)}
              <div class="body ${h.kind === 'sys' ? 'muted small' : ''}">${esc(h.body)}</div></li>`).join('')}
        </ul>
      </section>

      <section data-panel="files">
        <form id="file-form" class="row" style="margin-bottom:10px">
          <input type="file" id="file-input" multiple style="flex:1;min-width:200px">
          <button class="btn" type="submit">Upload</button>
        </form>
        ${d.files.length ? d.files.map((f) => `
          <div class="file">
            <div><a href="/api/files/${f.id}?view=1" target="_blank" rel="noopener">${esc(f.original_name)}</a>
              <div class="muted small">${esc(fmtSize(f.size))} · ${esc(f.uploaded_by || '—')} · ${esc(fmtDate(f.created_at))} ${tag(f)}</div></div>
            <div class="row">
              <a class="btn small ghost" href="/api/files/${f.id}">Download</a>
              ${isAdmin ? `<button class="btn small danger" data-del-file="${f.id}">Delete</button>` : ''}
            </div>
          </div>`).join('') : '<p class="muted">No files yet.</p>'}
      </section>
    </div>`;
}

function bindLog(baseUrl, reload, who) {
  if (who && pendingReminder && pendingReminder.clientId === who.id) {
    pendingReminder = null;
    bindReminderBox(who, reload);
  }
  const showTab = (t) => {
    activeTab = t;
    $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== t; });
  };
  $$('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  showTab(activeTab);

  $('#comment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', e.target); btn.disabled = true;
    try {
      const text = $('#comment').value.trim();
      await api('POST', `${baseUrl}/comments`, { body: text });
      if (who) pendingReminder = { clientId: who.id, note: text.length > 80 ? `${text.slice(0, 77)}…` : text };
      toast('Comment saved'); activeTab = 'comments'; reload();
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  });

  $('#file-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const files = $('#file-input').files;
    if (!files.length) return toast('Choose a file first', true);
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    const btn = $('button', e.target); btn.disabled = true; btn.textContent = 'Uploading…';
    try { await api('POST', `${baseUrl}/files`, fd); toast('Uploaded'); activeTab = 'files'; reload(); }
    catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = 'Upload'; }
  });
  $$('[data-del-file]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this file permanently?')) return;
    try { await api('DELETE', `/api/files/${b.dataset.delFile}`); toast('Deleted'); reload(); }
    catch (err) { toast(err.message, true); }
  }));
}

// ---------- questions & matching (shared) ----------
let questionsCache = null;
async function questions() {
  if (!questionsCache) questionsCache = await api('GET', '/api/questions');
  return questionsCache;
}
const fmtMoney = (n) => (n === null || n === undefined || n === '' ? '' : '$' + Math.round(Number(n)).toLocaleString('en-US'));
const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);

function fmtAnswer(q, v) {
  if (isEmpty(v)) return '';
  if (q.type === 'money') return fmtMoney(v);
  if (q.type === 'number') return Number(v).toLocaleString('en-US');
  if (q.type === 'multiselect') return v.join(', ');
  if (q.type === 'yesno') return v === 'yes' ? 'Yes' : 'No';
  return String(v);
}

// Read-only list of answers.
function answersHtml(list, values, emptyMsg) {
  const asked = list.filter((q) => isShown(q, values));
  const answered = asked.filter((q) => !isEmpty(values[q.key]));
  if (!answered.length) return `<p class="muted">${esc(emptyMsg)}</p>`;
  const missing = asked.length - answered.length;
  return `<ul class="contact-list">${answered.map((q) => `
      <li><span class="k">${esc(q.label)}</span><span class="v" style="white-space:pre-wrap">${esc(fmtAnswer(q, values[q.key]))}</span></li>`).join('')}
    </ul>${missing ? `<p class="muted small" style="margin:8px 0 0">Not answered yet: ${asked.filter((q) => isEmpty(values[q.key])).map((q) => `<b>${esc(q.label)}</b>`).join(', ')}</p>` : ''}`;
}

// Same rules as src/match.js: is a question asked, and which options fit?
function isShown(q, values) {
  if (!q.showIf) return true;
  const v = values[q.showIf.key];
  return q.showIf.in ? q.showIf.in.includes(v) : v === q.showIf.equals;
}
function allowedOptions(q, values) {
  if (!q.optionsBy) return q.options;
  return q.optionsBy.groups[values[q.optionsBy.key]] || q.options;
}
const optionTags = (opts, v) => `<option value="">Not answered</option>${opts.map((o) => `<option value="${esc(o)}" ${v === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}`;

// Form inputs built from the question list in src/questions.js.
function questionFields(list, values, prefix) {
  return list.map((q) => {
    const id = `${prefix}-${q.key}`;
    const v = values[q.key];
    const help = q.help ? `<span class="help">${esc(q.help)}</span>` : '';
    let input;
    if (q.type === 'money') {
      const auto = q.autoFrom ? ` data-auto-from="${prefix}-${esc(q.autoFrom.key)}" data-times="${Number(q.autoFrom.times)}"` : '';
      input = `<div class="money-in"><span>$</span><input id="${id}" inputmode="decimal" autocomplete="off" placeholder="0"${auto} value="${isEmpty(v) ? '' : esc(Number(v).toLocaleString('en-US'))}"></div>`;
    } else if (q.type === 'number') {
      input = `<input id="${id}" inputmode="decimal" autocomplete="off" value="${isEmpty(v) ? '' : esc(v)}">`;
    } else if (q.type === 'select' || q.type === 'yesno') {
      const by = q.optionsBy ? ` data-opts-by="${prefix}-${esc(q.optionsBy.key)}" data-q="${esc(q.key)}"` : '';
      input = q.type === 'yesno'
        ? `<select id="${id}"><option value="">Not answered</option>${[['yes', 'Yes'], ['no', 'No']].map(([val, l]) => `<option value="${val}" ${v === val ? 'selected' : ''}>${l}</option>`).join('')}</select>`
        : `<select id="${id}"${by}>${optionTags(allowedOptions(q, values), v)}</select>`;
    } else if (q.type === 'multiselect') {
      const ok = allowedOptions(q, values);
      const by = q.optionsBy ? ` data-opts-by="${prefix}-${esc(q.optionsBy.key)}" data-q="${esc(q.key)}"` : '';
      input = `<div class="checks" id="${id}" role="group" aria-label="${esc(q.label)}"${by}>${q.options.map((o) => `
        <label class="check" ${ok.includes(o) ? '' : 'hidden'}><input type="checkbox" value="${esc(o)}" ${Array.isArray(v) && v.includes(o) ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div>`;
    } else if (q.type === 'textarea') {
      input = `<textarea id="${id}" maxlength="2000">${esc(v)}</textarea>`;
    } else {
      input = `<input id="${id}" maxlength="200" value="${esc(v)}">`;
    }
    const cond = q.showIf
      ? ` data-showif="${prefix}-${esc(q.showIf.key)}" data-in="${esc((q.showIf.in || [q.showIf.equals]).join('|'))}" ${isShown(q, values) ? '' : 'hidden'}`
      : '';
    return `<div class="field"${cond}>${q.type === 'multiselect' ? `<span class="label">${esc(q.label)}</span>` : `<label for="${id}">${esc(q.label)}</label>`}${input}${help}</div>`;
  }).join('');
}

function readQuestionFields(list, prefix) {
  const out = {};
  for (const q of list) {
    const el = document.getElementById(`${prefix}-${q.key}`);
    if (!el) continue;
    const field = el.closest('.field');
    if (field && field.hidden) { out[q.key] = q.type === 'multiselect' ? [] : ''; continue; } // not asked = cleared
    out[q.key] = q.type === 'multiselect' ? $$('label:not([hidden]) input:checked', el).map((i) => i.value) : el.value;
  }
  return out;
}

// ----- match meter + "See why" calculator -----
const LEVEL_SHORT = { great: 'great', good: 'good', average: 'average', poor: 'not good', incomplete: 'need info' };
const STATUS_ICON = { match: '✓', partial: '~', miss: '✕', missing: '?', any: '–' };

function meterHtml(m) {
  const w = m.score === null ? 100 : Math.max(4, m.score);
  return `<div class="meter lvl-${esc(m.level)}">
      <div class="meter-top"><span class="meter-label">${esc(m.label)}</span><span class="meter-score">${m.score !== null ? `${m.score}/100` : m.fitSoFar !== null && m.fitSoFar !== undefined ? `Other details fit ${m.fitSoFar}%` : '—'}</span></div>
      <div class="meter-bar"><span style="width:${w}%"></span></div>
    </div>`;
}

function whyHtml(m) {
  const price = m.parts.find((x) => x.key === 'price' && x.calc);
  let calc = '';
  if (price) {
    const c = price.calc;
    calc = `<div class="calc">
        <p class="calc-title">Price calculator</p>
        <div class="calc-row"><span>Seller is asking</span><b>${fmtMoney(c.asking)}</b></div>
        <div class="calc-row"><span>Buyer's funds (total)${c.estimated ? ' <small>(5 × down payment)</small>' : ''}</span><b>${fmtMoney(c.budget)}</b></div>
        ${c.cash !== undefined ? `<div class="calc-row"><span>Buyer's cash injection</span><b>${fmtMoney(c.cash)} <small>(${c.cashPctOfAsking.toFixed(1)}% of asking)</small></b></div>` : ''}
        <div class="calc-row total ${c.direction}"><span>${c.direction === 'over' ? 'Short of asking by' : c.difference === 0 ? 'Difference' : 'Left over after buying'}</span>
          <b>${fmtMoney(c.difference)} <small>(${c.pctOfBudget.toFixed(1)}% of funds)</small></b></div>
        ${c.direction === 'over' ? `
        <div class="calc-row"><span>To close the gap, the buyer adds</span><b>${fmtMoney(c.difference)}</b></div>
        <div class="calc-row"><span>…or the seller lowers the price by</span><b>${c.sellerDropPct.toFixed(1)}%</b></div>` : ''}
      </div>`;
  }
  const parts = m.parts.map((x) => `
      <li class="st-${esc(x.status)}"><span class="ic" aria-hidden="true">${STATUS_ICON[x.status] || '–'}</span>
        <div><b>${esc(x.label)}</b>${x.score !== null ? ` <span class="muted small">${x.score}/100</span>` : ''}
        <div class="small">${esc(x.text)}</div></div></li>`).join('');
  let math = `<p class="score-math small">${m.fitSoFar !== null && m.fitSoFar !== undefined ? `Everything else that can be compared fits ${m.fitSoFar}%. ` : ''}Fill in the missing answers (marked ?) to get a full score.</p>`;
  if (m.math) {
    const raw = Math.round(m.math.lines.reduce((a, l) => a + (l.score * l.weightPct) / 100, 0));
    math = `<p class="score-math small">Score: ${m.math.lines.map((l) => `${esc(l.label)} ${l.score} × ${l.weightPct}%`).join(' + ')} = <b>${raw}/100</b>
      ${m.math.capped ? `<br>${esc(m.math.capped)}` : ''}</p>`;
  }
  return `${calc}<ul class="why-list">${parts}</ul>${math}`;
}

let whySeq = 0;
// "See why" details are only built when someone taps the button (keeps long lists light on old phones).
const whyStore = new Map();
function matchItem(m, mode) {
  const id = `why-${++whySeq}`;
  whyStore.set(id, m);
  const L = m.listing;
  const B = m.buyer;
  const listingHtml = L ? `
      <a href="#/property/${L.id}" class="mi-title">${esc(L.address)}</a>
      <div class="meta small">${[L.type, L.brand, L.asking !== null ? `Asking ${fmtMoney(L.asking)}` : null].filter(Boolean).map(esc).join(' · ') || 'No listing details yet'}</div>
      <div class="meta small">Seller <a href="#/client/${L.client_id}">${esc(L.client_name)}</a> · Agent: ${esc(L.agent_name || 'Unassigned')}</div>` : '';
  const buyerHtml = B ? `
      <a href="#/client/${B.id}" class="mi-title">${esc(B.name)}</a>
      <div class="meta small">${[B.budget !== null ? `Funds ${fmtMoney(B.budget)}` : null, B.cash !== null ? `Cash ${fmtMoney(B.cash)}` : null,
        B.brands.length ? B.brands.join('/') : null, B.states].filter(Boolean).map(esc).join(' · ') || 'No buyer answers yet'}</div>
      <div class="meta small">Buyer's agent: ${esc(B.agent_name || 'Unassigned')}</div>` : '';
  const head = mode === 'listing' ? listingHtml : mode === 'buyer' ? buyerHtml
    : `<div class="pair"><div><span class="pair-k">Buyer</span>${buyerHtml}</div><div><span class="pair-k">Property</span>${listingHtml}</div></div>`;
  return `<li class="match-item lvl-${esc(m.level)}">
      ${head}
      ${meterHtml(m)}
      <button type="button" class="btn small ghost why-btn" data-why="${id}" aria-expanded="false" aria-controls="${id}">See why</button>
      <div class="why" id="${id}" hidden></div>
    </li>`;
}

function matchCounts(list) {
  const c = { great: 0, good: 0, average: 0, poor: 0, incomplete: 0 };
  list.forEach((m) => { c[m.level] += 1; });
  return `<div class="match-counts">${Object.keys(c).filter((k) => c[k]).map((k) => `<span class="mc lvl-${k}">${c[k]} ${LEVEL_SHORT[k]}</span>`).join('')}</div>`;
}

function matchesCard(title, list, mode, emptyMsg) {
  return `<div class="card" id="matches-card">
      <h2>${esc(title)} <span class="count">${list.length}</span></h2>
      ${list.length ? matchCounts(list) : ''}
      <ul class="match-list">${list.slice(0, 10).map((m) => matchItem(m, mode)).join('') || `<li class="muted">${esc(emptyMsg)}</li>`}</ul>
      ${list.length > 10 ? `<button class="btn small ghost block" id="show-all-matches">Show all ${list.length}</button>` : ''}
    </div>`;
}
function bindMatchesCard(list, mode) {
  const b = $('#show-all-matches');
  if (b) b.addEventListener('click', () => { $('#matches-card .match-list').innerHTML = list.map((m) => matchItem(m, mode)).join(''); b.remove(); });
}

// Show or hide follow-up questions (e.g. "If yes, how much?") as answers change.
document.addEventListener('change', (e) => {
  if (!e.target.id) return;
  $$(`[data-showif="${CSS.escape(e.target.id)}"]`).forEach((f) => { f.hidden = !f.dataset.in.split('|').includes(e.target.value); });
  // Residential / Commercial changed: show only the property types that fit.
  $$(`[data-opts-by="${CSS.escape(e.target.id)}"]`).forEach((el) => {
    const q = (questionsCache.seller.concat(questionsCache.buyer)).find((x) => x.key === el.dataset.q && x.optionsBy);
    if (!q) return;
    const ok = allowedOptions(q, { [q.optionsBy.key]: e.target.value });
    if (el.tagName === 'SELECT') {
      const keep = ok.includes(el.value) ? el.value : '';
      el.innerHTML = optionTags(ok, keep); // rebuilt, because iPhones ignore hidden <option>s
    } else {
      $$('label.check', el).forEach((l) => {
        const show = ok.includes(l.querySelector('input').value);
        l.hidden = !show;
        if (!show) l.querySelector('input').checked = false;
      });
    }
  });
});

// Funds fills itself in as 5 x the down payment, unless the agent typed their own number.
const moneyVal = (el) => Number(String(el.value).replace(/[$,\s]/g, '')) || 0;
document.addEventListener('focusin', (e) => {
  const t = e.target;
  if (t.id && t.dataset.prev === undefined && $(`[data-auto-from="${CSS.escape(t.id)}"]`)) t.dataset.prev = String(moneyVal(t));
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!t.id || t.dataset.autoFrom) return;
  $$(`[data-auto-from="${CSS.escape(t.id)}"]`).forEach((f) => {
    const times = Number(f.dataset.times);
    const prev = Number(t.dataset.prev || 0);
    // Only replace Funds if it is empty or still equal to the old auto value.
    if (f.value.trim() && moneyVal(f) !== Math.round(prev * times)) return;
    const cash = moneyVal(t);
    f.value = cash > 0 ? Math.round(cash * times).toLocaleString('en-US') : '';
  });
  t.dataset.prev = String(moneyVal(t));
});

// One click handler for every "See why" button on any screen.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-why]');
  if (!b) return;
  const el = document.getElementById(b.dataset.why);
  if (!el.dataset.filled && whyStore.has(b.dataset.why)) { el.innerHTML = whyHtml(whyStore.get(b.dataset.why)); el.dataset.filled = '1'; }
  el.hidden = !el.hidden;
  b.textContent = el.hidden ? 'See why' : 'Hide';
  b.setAttribute('aria-expanded', String(!el.hidden));
});

// ---------- matches page ----------
const matchState = { level: 'great', mine: false };
async function viewMatches() {
  const navAt = navToken;
  setNav('matches');
  const q = new URLSearchParams();
  if (matchState.level) q.set('level', matchState.level);
  if (matchState.mine) q.set('mine', '1');
  const d = await api('GET', `/api/matches?${q}`);
  const all = Object.values(d.counts).reduce((a, b) => a + b, 0);
  if (navAt !== navToken || !onPage('#/matches')) return;
  $app.innerHTML = `
    <p class="kicker">Matching</p>
    <h1>Buyer ↔ seller matches</h1>
    <p class="muted small">Every buyer is compared with every property for sale: ${d.buyers} buyer${d.buyers === 1 ? '' : 's'} × ${d.listings} listing${d.listings === 1 ? '' : 's'}.</p>
    <div class="chips" role="group" aria-label="Match level">
      ${[['great', 'Great'], ['good', 'Good'], ['average', 'Average'], ['poor', 'Not good'], ['incomplete', 'Need info'], ['', 'All']]
        .map(([k, l]) => `<button class="chip lvl-chip ${k ? `lvl-${k}` : ''} ${matchState.level === k ? 'on' : ''}" data-l="${k}">${l} (${k ? d.counts[k] : all})</button>`).join('')}
    </div>
    <label class="check inline"><input type="checkbox" id="only-mine" ${matchState.mine ? 'checked' : ''}><span>Only matches with my buyers or sellers</span></label>
    <ul class="match-list">${d.matches.map((m) => matchItem(m, 'pair')).join('') || '<li class="empty">No matches at this level.</li>'}</ul>
    ${d.total > d.matches.length ? `<p class="muted small">Showing the top ${d.matches.length} of ${d.total}.</p>` : ''}`;
  $$('.chip[data-l]').forEach((c) => c.addEventListener('click', () => { matchState.level = c.dataset.l; viewMatches(); }));
  $('#only-mine').addEventListener('change', (e) => { matchState.mine = e.target.checked; viewMatches(); });
}

// "Not now" on the 1031 prompt is remembered on this device only.
const dismissKey = (id) => `jrp-1031-dismissed-${id}`;
function dismissed1031(id) { try { return localStorage.getItem(dismissKey(id)) === '1'; } catch { return false; } }
function dismiss1031(id) { try { localStorage.setItem(dismissKey(id), '1'); } catch { /* ignore */ } }
function undismiss1031(id) { try { localStorage.removeItem(dismissKey(id)); } catch { /* ignore */ } }

// ---------- person profile (buyer / seller) ----------
let lastClientId = null;
async function viewClient(id) {
  const navAt = navToken;
  setNav('search');
  if (lastClientId !== id) { activeTab = 'comments'; lastClientId = id; }
  const [c, Q, mres] = await Promise.all([api('GET', `/api/clients/${id}`), questions(), api('GET', `/api/clients/${id}/matches`)]);
  const isAdmin = me.role === 'admin';
  const many = c.properties.length > 4;
  const isBuyer = c.type === 'buyer' || c.type === 'both';
  const who = { id: c.id, name: c.name, phone: c.phone };
  const isSeller = c.type === 'seller' || c.type === 'both';
  const propInfo = (p) => {
    const d = p.details || {};
    const bits = [d.listing_status, d.property_type, isEmpty(d.asking_price) ? null : `Asking ${fmtMoney(d.asking_price)}`].filter(Boolean);
    let counts = '';
    if (isSeller && isEmpty(d.asking_price) && d.listing_status !== 'Not for sale') {
      return `${bits.length ? `<span class="small listing-line">${bits.map(esc).join(' · ')}</span>` : ''}<span class="needs-details">+ Tap to add listing details (asking price, brand, gas volume…)</span>`;
    }
    if (p.for_sale) {
      const mc = p.match_counts || { great: 0, good: 0 };
      counts = mc.great || mc.good
        ? `<span class="mc lvl-great">${mc.great} great</span><span class="mc lvl-good">${mc.good} good</span> <span class="muted small">buyer matches</span>`
        : isEmpty(d.asking_price) ? '<span class="muted small">Add the asking price to find buyers</span>' : '<span class="muted small">No strong buyer matches yet</span>';
    }
    return `${bits.length ? `<span class="small listing-line">${bits.map(esc).join(' · ')}</span>` : ''}${counts ? `<span class="match-counts tight">${counts}</span>` : ''}`;
  };

  if (navAt !== navToken || !onPage(`#/client/${id}`)) return;
  $app.innerHTML = `
    <a href="#/" class="back">← Back to search</a>
    <div class="card client-head" style="margin-top:8px">
      <div class="spread">
        <div>
          <h1>${esc(c.name)}</h1>
          ${badge(c.type)} <span class="agent-line inline ${c.agent_name ? '' : 'none'}">${c.agent_name ? `Agent: ${esc(c.agent_name)}${c.assigned_agent_id === me.id ? ' (you)' : ''}` : 'Unassigned'}</span>
        </div>
        <a class="btn ghost small" href="#/client/${c.id}/edit">Edit</a>
      </div>
      ${(() => {
        const m = c.comments[0];
        if (!m) return lastNoteHtml(null);
        const tag = m.property_id ? `<a class="prop-tag" href="#/property/${m.property_id}">${esc(m.property_address || 'Property')}</a>` : '';
        return lastNoteHtml(m.body, m.author, m.created_at, tag);
      })()}
      <div class="quick">
        ${c.phone ? `<a class="btn small" href="${esc(telUrl(c.phone))}">Call</a>` : '<span></span>'}
        ${c.phone ? `<a class="btn small ghost" href="sms:${esc(c.phone.replace(/[^\d+]/g, ''))}">Text</a>` : '<span></span>'}
        ${c.email ? `<a class="btn small ghost" href="mailto:${esc(c.email)}">Email</a>` : '<span></span>'}
      </div>
      ${c.reminders.length ? `<ul class="rem-list">${c.reminders.map((r) => reminderLine(r)).join('')}</ul>` : ''}
      <div class="grid2 head-actions">
        <button type="button" class="btn small ghost" id="add-reminder">⏰ Set a reminder</button>
        <button type="button" class="btn small ghost" id="share-client">💬 Send to a colleague</button>
      </div>
      <div id="rem-slot"></div>
      <div id="share-slot"></div>
    </div>

    ${c.type === 'seller' && (c.properties || []).some((p) => p.details && p.details.exchange_1031 === 'yes') && !dismissed1031(c.id) ? `
    <div class="card prompt-1031" id="prompt-1031">
      <p class="kicker">1031 exchange</p>
      <h2>${esc(c.name)} is doing a 1031 exchange</h2>
      <p>They will need to buy a replacement property, so they are a potential buyer as well as a seller.
        Make them a <b>Buyer &amp; Seller</b> so you can add what they want to buy and match them with listings?</p>
      <div class="row">
        <button class="btn small" id="make-both">Yes, make Buyer &amp; Seller</button>
        <button class="btn small ghost" id="not-now-1031">Not now</button>
      </div>
    </div>` : ''}

    ${isBuyer ? `
    <div class="card" id="buyer-card">
      <div class="spread"><h2>What they want to buy</h2><button class="btn small ghost" id="edit-buyer">Edit answers</button></div>
      <div id="buyer-answers">${answersHtml(Q.buyer, c.details, 'No answers yet. Tap "Edit answers" so the app can match this buyer with sellers.')}</div>
      <form id="buyer-form" hidden style="margin-top:12px">
        ${questionFields(Q.buyer, c.details, 'bq')}
        <div class="row"><button class="btn small" type="submit">Save answers</button><button class="btn small ghost" type="button" id="buyer-cancel">Cancel</button></div>
      </form>
    </div>
    ${matchesCard('Matching properties for sale', mres.matches, 'listing', 'No properties for sale yet.')}` : ''}

    <div class="card">
      <div class="spread">
        <h2>${isSeller ? 'Properties / listings' : 'Properties / sites'} <span class="count">${c.properties.length}</span></h2>
        <button class="btn small" id="add-prop">+ Add property</button>
      </div>
      <form id="prop-form" hidden style="margin:12px 0">
        <div class="field"><label for="p-addr">Address</label><input id="p-addr" required maxlength="300" placeholder="123 Main St, Modesto, CA"></div>
        <div class="field"><label for="p-notes">Notes (optional)</label><input id="p-notes" maxlength="1000" placeholder="e.g. 3 bed / 2 bath, listing price, lot size"></div>
        <div class="row"><button class="btn small" type="submit">Save property</button><button class="btn small ghost" type="button" id="p-cancel">Cancel</button></div>
      </form>
      ${many ? '<input id="prop-filter" type="search" placeholder="Find a property by address" aria-label="Find a property" style="margin-top:12px">' : ''}
      <ul class="prop-list" id="prop-list">
        ${c.properties.length ? c.properties.map((p) => `
          <li data-addr="${esc(p.address.toLowerCase())}">
            <a class="prop-link" href="#/property/${p.id}${isSeller && isEmpty((p.details || {}).asking_price) && (p.details || {}).listing_status !== 'Not for sale' ? '/edit' : ''}">
              <span class="addr">${esc(p.address)}</span>
              ${propInfo(p)}
              ${p.notes ? `<span class="muted small notes">${esc(p.notes)}</span>` : ''}
              <span class="muted small">${p.comment_count} comment${p.comment_count === 1 ? '' : 's'} · ${p.file_count} file${p.file_count === 1 ? '' : 's'}${p.last_comment_at ? ` · last note ${esc(fmtAgo(p.last_comment_at))}` : ''}</span>
            </a>
          </li>`).join('') : '<li class="muted" style="padding:12px 0">No properties yet. Tap <b>+ Add property</b>.</li>'}
      </ul>
    </div>

    <div class="card">
      <h2>Contact info</h2>
      <ul class="contact-list">
        <li><span class="k">Phone</span><span class="v">${c.phone ? `<a href="${esc(telUrl(c.phone))}">${esc(c.phone)}</a>` : '<span class="muted">—</span>'}</span></li>
        <li><span class="k">Email</span><span class="v">${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '<span class="muted">—</span>'}</span></li>
        <li><span class="k">Mailing address</span><span class="v">${esc(c.mailing_address) || '<span class="muted">—</span>'}</span></li>
        <li><span class="k">Added</span><span class="v">${esc(fmtDate(c.created_at))} by ${esc(c.created_by_name || '—')}</span></li>
      </ul>
    </div>

    ${renderLog(c, { propTags: true, placeholder: 'e.g. Called buyer, interested in 2nd showing on Saturday. Budget firm at $450k.', who })}

    ${isAdmin ? `<div style="text-align:center;margin:24px 0"><button class="btn danger small" id="del-client">Delete this ${esc(typeLabel[c.type].toLowerCase())} permanently</button></div>` : ''}
  `;

  bindLog(`/api/clients/${id}`, () => viewClient(id), who);
  bindReminderDone(() => viewClient(id));
  $('#share-client').addEventListener('click', () => openShareBox(c));
  $('#add-reminder').addEventListener('click', () => {
    const slot = $('#rem-slot');
    if ($('#reminder-box')) return;
    slot.innerHTML = reminderBoxHtml(who, { ask: false });
    bindReminderBox(who, () => viewClient(id));
    $('#rb-date').focus();
  });
  const mb = $('#make-both');
  if (mb) {
    mb.addEventListener('click', async () => {
      try {
        await api('PATCH', `/api/clients/${id}`, { type: 'both' });
        toast('Now a Buyer & Seller. Add what they want to buy.');
        await viewClient(id);
        const eb = $('#edit-buyer');
        if (eb) { eb.click(); eb.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      } catch (err) { toast(err.message, true); }
    });
    $('#not-now-1031').addEventListener('click', () => { dismiss1031(id); $('#prompt-1031').remove(); });
  }
  if (isBuyer) {
    bindMatchesCard(mres.matches, 'listing');
    const bf = $('#buyer-form');
    $('#edit-buyer').addEventListener('click', () => { bf.hidden = false; $('#buyer-answers').hidden = true; $('#edit-buyer').hidden = true; });
    $('#buyer-cancel').addEventListener('click', () => { bf.hidden = true; $('#buyer-answers').hidden = false; $('#edit-buyer').hidden = false; });
    bf.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const answers = readQuestionFields(Q.buyer, 'bq');
        await api('PATCH', `/api/clients/${id}`, { details: answers });
        toast('Answers saved');
        await viewClient(id);
      } catch (err) { toast(err.message, true); }
    });
  }

  const filter = $('#prop-filter');
  if (filter) filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    $$('#prop-list li[data-addr]').forEach((li) => { li.hidden = q && !li.dataset.addr.includes(q); });
  });

  const pf = $('#prop-form');
  $('#add-prop').addEventListener('click', () => { pf.hidden = false; $('#p-addr').value = ''; $('#p-notes').value = ''; $('#p-addr').focus(); });
  $('#p-cancel').addEventListener('click', () => { pf.hidden = true; });
  pf.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', `/api/clients/${id}/properties`, { address: $('#p-addr').value, notes: $('#p-notes').value });
      if (isSeller && r.id) { toast('Property added. Now answer its listing questions.'); go(`#/property/${r.id}/edit`); }
      else { toast('Property added'); viewClient(id); }
    } catch (err) { toast(err.message, true); }
  });

  const del = $('#del-client');
  if (del) del.addEventListener('click', async () => {
    if (prompt(`Type DELETE to permanently remove ${c.name}, with all comments, properties and files.`) !== 'DELETE') return;
    try { await api('DELETE', `/api/clients/${id}`); toast('Deleted'); go('#/'); }
    catch (err) { toast(err.message, true); }
  });
}

// ---------- property page ----------
let lastPropId = null;
async function viewProperty(id, startEditing = false) {
  const navAt = navToken;
  setNav('search');
  if (lastPropId !== id) { activeTab = 'comments'; lastPropId = id; }
  const [p, Q, mres] = await Promise.all([api('GET', `/api/properties/${id}`), questions(), api('GET', `/api/properties/${id}/matches`)]);
  const isAdmin = me.role === 'admin';
  const sellerSide = p.client_type === 'seller' || p.client_type === 'both';

  if (navAt !== navToken || !(onPage(`#/property/${id}`) || onPage(`#/property/${id}/edit`))) return;
  $app.innerHTML = `
    <a href="#/client/${p.client_id}" class="back">← ${esc(p.client_name)}</a>
    <div class="card client-head" style="margin-top:8px">
      <p class="kicker">Property / site</p>
      <h1 class="prop-title">${esc(p.address)}</h1>
      <p class="owner">
        ${badge(p.client_type)}
        <a href="#/client/${p.client_id}">${esc(p.client_name)}</a>
      </p>
      <div class="quick">
        <a class="btn small" href="${esc(mapsUrl(p.address))}" target="_blank" rel="noopener">Map</a>
        ${p.client_phone ? `<a class="btn small ghost" href="${esc(telUrl(p.client_phone))}">Call</a>` : '<span></span>'}
        <button class="btn small ghost" id="edit-prop">Edit</button>
      </div>
    </div>

    <div class="card">
      <div class="spread"><h2>${sellerSide ? 'Listing details' : 'Details'}</h2><button class="btn small ghost" id="edit-prop-2">Edit</button></div>
      <form id="prop-form" hidden style="margin:12px 0">
        <div class="field"><label for="p-addr">Address</label><input id="p-addr" required maxlength="300" value="${esc(p.address)}"></div>
        ${sellerSide ? questionFields(Q.seller, p.details, 'sq') : ''}
        <div class="field"><label for="p-notes">Notes</label><textarea id="p-notes" maxlength="1000">${esc(p.notes)}</textarea></div>
        <div class="row"><button class="btn small" type="submit">Save</button><button class="btn small ghost" type="button" id="p-cancel">Cancel</button></div>
      </form>
      <div id="prop-details">
        ${sellerSide ? answersHtml(Q.seller, p.details, 'No listing details yet. Tap "Edit" and add the asking price and property type so the app can find buyers.') : ''}
        <ul class="contact-list">
          <li><span class="k">Notes</span><span class="v" style="white-space:pre-wrap">${esc(p.notes) || '<span class="muted">—</span>'}</span></li>
          <li><span class="k">Owner / client</span><span class="v"><a href="#/client/${p.client_id}">${esc(p.client_name)}</a> (${esc(typeLabel[p.client_type])})</span></li>
          <li><span class="k">Added</span><span class="v">${esc(fmtDate(p.created_at))} by ${esc(p.created_by_name || '—')}</span></li>
        </ul>
      </div>
    </div>

    ${sellerSide ? (mres.for_sale
      ? matchesCard('Matching buyers', mres.matches, 'buyer', 'No buyers yet.')
      : `<div class="card"><h2>Matching buyers</h2><p class="muted">This property is marked "${esc(p.details.listing_status || 'Not for sale')}", so it is not matched with buyers. Set the listing status to "For sale" to see matches.</p></div>`) : ''}

    ${renderLog(p, { propTags: false, placeholder: 'e.g. Showed this property to the Gills. They liked the backyard, asked about HOA fees.', who: { id: p.client_id, name: p.client_name, phone: p.client_phone } })}

    ${isAdmin ? '<div style="text-align:center;margin:24px 0"><button class="btn danger small" id="del-prop">Remove this property</button></div>' : ''}
  `;

  bindLog(`/api/properties/${id}`, () => viewProperty(id), { id: p.client_id, name: p.client_name, phone: p.client_phone });
  if (sellerSide && mres.for_sale) bindMatchesCard(mres.matches, 'buyer');

  const pf = $('#prop-form');
  const openEdit = () => { pf.hidden = false; $('#prop-details').hidden = true; pf.scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#p-addr').focus(); };
  $('#edit-prop').addEventListener('click', openEdit);
  $('#edit-prop-2').addEventListener('click', openEdit);
  if (startEditing) openEdit();
  $('#p-cancel').addEventListener('click', () => { pf.hidden = true; $('#prop-details').hidden = false; });
  pf.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const body = { address: $('#p-addr').value, notes: $('#p-notes').value };
      if (sellerSide) body.details = readQuestionFields(Q.seller, 'sq');
      await api('PATCH', `/api/properties/${id}`, body);
      if (body.details && body.details.exchange_1031 === 'yes' && p.details.exchange_1031 !== 'yes') {
        undismiss1031(p.client_id);
        if (p.client_type === 'seller'
          && confirm(`${p.client_name} is doing a 1031 exchange, so they will buy a replacement property.\n\nMake them a Buyer & Seller and add what they want to buy?`)) {
          await api('PATCH', `/api/clients/${p.client_id}`, { type: 'both' });
          toast('Now a Buyer & Seller. Add what they want to buy.');
          go(`#/client/${p.client_id}`);
          return;
        }
      }
      if (onPage(`#/property/${id}/edit`)) { history.replaceState(null, '', `#/property/${id}`); }
      toast('Saved'); viewProperty(id);
    } catch (err) { toast(err.message, true); }
  });

  const del = $('#del-prop');
  if (del) del.addEventListener('click', async () => {
    if (!confirm(`Remove ${p.address}? Its comments and files stay on ${p.client_name}'s profile.`)) return;
    try { await api('DELETE', `/api/properties/${id}`); toast('Removed'); go(`#/client/${p.client_id}`); }
    catch (err) { toast(err.message, true); }
  });
}

function activityText(a) {
  const map = {
    created: a.detail,
    edited: a.detail,
    property_added: `Added property: ${a.detail}`,
    property_edited: `Edited property: ${a.detail}`,
    property_removed: `Removed property: ${a.detail}`,
    file_uploaded: `Uploaded file: ${a.detail}`,
    file_removed: `Deleted file: ${a.detail}`,
    reminder_set: `Set a reminder to call: ${a.detail ? fmtWhen(a.detail) : ''}`,
    reminder_done: `Completed the call reminder (was due ${a.detail ? fmtWhen(a.detail) : ''})`,
  };
  return map[a.action] || `${a.action}${a.detail ? ': ' + a.detail : ''}`;
}

// ---------- new / edit client ----------
async function viewClientForm(id) {
  const navAt = navToken;
  setNav(id ? 'search' : 'new');
  const c = id ? await api('GET', `/api/clients/${id}`) : { type: 'buyer', assigned_agent_id: me.id, details: {} };
  const [list, Q] = await Promise.all([agents(), questions()]);
  if (navAt !== navToken || !onPage(id ? `#/client/${id}/edit` : '#/new')) return;
  $app.innerHTML = `
    <a href="${id ? `#/client/${id}` : '#/'}" class="back">← Cancel</a>
    <div class="card" style="margin-top:8px">
      <h1>${id ? `Edit ${esc(c.name)}` : 'New buyer / seller'}</h1>
      <form id="client-form">
        <div class="field"><label>Type</label>
          <div class="chips" id="type-chips">
            ${['buyer', 'seller', 'both'].map((t) => `<button type="button" class="chip ${c.type === t ? 'on' : ''}" data-t="${t}">${typeLabel[t]}</button>`).join('')}
          </div></div>
        <div class="field"><label for="f-name">Full name *</label><input id="f-name" required maxlength="150" value="${esc(c.name)}"></div>
        <div class="grid2">
          <div class="field"><label for="f-phone">Phone</label><input id="f-phone" type="tel" maxlength="50" value="${esc(c.phone)}"></div>
          <div class="field"><label for="f-email">Email</label><input id="f-email" type="email" maxlength="200" value="${esc(c.email)}"></div>
        </div>
        <div class="field"><label for="f-mail">Mailing address</label><input id="f-mail" maxlength="300" value="${esc(c.mailing_address)}"></div>
        <div class="field"><label for="f-agent">Assigned agent</label>
          <select id="f-agent"><option value="">Unassigned</option>
            ${list.map((a) => `<option value="${a.id}" ${a.id === c.assigned_agent_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
          </select></div>
        <div id="buyer-qs" class="q-section" ${c.type === 'seller' ? 'hidden' : ''}>
          <h2>What do they want to buy?</h2>
          <p class="muted small">These answers are used to match this buyer with sellers.</p>
          ${questionFields(Q.buyer, c.details || {}, 'bq')}
        </div>
        ${id ? '' : `
        <div id="seller-qs" class="q-section" ${c.type === 'buyer' ? 'hidden' : ''}>
          <h2>Property they are selling</h2>
          <p class="muted small">These answers are used to match this property with buyers. You can add more properties below.</p>
          <div class="field"><label for="sq-address">Property address *</label>
            <input id="sq-address" maxlength="300" placeholder="e.g. 1150 Crows Landing Rd, Modesto, CA 95351"></div>
          ${questionFields(Q.seller, { listing_status: 'For sale' }, 'sq')}
        </div>
        <div class="field q-section"><label id="props-label">${c.type === 'buyer' ? 'Properties / sites' : 'Other properties (optional)'}</label>
          <div id="props"></div>
          <button type="button" class="btn small ghost" id="more-prop">+ Another property</button>
          <span class="help" id="seller-hint" ${c.type === 'buyer' ? 'hidden' : ''}>Other properties are saved with just the address. Open each one later to answer its questions.</span></div>
        <div class="field"><label for="f-first">First comment (optional)</label>
          <textarea id="f-first" maxlength="5000" placeholder="How did they reach us? What are they looking for?"></textarea></div>`}
        <p class="error" id="form-err"></p>
        <button class="btn block" type="submit">${id ? 'Save changes' : 'Save'}</button>
      </form>
    </div>`;

  let type = c.type;
  $$('#type-chips .chip').forEach((b) => b.addEventListener('click', () => {
    type = b.dataset.t; $$('#type-chips .chip').forEach((x) => x.classList.toggle('on', x === b));
    $('#buyer-qs').hidden = type === 'seller';
    if ($('#seller-hint')) $('#seller-hint').hidden = type === 'buyer';
    if ($('#seller-qs')) $('#seller-qs').hidden = type === 'buyer';
    if ($('#props-label')) $('#props-label').textContent = type === 'buyer' ? 'Properties / sites' : 'Other properties (optional)';
  }));
  const addPropRow = () => {
    const row = document.createElement('div');
    row.className = 'prop-row';
    row.innerHTML = '<input class="p-in" maxlength="300" placeholder="Property address"><button type="button" class="btn small ghost" aria-label="Remove">✕</button>';
    $('button', row).addEventListener('click', () => row.remove());
    $('#props').appendChild(row);
  };
  if (!id) {
    if (c.type === 'buyer') addPropRow();
    $('#more-prop').addEventListener('click', addPropRow);
  }

  $('#client-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      type,
      name: $('#f-name').value,
      phone: $('#f-phone').value,
      email: $('#f-email').value,
      mailing_address: $('#f-mail').value,
      assigned_agent_id: $('#f-agent').value || null,
    };
    if (type !== 'seller') body.details = readQuestionFields(Q.buyer, 'bq');
    const btn = $('button[type=submit]', e.target); btn.disabled = true;
    try {
      if (id) {
        await api('PATCH', `/api/clients/${id}`, body);
        toast('Saved'); go(`#/client/${id}`);
      } else {
        body.properties = $$('.p-in').map((i) => ({ address: i.value })).filter((p) => p.address.trim());
        if (type !== 'buyer') {
          const answers = readQuestionFields(Q.seller, 'sq');
          const addr = $('#sq-address').value.trim();
          const answered = Object.entries(answers).some(([k, v]) => k !== 'listing_status' && !isEmpty(v));
          if (!addr && answered) {
            $('#form-err').textContent = 'Please add the address of the property they are selling.';
            $('#sq-address').focus();
            btn.disabled = false;
            return;
          }
          if (addr) body.properties.unshift({ address: addr, details: answers });
        }
        const sold = (body.properties || [])[0];
        if (type === 'seller' && sold && sold.details && sold.details.exchange_1031 === 'yes'
          && confirm('This seller is doing a 1031 exchange, so they will buy a replacement property.\n\nSave them as a Buyer & Seller instead? You can add what they want to buy next.')) {
          body.type = 'both';
        }
        const r = await api('POST', '/api/clients', body);
        const first = $('#f-first').value.trim();
        if (first) await api('POST', `/api/clients/${r.id}/comments`, { body: first });
        toast('Saved'); go(`#/client/${r.id}`);
      }
    } catch (err) { $('#form-err').textContent = err.message; btn.disabled = false; }
  });
}

// Pop-up windows: use the built-in <dialog> where the phone supports it (iOS 15.4+),
// otherwise just show it on the page.
function openDialog(d) { if (typeof d.showModal === 'function') d.showModal(); else { d.setAttribute('open', ''); d.classList.add('fallback-open'); } }
function closeDialog(d) { if (typeof d.close === 'function') d.close(); else { d.removeAttribute('open'); d.classList.remove('fallback-open'); } }

// ---------- admin: team directory ----------
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const avatarHue = (id) => (Number(id) * 67) % 360;
const avatar = (id, name, cls = '') => `<span class="avatar ${cls}" style="--h:${avatarHue(id)}" aria-hidden="true">${esc(initials(name))}</span>`;
const smsUrl = (phone, body = '') => `sms:${String(phone).replace(/[^\d+]/g, '')}${body ? `?&body=${encodeURIComponent(body)}` : ''}`;

async function viewAdmin() {
  const navAt = navToken;
  setNav('admin');
  if (me.role !== 'admin') { $app.innerHTML = '<div class="empty">Admins only.</div>'; return; }
  const users = await api('GET', '/api/admin/users');
  if (navAt !== navToken || !onPage('#/admin')) return;
  const active = users.filter((u) => u.active).length;
  $app.innerHTML = `
    <p class="kicker">Admins only</p>
    <div class="spread"><h1>Team directory</h1><button class="btn small" id="add-user">+ Add employee</button></div>
    <p class="muted small">${active} active of ${users.length}. Passwords are stored scrambled and can't be viewed by anyone. Use <b>Reset password</b> to give someone a new one.</p>
    <div class="row" style="margin:10px 0 14px">
      <input id="team-q" type="search" placeholder="Find an employee" aria-label="Find an employee" style="flex:1;min-width:180px">
      <a class="btn small ghost" href="#/chat/announce">📢 Broadcast to all</a>
    </div>
    <div class="emp-grid" id="emp-grid">
      ${users.map((u) => `
        <div class="card emp ${u.active ? '' : 'off'}" data-q="${esc(`${u.name} ${u.email} ${u.title || ''} ${u.phone || ''}`.toLowerCase())}">
          <div class="emp-head">
            ${avatar(u.id, u.name, 'lg')}
            <div class="emp-id">
              <h2>${esc(u.name)}${u.id === me.id ? ' <span class="muted small">(you)</span>' : ''}</h2>
              <span class="muted small">${esc(u.title || (u.role === 'admin' ? 'Admin' : 'Agent'))}</span>
              <div>${u.role === 'admin' ? '<span class="badge admin">Admin</span>' : '<span class="badge buyer">Staff</span>'} ${u.active ? '' : '<span class="badge off">Switched off</span>'}</div>
            </div>
          </div>
          <ul class="contact-list">
            <li><span class="k">Login email</span><span class="v">${esc(u.email)}</span></li>
            <li><span class="k">Phone</span><span class="v">${u.phone ? `<a href="${esc(telUrl(u.phone))}">${esc(u.phone)}</a>` : '<span class="muted">Not added</span>'}</span></li>
            <li><span class="k">Last login</span><span class="v">${u.last_login_at ? esc(fmtAgo(u.last_login_at)) : '<span class="muted">Never</span>'}</span></li>
            <li><span class="k">Clients</span><span class="v">${u.client_count} assigned${u.overdue_reminders ? ` · <span class="warn">${u.overdue_reminders} overdue reminder${u.overdue_reminders === 1 ? '' : 's'}</span>` : ''}</span></li>
          </ul>
          <div class="quick">
            ${u.phone ? `<a class="btn small" href="${esc(telUrl(u.phone))}">Call</a>` : '<span class="btn small ghost disabled">No phone</span>'}
            ${u.phone ? `<a class="btn small ghost" href="${esc(smsUrl(u.phone))}">Text</a>` : '<span></span>'}
            ${u.id !== me.id && u.active ? `<a class="btn small ghost" href="#/chat/${encodeURIComponent(dmChannel(me.id, u.id))}">Message</a>` : '<span></span>'}
          </div>
          <div class="grid2" style="margin-top:8px">
            <button class="btn small ghost" data-edit-user="${u.id}">Edit details</button>
            <button class="btn small ghost" data-reset-user="${u.id}">Reset password</button>
          </div>
        </div>`).join('')}
    </div>
    <dialog id="user-dlg"><form id="user-form" method="dialog"></form></dialog>`;

  $('#team-q').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('#emp-grid .emp').forEach((c) => { c.hidden = q && !c.dataset.q.includes(q); });
  });

  const dlg = $('#user-dlg');
  const form = $('#user-form');
  const open = (u) => {
    form.innerHTML = `
      <h2>${u ? `Edit ${esc(u.name)}` : 'Add employee'}</h2>
      <div class="field"><label for="u-name">Name</label><input id="u-name" required maxlength="100" value="${esc(u?.name)}"></div>
      <div class="grid2">
        <div class="field"><label for="u-title">Job title</label><input id="u-title" maxlength="80" placeholder="e.g. Sales Agent" value="${esc(u?.title)}"></div>
        <div class="field"><label for="u-phone">Phone</label><input id="u-phone" type="tel" maxlength="50" value="${esc(u?.phone)}"></div>
      </div>
      ${u ? '' : '<div class="field"><label for="u-email">Work email (their login)</label><input id="u-email" type="email" required maxlength="200"></div>'}
      <div class="field"><label for="u-role">Role</label><select id="u-role">
        <option value="staff" ${u?.role !== 'admin' ? 'selected' : ''}>Staff: search, add, edit, comment, chat</option>
        <option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Admin: also team directory, announcements, delete</option></select></div>
      ${u ? `<div class="field"><label for="u-active">Access</label><select id="u-active">
        <option value="1" ${u.active ? 'selected' : ''}>Active (can log in)</option>
        <option value="0" ${u.active ? '' : 'selected'}>Off (blocked right away)</option></select></div>`
    : '<div class="field"><label for="u-pw">Temporary password (min 8 characters)</label><input id="u-pw" type="text" minlength="8" autocomplete="new-password" required></div>'}
      <p class="error" id="u-err"></p>
      <div class="row"><button class="btn" value="save" type="submit">Save</button><button class="btn ghost" type="button" id="u-cancel">Cancel</button></div>`;
    $('#u-cancel').addEventListener('click', () => closeDialog(dlg));
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const common = { name: $('#u-name').value, title: $('#u-title').value, phone: $('#u-phone').value, role: $('#u-role').value };
        if (u) await api('PATCH', `/api/admin/users/${u.id}`, { ...common, active: $('#u-active').value === '1' });
        else await api('POST', '/api/admin/users', { ...common, email: $('#u-email').value, password: $('#u-pw').value });
        agentsCache = null;
        closeDialog(dlg); toast('Saved'); viewAdmin();
      } catch (err) { $('#u-err').textContent = err.message; }
    };
    openDialog(dlg);
  };
  const showReset = (u) => {
    form.innerHTML = `
      <h2>Reset password: ${esc(u.name)}</h2>
      <p>This makes a <b>new temporary password</b> and logs ${esc(u.name.split(' ')[0])} out of every device. Their old password stops working.</p>
      <p class="error" id="u-err"></p>
      <div class="row"><button class="btn" type="submit">Make new password</button><button class="btn ghost" type="button" id="u-cancel">Cancel</button></div>`;
    $('#u-cancel').addEventListener('click', () => closeDialog(dlg));
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api('POST', `/api/admin/users/${u.id}/reset-password`);
        const text = `Your new JRP Client Book password is ${r.password} (login: ${u.email}). Please change it under "Me" after logging in.`;
        form.innerHTML = `
          <h2>New password for ${esc(u.name)}</h2>
          <p class="new-pw" id="new-pw">${esc(r.password)}</p>
          <p class="muted small">Shown only now. It can't be looked up again. They can change it under <b>Me</b>.</p>
          <div class="grid2">
            <button type="button" class="btn small" id="copy-pw">Copy</button>
            ${u.phone ? `<a class="btn small ghost" href="${esc(smsUrl(u.phone, text))}">Text it to ${esc(u.name.split(' ')[0])}</a>` : '<span></span>'}
          </div>
          <div class="row" style="margin-top:12px"><button type="button" class="btn ghost" id="u-done">Done</button></div>`;
        $('#copy-pw').addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(r.password); toast('Copied'); } catch { toast('Select the password and copy it', true); }
        });
        $('#u-done').addEventListener('click', () => closeDialog(dlg));
      } catch (err) { $('#u-err').textContent = err.message; }
    };
    openDialog(dlg);
  };
  $('#add-user').addEventListener('click', () => open(null));
  $$('[data-edit-user]').forEach((b) => b.addEventListener('click', () => open(users.find((u) => u.id === Number(b.dataset.editUser)))));
  $$('[data-reset-user]').forEach((b) => b.addEventListener('click', () => showReset(users.find((u) => u.id === Number(b.dataset.resetUser)))));
}

// ---------- office chat ----------
const dmChannel = (a, b) => `dm:${Math.min(a, b)}-${Math.max(a, b)}`;
let chatPoll = null;
const chanIcon = (c) => (c.kind === 'announce' ? '<span class="avatar ann" aria-hidden="true">📢</span>'
  : c.kind === 'team' ? '<span class="avatar team" aria-hidden="true">👥</span>'
    : avatar(c.other ? c.other.id : 0, c.title));
function fmtChatTime(iso) {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function viewChatList() {
  const navAt = navToken;
  setNav('chat');
  const d = await api('GET', '/api/chat');
  if (navAt !== navToken || !onPage('#/chat')) return;
  $app.innerHTML = `
    <p class="kicker">Office chat · inside the app only</p>
    <h1>Chat</h1>
    ${me.role === 'admin' ? '<a class="btn small block" href="#/chat/announce" style="margin:6px 0 12px">📢 Send an announcement to everyone</a>' : ''}
    <input id="chat-q" type="search" placeholder="Find a person" aria-label="Find a person" style="margin-bottom:10px">
    <ul class="conv-list" id="conv-list">
      ${d.conversations.map((c) => `
        <li data-q="${esc(c.title.toLowerCase())}" class="${c.kind === 'dm' && c.other && !c.other.active ? 'off' : ''}">
          <a class="conv ${c.unread ? 'has-unread' : ''}" href="#/chat/${encodeURIComponent(c.channel)}">
            ${chanIcon(c)}
            <span class="conv-main">
              <span class="conv-top"><b>${esc(c.title)}</b>${c.last ? `<span class="conv-time">${esc(fmtChatTime(c.last.created_at))}</span>` : ''}</span>
              <span class="conv-last">${c.last
    ? `${c.last.sender_id === me.id ? 'You: ' : c.kind !== 'dm' ? `${esc((c.last.sender_name || '').split(' ')[0])}: ` : ''}${esc(c.last.body || (c.last.client_name ? `Shared a client: ${c.last.client_name}` : ''))}`
    : `<span class="muted">${esc(c.subtitle)}</span>`}</span>
            </span>
            ${c.unread ? `<span class="unread">${c.unread}</span>` : ''}
          </a>
        </li>`).join('')}
    </ul>`;
  $('#chat-q').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('#conv-list li').forEach((li) => { li.hidden = q && !li.dataset.q.includes(q); });
  });
}

function messageHtml(m, kind, prevMsg) {
  const mine = m.sender_id === me.id;
  const day = new Date(m.created_at).toDateString();
  const sep = !prevMsg || new Date(prevMsg.created_at).toDateString() !== day
    ? `<li class="day-sep"><span>${esc(day === new Date().toDateString() ? 'Today' : new Date(m.created_at).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }))}</span></li>` : '';
  const sameAuthor = prevMsg && prevMsg.sender_id === m.sender_id && !sep && (new Date(m.created_at) - new Date(prevMsg.created_at)) < 5 * 60e3;
  const client = m.client_id ? `<a class="msg-client" href="#/client/${m.client_id}">${badge(m.client_type)} <b>${esc(m.client_name)}</b><span>Open profile →</span></a>` : '';
  const seen = kind === 'announce' && me.role === 'admin' && m.seen_count !== undefined
    ? `<button type="button" class="seen" data-seen="${m.id}">Seen by ${m.seen_count} of ${m.audience}</button>` : '';
  return `${sep}<li class="msg ${mine ? 'mine' : ''} ${kind === 'announce' ? 'ann' : ''} ${sameAuthor ? 'cont' : ''}" data-id="${m.id}">
      ${!mine && !sameAuthor && kind !== 'dm' ? `<span class="msg-from">${esc(m.sender_name || 'Former employee')}${m.sender_title ? ` · ${esc(m.sender_title)}` : ''}</span>` : ''}
      <div class="bubble">${m.body ? `<span class="msg-body">${esc(m.body)}</span>` : ''}${client}<span class="msg-time">${esc(new Date(m.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</span></div>
      ${seen}
    </li>`;
}

async function viewThread(channel) {
  const navAt = navToken;
  setNav('chat');
  const hash = `#/chat/${encodeURIComponent(channel)}`;
  const d = await api('GET', `/api/chat/c/${encodeURIComponent(channel)}`);
  if (navAt !== navToken || !(onPage(hash) || onPage(`#/chat/${channel}`))) return;
  const title = d.kind === 'announce' ? 'Announcements' : d.kind === 'team' ? 'Team chat' : d.other.name;
  const sub = d.kind === 'announce' ? (d.can_post ? 'Everyone in the office receives these' : 'From management. Read only')
    : d.kind === 'team' ? 'Everyone in the office' : (d.other.title || '') + (d.other.active ? '' : ' · switched off');
  let msgs = d.messages;
  $app.innerHTML = `
    <div class="thread">
      <div class="thread-head">
        <a href="#/chat" class="back">← Chat</a>
        <div class="spread">
          <div class="row" style="flex-wrap:nowrap">${chanIcon({ kind: d.kind, title, other: d.other })}<div><h1 class="thread-title">${esc(title)}</h1><span class="muted small">${esc(sub)}</span></div></div>
          ${d.other && d.other.phone ? `<div class="row"><a class="btn small" href="${esc(telUrl(d.other.phone))}">Call</a><a class="btn small ghost" href="${esc(smsUrl(d.other.phone))}">Text</a></div>` : ''}
        </div>
      </div>
      <ul class="msgs" id="msgs">${msgs.length ? msgs.map((m, i) => messageHtml(m, d.kind, msgs[i - 1])).join('') : `<li class="empty">${d.kind === 'dm' ? `Say hi to ${esc(d.other.name.split(' ')[0])} 👋` : 'No messages yet.'}</li>`}</ul>
      ${d.can_post ? `
      <form class="composer" id="composer">
        <textarea id="msg-in" rows="1" maxlength="2000" placeholder="${d.kind === 'announce' ? 'Announcement for everyone…' : 'Message…'}" aria-label="Message"></textarea>
        <button class="btn" type="submit" aria-label="Send">Send</button>
      </form>` : '<p class="composer-note">Only admins can post announcements. Message your manager directly if you have a question.</p>'}
    </div>
    <dialog id="seen-dlg"><div id="seen-body"></div></dialog>`;

  const list = $('#msgs');
  const toBottom = () => { list.lastElementChild && list.lastElementChild.scrollIntoView({ block: 'end' }); window.scrollTo(0, document.body.scrollHeight); };
  toBottom();
  const lastId = () => (msgs.length ? msgs[msgs.length - 1].id : 0);
  const append = (newOnes) => {
    if (!newOnes.length) return;
    const fresh = newOnes.filter((m) => !msgs.some((x) => x.id === m.id));
    if (!fresh.length) return;
    const empty = $('#msgs > .empty'); if (empty) empty.remove();
    const nearBottom = window.innerHeight + window.scrollY > document.body.scrollHeight - 160;
    const html = fresh.map((m, i) => messageHtml(m, d.kind, i ? fresh[i - 1] : msgs[msgs.length - 1])).join('');
    list.insertAdjacentHTML('beforeend', html);
    msgs = msgs.concat(fresh);
    if (nearBottom || fresh.some((m) => m.sender_id === me.id)) toBottom();
  };

  // check for new messages every 4 seconds while this conversation is open
  chatPoll = setInterval(async () => {
    if (navAt !== navToken || document.visibilityState === 'hidden') return;
    try { const r = await api('GET', `/api/chat/c/${encodeURIComponent(channel)}?after=${lastId()}`); append(r.messages); } catch { /* try again later */ }
  }, 4000);

  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-seen]');
    if (!b) return;
    try {
      const r = await api('GET', `/api/chat/announce/${b.dataset.seen}/seen`);
      $('#seen-body').innerHTML = `<h2>Who has seen it</h2>
        <p><b>Seen (${r.seen.length}):</b> ${r.seen.map(esc).join(', ') || '—'}</p>
        <p><b>Not yet (${r.not_seen.length}):</b> ${r.not_seen.map(esc).join(', ') || '—'}</p>
        <button class="btn small ghost" id="seen-close">Close</button>`;
      $('#seen-close').addEventListener('click', () => closeDialog($('#seen-dlg')));
      openDialog($('#seen-dlg'));
    } catch (err) { toast(err.message, true); }
  });

  const form = $('#composer');
  if (!form) return;
  const input = $('#msg-in');
  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); form.requestSubmit(); }
  });
  let sending = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body || sending) return;
    sending = true;
    const btn = $('button', form); btn.disabled = true;
    try {
      const m = await api('POST', `/api/chat/c/${encodeURIComponent(channel)}`, { body });
      input.value = ''; grow();
      append([m]);
    } catch (err) { toast(err.message, true); }
    sending = false; btn.disabled = false; input.focus();
  });
}

// "Send to a colleague" box on a client's profile: shares the client as a card in chat.
async function openShareBox(c) {
  const slot = $('#share-slot');
  if ($('#share-box')) { $('#share-box').remove(); return; }
  const team = (await agents()).filter((a) => a.id !== me.id);
  slot.innerHTML = `
    <form class="reminder-box" id="share-box">
      <p class="rb-q">💬 Send <b>${esc(c.name)}</b> to…</p>
      <div class="field"><label for="share-to">To</label>
        <select id="share-to">
          ${team.map((a) => `<option value="${esc(dmChannel(me.id, a.id))}">${esc(a.name)}${a.title ? ` (${esc(a.title)})` : ''}</option>`).join('')}
          <option value="team">Team chat (everyone)</option>
          ${me.role === 'admin' ? '<option value="announce">📢 Announcement (everyone)</option>' : ''}
        </select></div>
      <div class="field"><label for="share-msg">Message (optional)</label><input id="share-msg" maxlength="2000" placeholder="e.g. Can you call this buyer today?"></div>
      <div class="row"><button class="btn small" type="submit">Send</button><button type="button" class="btn small ghost" id="share-cancel">Cancel</button></div>
    </form>`;
  $('#share-cancel').addEventListener('click', () => $('#share-box').remove());
  $('#share-box').addEventListener('submit', async (e) => {
    e.preventDefault();
    const to = $('#share-to').value;
    try {
      await api('POST', `/api/chat/c/${encodeURIComponent(to)}`, { body: $('#share-msg').value, client_id: c.id });
      $('#share-box').innerHTML = `<p class="rb-q">✅ Sent. <a href="#/chat/${encodeURIComponent(to)}">Open the conversation →</a></p>`;
    } catch (err) { toast(err.message, true); }
  });
}

// ---------- my account ----------
function viewAccount() {
  setNav('account');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $app.innerHTML = `
    <div class="card">
      <h1>${esc(me.name)}</h1>
      <p class="muted">${esc(me.email)} · ${me.role === 'admin' ? 'Admin' : 'Staff'}</p>
      <button class="btn ghost" id="logout">Log out</button>
    </div>
    <div class="card" id="push-card">${pushCardHtml()}</div>
    ${standalone ? '' : `
    <div class="card install-tip">
      <h2>Put JRP on your phone's home screen</h2>
      <p><b>iPhone (Safari):</b> tap the Share button, then <b>Add to Home Screen</b>.</p>
      <p><b>Android (Chrome):</b> tap the ⋮ menu, then <b>Install app</b> or <b>Add to Home screen</b>.</p>
    </div>`}
    <div class="card">
      <h2>Change password</h2>
      <form id="pw-form">
        <div class="field"><label for="pw-cur">Current password</label><input id="pw-cur" type="password" autocomplete="current-password" required></div>
        <div class="field"><label for="pw-new">New password (min 8)</label><input id="pw-new" type="password" autocomplete="new-password" minlength="8" required></div>
        <p class="error" id="pw-err"></p>
        <button class="btn" type="submit">Update password</button>
      </form>
    </div>`;
  $('#logout').addEventListener('click', async () => {
    await pushForget();
    await api('POST', '/api/logout').catch(() => {});
    go('#/login');
  });
  bindPushCard();
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/me/password', { current: $('#pw-cur').value, next: $('#pw-new').value });
      toast('Password updated'); e.target.reset(); $('#pw-err').textContent = '';
    } catch (err) { $('#pw-err').textContent = err.message; }
  });
}

// ---------- notifications (Web Push) ----------
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
const pushState = () => {
  if (!pushSupported()) return isIOS && !isStandalone() ? 'ios-install' : 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
};
function keyBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
async function pushSubscribe() {
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api('GET', '/api/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // Re-subscribe if the server's key changed (e.g. a new server).
    const cur = sub.options && sub.options.applicationServerKey ? btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : publicKey;
    if (cur !== publicKey) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await api('POST', '/api/push/subscribe', { subscription: sub.toJSON() });
}
// Must run from a tap (iPhone rule).
async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked. Turn them on in your phone/browser settings for this app.' : 'Notifications were not turned on.');
  await pushSubscribe();
}
async function pushForget() {
  try {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint });
  } catch { /* offline: fine */ }
}
// After login / on start: link this device to whoever is logged in now.
async function pushSync() {
  try { if (me && pushState() === 'granted') await pushSubscribe(); } catch { /* try again next time */ }
}

function pushCardHtml() {
  const st = pushState();
  const head = '<h2>🔔 Message notifications</h2>';
  if (st === 'granted') return `${head}<p>On for this device. New messages show up even when the app is closed.</p>
    <div class="row"><button class="btn small ghost" id="push-test">Send me a test</button><button class="btn small ghost" id="push-off">Turn off on this device</button></div>`;
  if (st === 'default') return `${head}<p>Get chat messages on this device even when the app is closed, like WhatsApp.</p>
    <button class="btn" id="push-on">Turn on notifications</button>`;
  if (st === 'denied') return `${head}<p><b>Blocked.</b> To turn them on: open your phone or browser <b>Settings → Notifications</b>, find <b>JRP</b> (or this website), and allow notifications. Then come back here.</p>`;
  if (st === 'ios-install') return `${head}<p>On iPhone, notifications work once the app is on your home screen:</p>
    <p>1. Tap <b>Share</b> → <b>Add to Home Screen</b>.<br>2. Open JRP from the home screen icon.<br>3. Come back to <b>Me</b> and tap <b>Turn on notifications</b>.</p>`;
  return `${head}<p class="muted">This browser can't receive notifications. Use Chrome or Safari, or the app installed on your phone's home screen.</p>`;
}
function bindPushCard() {
  const card = $('#push-card');
  if (!card) return;
  const rerender = () => { card.innerHTML = pushCardHtml(); bindPushCard(); };
  const on = $('#push-on');
  if (on) on.addEventListener('click', async () => {
    on.disabled = true;
    try { await enablePush(); toast('Notifications on'); dismissPushAsk(); } catch (err) { toast(err.message, true); }
    rerender();
  });
  const test = $('#push-test');
  if (test) test.addEventListener('click', async () => {
    try {
      await pushSubscribe();
      const r = await api('POST', '/api/push/test');
      toast(r.sent ? 'Test sent. Check your notifications.' : 'Could not reach this device. Try turning notifications off and on.', !r.sent);
    } catch (err) { toast(err.message, true); }
  });
  const off = $('#push-off');
  if (off) off.addEventListener('click', async () => {
    try {
      await pushForget();
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      toast('Notifications off on this device');
    } catch (err) { toast(err.message, true); }
    card.innerHTML = `<h2>🔔 Message notifications</h2><p>Off on this device.</p><button class="btn" id="push-on">Turn on notifications</button>`;
    const again = $('#push-on');
    again.addEventListener('click', async () => {
      try { await enablePush(); toast('Notifications on'); } catch (err) { toast(err.message, true); }
      rerender();
    });
  });
}

// Home-screen reminder to turn notifications on (until they say yes or "Not now").
const pushAskKey = () => `jrp-push-ask-${me ? me.id : 0}`;
function pushAskDismissed() { try { return localStorage.getItem(pushAskKey()) === '1'; } catch { return false; } }
function dismissPushAsk() { try { localStorage.setItem(pushAskKey(), '1'); } catch { /* ignore */ } }
function pushAskHtml() {
  const st = pushState();
  if (pushAskDismissed() || (st !== 'default' && st !== 'ios-install')) return '';
  return `<div class="card push-ask" id="push-ask">
      <p class="kicker">🔔 Don't miss messages</p>
      ${st === 'ios-install'
        ? '<p>Add JRP to your home screen (Share → Add to Home Screen), open it from there, then turn on notifications in <b>Me</b>.</p>'
        : ''}
      <div class="row">${st === 'default' ? '<button class="btn small" id="push-ask-on">Turn on</button>' : ''}
        <button class="btn small ghost" id="push-ask-later">Not now</button></div>
    </div>`;
}
function bindPushAsk() {
  const box = $('#push-ask');
  if (!box) return;
  const on = $('#push-ask-on');
  if (on) on.addEventListener('click', async () => {
    on.disabled = true;
    try { await enablePush(); toast('Notifications on'); dismissPushAsk(); box.remove(); } catch (err) { toast(err.message, true); on.disabled = false; }
  });
  $('#push-ask-later').addEventListener('click', () => { dismissPushAsk(); box.remove(); });
}

// The service worker tells open copies of the app about a new message right away.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.type === 'jrp-new-message') refreshUnread();
    if (e.data.type === 'jrp-open' && e.data.url) location.href = e.data.url;
  });
}

// ---------- start ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
route().then(pushSync);
