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

// ---------- router ----------
async function route() {
  const hash = location.hash || '#/';
  if (!me && hash !== '#/login') {
    try { me = await api('GET', '/api/me'); } catch { return; }
  }
  const parts = hash.slice(2).split('/');
  window.scrollTo(0, 0);
  try {
    if (parts[0] === 'login') return await viewLogin();
    if (parts[0] === '' ) return await viewSearch();
    if (parts[0] === 'new') return await viewClientForm(null);
    if (parts[0] === 'client' && parts[1] && parts[2] === 'edit') return await viewClientForm(Number(parts[1]));
    if (parts[0] === 'client' && parts[1]) return await viewClient(Number(parts[1]));
    if (parts[0] === 'property' && parts[1]) return await viewProperty(Number(parts[1]));
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
            <input id="password" name="password" type="password" autocomplete="current-password" required></div>
          <p class="error" id="login-err"></p>
          <button class="btn block" type="submit">Log in</button>
        </form>
      </div>
    </div>`;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', e.target);
    btn.disabled = true;
    try {
      me = await api('POST', '/api/login', { email: $('#email').value, password: $('#password').value });
      go('#/');
    } catch (err) {
      $('#login-err').textContent = err.message;
    } finally { btn.disabled = false; }
  });
}

// ---------- search (home) ----------
// type: all | buyer | seller     agent: '' (everyone) | 'me' | 'none' (unassigned) | employee id
const searchState = { q: '', type: 'all', agent: '' };
async function viewSearch() {
  setNav('search');
  const team = await agents();
  $app.innerHTML = `
    <p class="kicker">Client Book</p>
    <h1>Hi, ${esc(me.name.split(' ')[0])}</h1>
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

// ---------- shared: comments / history / files block ----------
// Used on both the person's profile (everything) and a property page (just that property).
let activeTab = 'comments';

function renderLog(d, { propTags, placeholder }) {
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

function bindLog(baseUrl, reload) {
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
      await api('POST', `${baseUrl}/comments`, { body: $('#comment').value });
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

// ---------- person profile (buyer / seller) ----------
let lastClientId = null;
async function viewClient(id) {
  setNav('search');
  if (lastClientId !== id) { activeTab = 'comments'; lastClientId = id; }
  const c = await api('GET', `/api/clients/${id}`);
  const isAdmin = me.role === 'admin';
  const many = c.properties.length > 4;

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
    </div>

    <div class="card">
      <div class="spread">
        <h2>Properties / sites <span class="count">${c.properties.length}</span></h2>
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
            <a class="prop-link" href="#/property/${p.id}">
              <span class="addr">${esc(p.address)}</span>
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

    ${renderLog(c, { propTags: true, placeholder: 'e.g. Called buyer, interested in 2nd showing on Saturday. Budget firm at $450k.' })}

    ${isAdmin ? `<div style="text-align:center;margin:24px 0"><button class="btn danger small" id="del-client">Delete this ${esc(typeLabel[c.type].toLowerCase())} permanently</button></div>` : ''}
  `;

  bindLog(`/api/clients/${id}`, () => viewClient(id));

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
      await api('POST', `/api/clients/${id}/properties`, { address: $('#p-addr').value, notes: $('#p-notes').value });
      toast('Property added'); viewClient(id);
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
async function viewProperty(id) {
  setNav('search');
  if (lastPropId !== id) { activeTab = 'comments'; lastPropId = id; }
  const p = await api('GET', `/api/properties/${id}`);
  const isAdmin = me.role === 'admin';

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
      <h2>Details</h2>
      <form id="prop-form" hidden style="margin:12px 0">
        <div class="field"><label for="p-addr">Address</label><input id="p-addr" required maxlength="300" value="${esc(p.address)}"></div>
        <div class="field"><label for="p-notes">Notes</label><textarea id="p-notes" maxlength="1000">${esc(p.notes)}</textarea></div>
        <div class="row"><button class="btn small" type="submit">Save</button><button class="btn small ghost" type="button" id="p-cancel">Cancel</button></div>
      </form>
      <ul class="contact-list" id="prop-details">
        <li><span class="k">Notes</span><span class="v" style="white-space:pre-wrap">${esc(p.notes) || '<span class="muted">—</span>'}</span></li>
        <li><span class="k">Owner / client</span><span class="v"><a href="#/client/${p.client_id}">${esc(p.client_name)}</a> (${esc(typeLabel[p.client_type])})</span></li>
        <li><span class="k">Added</span><span class="v">${esc(fmtDate(p.created_at))} by ${esc(p.created_by_name || '—')}</span></li>
      </ul>
    </div>

    ${renderLog(p, { propTags: false, placeholder: 'e.g. Showed this property to the Gills. They liked the backyard, asked about HOA fees.' })}

    ${isAdmin ? '<div style="text-align:center;margin:24px 0"><button class="btn danger small" id="del-prop">Remove this property</button></div>' : ''}
  `;

  bindLog(`/api/properties/${id}`, () => viewProperty(id));

  const pf = $('#prop-form');
  $('#edit-prop').addEventListener('click', () => { pf.hidden = false; $('#prop-details').hidden = true; $('#p-addr').focus(); });
  $('#p-cancel').addEventListener('click', () => { pf.hidden = true; $('#prop-details').hidden = false; });
  pf.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('PATCH', `/api/properties/${id}`, { address: $('#p-addr').value, notes: $('#p-notes').value });
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
  };
  return map[a.action] || `${a.action}${a.detail ? ': ' + a.detail : ''}`;
}

// ---------- new / edit client ----------
async function viewClientForm(id) {
  setNav(id ? 'search' : 'new');
  const c = id ? await api('GET', `/api/clients/${id}`) : { type: 'buyer', assigned_agent_id: me.id };
  const list = await agents();
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
        ${id ? '' : `
        <div class="field"><label>Properties / sites</label>
          <div id="props"></div>
          <button type="button" class="btn small ghost" id="more-prop">+ Another property</button></div>
        <div class="field"><label for="f-first">First comment (optional)</label>
          <textarea id="f-first" maxlength="5000" placeholder="How did they reach us? What are they looking for?"></textarea></div>`}
        <p class="error" id="form-err"></p>
        <button class="btn block" type="submit">${id ? 'Save changes' : 'Save'}</button>
      </form>
    </div>`;

  let type = c.type;
  $$('#type-chips .chip').forEach((b) => b.addEventListener('click', () => {
    type = b.dataset.t; $$('#type-chips .chip').forEach((x) => x.classList.toggle('on', x === b));
  }));
  const addPropRow = () => {
    const row = document.createElement('div');
    row.className = 'prop-row';
    row.innerHTML = '<input class="p-in" maxlength="300" placeholder="Property address"><button type="button" class="btn small ghost" aria-label="Remove">✕</button>';
    $('button', row).addEventListener('click', () => row.remove());
    $('#props').appendChild(row);
  };
  if (!id) { addPropRow(); $('#more-prop').addEventListener('click', addPropRow); }

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
    const btn = $('button[type=submit]', e.target); btn.disabled = true;
    try {
      if (id) {
        await api('PATCH', `/api/clients/${id}`, body);
        toast('Saved'); go(`#/client/${id}`);
      } else {
        body.properties = $$('.p-in').map((i) => ({ address: i.value })).filter((p) => p.address.trim());
        const r = await api('POST', '/api/clients', body);
        const first = $('#f-first').value.trim();
        if (first) await api('POST', `/api/clients/${r.id}/comments`, { body: first });
        toast('Saved'); go(`#/client/${r.id}`);
      }
    } catch (err) { $('#form-err').textContent = err.message; btn.disabled = false; }
  });
}

// ---------- admin: team ----------
async function viewAdmin() {
  setNav('admin');
  if (me.role !== 'admin') { $app.innerHTML = '<div class="empty">Admins only.</div>'; return; }
  const users = await api('GET', '/api/admin/users');
  $app.innerHTML = `
    <div class="spread"><h1>Team logins</h1><button class="btn small" id="add-user">+ Add employee</button></div>
    <p class="muted small">${users.filter((u) => u.active).length} active employees. Turning someone off logs them out right away and keeps their comment history.</p>
    <div class="card">
      <table class="table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
        <tbody>
          ${users.map((u) => `
            <tr>
              <td><b>${esc(u.name)}</b> ${u.active ? '' : '<span class="badge off">Off</span>'}</td>
              <td class="small">${esc(u.email)}</td>
              <td>${u.role === 'admin' ? '<span class="badge admin">Admin</span>' : 'Staff'}</td>
              <td style="text-align:right"><button class="btn small ghost" data-edit-user="${u.id}">Manage</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <dialog id="user-dlg"><form id="user-form" method="dialog"></form></dialog>`;

  const dlg = $('#user-dlg');
  const form = $('#user-form');
  const open = (u) => {
    form.innerHTML = `
      <h2>${u ? `Manage ${esc(u.name)}` : 'Add employee'}</h2>
      <div class="field"><label for="u-name">Name</label><input id="u-name" required maxlength="100" value="${esc(u?.name)}"></div>
      ${u ? '' : '<div class="field"><label for="u-email">Work email</label><input id="u-email" type="email" required maxlength="200"></div>'}
      <div class="field"><label for="u-role">Role</label><select id="u-role">
        <option value="staff" ${u?.role !== 'admin' ? 'selected' : ''}>Staff: search, add, edit, comment</option>
        <option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Admin: also manages team and can delete</option></select></div>
      ${u ? `<div class="field"><label for="u-active">Access</label><select id="u-active">
        <option value="1" ${u.active ? 'selected' : ''}>Active (can log in)</option>
        <option value="0" ${u.active ? '' : 'selected'}>Off (blocked)</option></select></div>` : ''}
      <div class="field"><label for="u-pw">${u ? 'Reset password (leave blank to keep)' : 'Temporary password (min 8 characters)'}</label>
        <input id="u-pw" type="text" minlength="8" autocomplete="new-password" ${u ? '' : 'required'}></div>
      <p class="error" id="u-err"></p>
      <div class="row"><button class="btn" value="save" type="submit">Save</button><button class="btn ghost" type="button" id="u-cancel">Cancel</button></div>`;
    $('#u-cancel').addEventListener('click', () => dlg.close());
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        if (u) {
          await api('PATCH', `/api/admin/users/${u.id}`, {
            name: $('#u-name').value, role: $('#u-role').value, active: $('#u-active').value === '1', password: $('#u-pw').value,
          });
        } else {
          await api('POST', '/api/admin/users', {
            name: $('#u-name').value, email: $('#u-email').value, role: $('#u-role').value, password: $('#u-pw').value,
          });
        }
        agentsCache = null;
        dlg.close(); toast('Saved'); viewAdmin();
      } catch (err) { $('#u-err').textContent = err.message; }
    };
    dlg.showModal();
  };
  $('#add-user').addEventListener('click', () => open(null));
  $$('[data-edit-user]').forEach((b) => b.addEventListener('click', () => open(users.find((u) => u.id === Number(b.dataset.editUser)))));
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
  $('#logout').addEventListener('click', async () => { await api('POST', '/api/logout').catch(() => {}); go('#/login'); });
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/me/password', { current: $('#pw-cur').value, next: $('#pw-new').value });
      toast('Password updated'); e.target.reset(); $('#pw-err').textContent = '';
    } catch (err) { $('#pw-err').textContent = err.message; }
  });
}

// ---------- start ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
route();
