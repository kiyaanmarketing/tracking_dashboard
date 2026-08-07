const API = '/api/sites';
let allSites = [];
let editingHost = null;
const scriptCheckCache = {};

// ── Toast ──────────────────────────────────────────────────────────────────
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Tab switching ──────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('pane-' + name).classList.add('active');
  const navBtn = document.getElementById('nav-' + name);
  if (navBtn) navBtn.classList.add('active');

  if (name === 'analytics') {
    loadAnalytics();
  }
  if (name === 'list') {
    loadSites();
    editingHost = null;
  }
  if (name === 'add' && !editingHost) {
    document.getElementById('form-title').textContent = 'Add Site';
    document.getElementById('form-sub').textContent = 'Nayi tracking site add karo';
    document.getElementById('delete-btn').style.display = 'none';
  }
}

// ── Analytics ──────────────────────────────────────────────────────────────
function escapeHtml(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtNum(n) { return (n || 0).toLocaleString('en-IN'); }

async function loadAnalytics() {
  const site = document.getElementById('a-site-filter').value;
  const totalEl = document.getElementById('a-total');
  const todayEl = document.getElementById('a-today');

  try {
    const res = await fetch('/api/analytics/overview' + (site ? `?site=${encodeURIComponent(site)}` : ''));
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    totalEl.textContent = fmtNum(json.totalClicks);
    todayEl.textContent = fmtNum(json.todayClicks);
    document.getElementById('a-tracked-count').textContent = json.allSites.length;
    document.getElementById('a-untracked-count').textContent = json.untrackedSites.length;

    // populate site filter (once, preserving current selection)
    const filterEl = document.getElementById('a-site-filter');
    if (filterEl.dataset.populated !== '1') {
      const all = [...json.allSites, ...json.untrackedSites].sort();
      filterEl.innerHTML = '<option value="">All tracked sites</option>' +
        all.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
      filterEl.dataset.populated = '1';
    }

    renderBars('a-by-site', json.bySite, json.totalClicks);
    renderBars('a-by-country', json.byCountry, json.totalClicks);
    renderRecent(json.recent);
    renderUntracked(json.untrackedSites);
  } catch (err) {
    totalEl.textContent = '—';
    todayEl.textContent = '—';
    document.getElementById('a-by-site').innerHTML = `<div class="loading" style="color:#f87171">❌ ${escapeHtml(err.message)}</div>`;
    document.getElementById('a-by-country').innerHTML = '';
    document.getElementById('a-recent').innerHTML = '';
  }
}

function renderBars(elId, rows, total) {
  const el = document.getElementById(elId);
  if (!rows.length) {
    el.innerHTML = '<div class="loading">Koi data nahi</div>';
    return;
  }
  const max = Math.max(...rows.map(r => r.count), 1);
  el.innerHTML = rows.slice(0, 15).map(r => `
    <div class="bar-row">
      <div class="bar-row-top">
        <span class="bar-row-name">${escapeHtml(r.name)}</span>
        <span class="bar-row-count">${fmtNum(r.count)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max((r.count / max) * 100, 3)}%"></div></div>
    </div>`).join('');
}

function renderRecent(rows) {
  const el = document.getElementById('a-recent');
  if (!rows.length) {
    el.innerHTML = '<div class="loading">Abhi tak koi click record nahi</div>';
    return;
  }
  el.innerHTML = `
    <table>
      <thead><tr><th>Site</th><th>Source</th><th>URL</th><th>Country</th><th>Time</th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td>${escapeHtml(r.origin || '—')}</td>
            <td><span class="src-tag">${escapeHtml(r.source)}</span></td>
            <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.url || '')}">${escapeHtml(r.url || '—')}</td>
            <td>${escapeHtml(r.country || '—')}</td>
            <td style="color:var(--text2);white-space:nowrap">${new Date(r.timestamp).toLocaleString('en-IN')}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderUntracked(hosts) {
  const card = document.getElementById('a-untracked-card');
  const list = document.getElementById('a-untracked-list');
  if (!hosts.length) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');
  list.innerHTML = 'Yeh sites registry mein configured hain lekin inke backend mein click-logging nahi hai, isliye data nahi dikhega: <br><br>' +
    hosts.map(h => `<span class="tag tag-none" style="margin:2px">${escapeHtml(h)}</span>`).join(' ');
}

// ── Load all sites ─────────────────────────────────────────────────────────
async function loadSites() {
  const grid = document.getElementById('sites-grid');
  grid.innerHTML = '<div class="loading">Loading...</div>';

  try {
    const res = await fetch(API);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    allSites = json.data;
    document.getElementById('db-status').textContent = '● Connected';
    document.getElementById('db-status').className = 'db-badge connected';
    renderGrid(allSites);
  } catch (err) {
    grid.innerHTML = '<div class="loading" style="color:#f87171">❌ Load nahi hua: ' + err.message + '</div>';
    document.getElementById('db-status').textContent = '● DB Error';
    document.getElementById('db-status').className = 'db-badge error';
  }
}

// ── Render grid ────────────────────────────────────────────────────────────
function renderGrid(sites) {
  const grid = document.getElementById('sites-grid');
  document.getElementById('site-count').textContent = sites.length + ' site' + (sites.length !== 1 ? 's' : '');

  if (!sites.length) {
    grid.innerHTML = '<div class="empty-card" style="grid-column:1/-1">Koi site nahi — "Add Site" se add karo</div>';
    return;
  }

  grid.innerHTML = sites.map(s => {
    const mode = s.always && s.cartExtra ? 'always+cart'
      : s.always ? 'always'
      : 'cart only';
    const badgeClass = s.always ? 'b-ok' : 'b-warn';
    const date = new Date(s.createdAt).toLocaleDateString('en-IN');
    const cached = scriptCheckCache[s.host];
    const checkBadge = checkBadgeHTML(cached ? cached.status : null, cached ? cached.msg : null);
    const hasScript = !!(s.scriptUrl || s.script);

    return `
      <div class="site-card" onclick="showDetail('${s.host}')">
        <div class="site-card-top">
          <div>
            <div class="site-host">${s.host}</div>
          </div>
          <span class="badge ${badgeClass}">${mode}</span>
        </div>
        <div class="site-card-tags">
          ${s.script ? `<span class="tag tag-script">${s.script}</span>` : ''}
          ${s.api ? `<span class="tag tag-api">custom API</span>` : ''}
          ${!s.script && !s.api ? `<span class="tag tag-none">no script/api</span>` : ''}
        </div>
        <div class="site-card-bottom">
          <span class="site-card-date">Added ${date}</span>
          <div class="check-row">
            <span data-host-check="${s.host}">${checkBadge}</span>
            ${hasScript ? `<button class="btn-check" onclick="event.stopPropagation(); checkScript('${s.host}')">⟳</button>` : ''}
            <button class="btn-check" style="padding:2px 10px;font-size:11px" onclick="event.stopPropagation(); editSite('${s.host}')">Edit</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── Search / filter ────────────────────────────────────────────────────────
let _filterTimer = null;
function filterSites() {
  clearTimeout(_filterTimer);
  _filterTimer = setTimeout(() => {
    const q = document.getElementById('search-input').value.toLowerCase();
    const filtered = allSites.filter(s =>
      s.host.includes(q) || (s.campaign || '').toLowerCase().includes(q)
    );
    renderGrid(filtered);
  }, 200);
}

// ── Show detail ────────────────────────────────────────────────────────────
async function showDetail(host) {
  try {
    const s = allSites.find(site => site.host === host);
    if (!s) throw new Error('Site nahi mili');
    const mode = s.always && s.cartExtra ? 'always + cart (double fire)'
      : s.always ? 'always — har page pe'
      : 'sirf cart / checkout page pe';

    document.getElementById('detail-title').textContent = s.host;
    document.getElementById('detail-sub').textContent = mode;
    document.getElementById('detail-edit-btn').onclick = () => editSite(s.host);

    document.getElementById('detail-body').innerHTML = `
      <div class="detail-grid">

        <div class="detail-card">
          <div class="detail-card-title">Site Info</div>
          <div class="drow"><span class="dl">Hostname</span><span class="dv">${s.host}</span></div>
          <div class="drow"><span class="dl">Fire mode</span><span class="dv">${mode}</span></div>
          <div class="drow"><span class="dl">always</span><span class="dv">${s.always ? '<span class="badge b-ok">true</span>' : '<span class="badge b-no">false</span>'}</span></div>
          <div class="drow"><span class="dl">cartExtra</span><span class="dv">${s.cartExtra ? '<span class="badge b-ok">true</span>' : '<span class="badge b-no">false</span>'}</span></div>
          <div class="drow"><span class="dl">Added</span><span class="dv">${new Date(s.createdAt).toLocaleString('en-IN')}</span></div>
        </div>

        <div class="detail-card">
          <div class="detail-card-title">Script</div>
          ${s.script || s.scriptUrl ? `
            <div class="drow"><span class="dl">Script naam</span><span class="dv">${s.script || '—'}</span></div>
            <div class="drow"><span class="dl">Script URL</span><span class="dv">${s.scriptUrl || '—'}</span></div>
            <div class="drow"><span class="dl">Check String</span><span class="dv">${s.checkString || '<span style="color:var(--text3)">—</span>'}</span></div>
            <div class="drow"><span class="dl">Check URL</span><span class="dv">${s.checkUrl || '<span style="color:var(--text3)">— (homepage)</span>'}</span></div>
          ` : '<div style="padding:20px 16px;color:var(--text3);font-size:12px">Script details nahi di</div>'}
        </div>

        <div class="detail-card" style="grid-column: 1 / -1">
          <div class="detail-card-title" style="display:flex;align-items:center;justify-content:space-between">
            <span>Script Live Check</span>
            ${(s.scriptUrl || s.script) ? `<button class="btn-check" style="font-size:11px;padding:3px 10px" onclick="checkScriptInDetail('${s.host}')">⟳ Check Now</button>` : ''}
          </div>
          ${(s.scriptUrl || s.script) ? `
            <div class="drow">
              <span class="dl">Checking</span>
              <span class="dv" style="font-size:11px;color:var(--text3)">${s.scriptUrl || s.script}</span>
            </div>
            <div class="drow">
              <span class="dl">Status</span>
              <span class="dv" id="detail-check-status">${detailCheckBadge(s.host)}</span>
            </div>
          ` : '<div style="padding:16px;color:var(--text3);font-size:12px">Script URL set nahi ki — pehle script configure karo</div>'}
        </div>

        <div class="detail-card" style="grid-column: 1 / -1">
          <div class="detail-card-title">API Config</div>
          ${s.api ? `
            <div class="api-block">
              <span class="api-method">POST</span>&nbsp;
              <span class="api-url">${s.api}</span><br>
              {<br>
              &nbsp;&nbsp;<span class="api-key">url:</span> <span class="api-val">"https://${s.host}/..."</span>,<br>
              &nbsp;&nbsp;<span class="api-key">origin:</span> <span class="api-val">"${s.host}"</span>,<br>
              &nbsp;&nbsp;<span class="api-key">unique_id:</span> <span class="api-val">"&lt;tracking_uuid&gt;"</span>,<br>
              &nbsp;&nbsp;<span class="api-key">referrer:</span> <span class="api-val">"&lt;document.referrer&gt;"</span>,<br>
              &nbsp;&nbsp;<span class="api-key">timestamp:</span> <span class="api-val">&lt;Date.now()&gt;</span><br>
              }
            </div>
            ${s.pixel ? `<div class="drow"><span class="dl">Pixel URL</span><span class="dv">${s.pixel}</span></div>` : ''}
          ` : '<div style="padding:20px 16px;color:var(--text3);font-size:12px">API details nahi di — default use hogi</div>'}
        </div>

      </div>`;

    switchTab('detail');
  } catch (err) {
    toast('❌ Detail load nahi hua: ' + err.message);
  }
}

// ── Save site ──────────────────────────────────────────────────────────────
async function saveSite() {
  const errEl = document.getElementById('form-error');
  errEl.style.display = 'none';

  const host = document.getElementById('f-host').value.trim().replace(/^https?:\/\//, '').split('/')[0].toLowerCase();

  if (!host) {
    errEl.textContent = '❌ Site URL required hai';
    errEl.style.display = 'block';
    return;
  }

  const mode = document.getElementById('f-mode').value;
  const payload = {
    host,
    always:    mode === 'always' || mode === 'both',
    cartExtra: mode === 'cart'   || mode === 'both',
    script:       document.getElementById('f-script').value.trim()       || null,
    scriptUrl:    document.getElementById('f-script-url').value.trim()    || null,
    checkString:  document.getElementById('f-check-string').value.trim()  || null,
    checkUrl:     document.getElementById('f-check-url').value.trim()      || null,
    api:       document.getElementById('f-api').value.trim()        || null,
    pixel:     document.getElementById('f-pixel').value.trim()      || null,
  };

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    toast('✅ ' + host + ' save ho gaya');
    delete scriptCheckCache[host];
    clearForm();
    editingHost = null;
    switchTab('list');
  } catch (err) {
    errEl.textContent = '❌ ' + err.message;
    errEl.style.display = 'block';
  }
}

// ── Edit site ──────────────────────────────────────────────────────────────
async function editSite(host) {
  try {
    const s = allSites.find(site => site.host === host);
    if (!s) throw new Error('Site nahi mili');
    editingHost = host;

    document.getElementById('f-host').value = s.host;
    document.getElementById('f-host').readOnly = true;
    document.getElementById('f-mode').value = s.always && s.cartExtra ? 'both' : s.always ? 'always' : 'cart';
    document.getElementById('f-script').value = s.script || '';
    document.getElementById('f-script-url').value = s.scriptUrl || '';
    document.getElementById('f-check-string').value = s.checkString || '';
    document.getElementById('f-check-url').value = s.checkUrl || '';
    document.getElementById('f-api').value = s.api || '';
    document.getElementById('f-pixel').value = s.pixel || '';

    document.getElementById('form-title').textContent = 'Edit — ' + host;
    document.getElementById('form-sub').textContent = 'Changes save karo ya site delete karo';
    document.getElementById('delete-btn').style.display = 'inline-flex';

    switchTab('add');
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

// ── Delete site ────────────────────────────────────────────────────────────
async function deleteSite() {
  if (!editingHost) return;
  if (!confirm(editingHost + ' ko delete karna chahte ho?')) return;

  try {
    const res = await fetch(API + '/' + editingHost, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    toast('🗑 ' + editingHost + ' delete ho gaya');
    editingHost = null;
    clearForm();
    switchTab('list');
  } catch (err) {
    toast('❌ ' + err.message);
  }
}

// ── Clear form ─────────────────────────────────────────────────────────────
function clearForm() {
  ['f-host','f-script','f-script-url','f-check-string','f-check-url','f-api','f-pixel'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('f-host').readOnly = false;
  document.getElementById('f-mode').value = 'cart';
  document.getElementById('form-error').style.display = 'none';
  document.getElementById('delete-btn').style.display = 'none';
}

// ── Script live check ──────────────────────────────────────────────────────
function checkBadgeHTML(status, msg) {
  if (!status)             return '<span class="check-badge check-none" title="Click ⟳ to check">—</span>';
  if (status === 'none')   return '<span class="check-badge check-none" title="Script URL set nahi ki">—</span>';
  if (status === 'checking') return '<span class="check-badge check-checking">⟳ Checking…</span>';
  if (status === 'found')  return '<span class="check-badge check-found">✓ Live</span>';
  if (status === 'missing') return '<span class="check-badge check-missing">✗ Not Found</span>';
  if (status === 'error')  return `<span class="check-badge check-error" title="${msg || ''}">⚠ Error</span>`;
  return '';
}

function updateCardCheckUI(host) {
  const el = document.querySelector(`[data-host-check="${host}"]`);
  if (!el) return;
  const c = scriptCheckCache[host] || {};
  el.innerHTML = checkBadgeHTML(c.status, c.msg);
}

function detailCheckBadge(host) {
  const c = scriptCheckCache[host];
  if (!c) return '<span style="color:var(--text3);font-size:12px">— Click "Check Now" to verify</span>';
  return checkBadgeHTML(c.status, c.msg);
}

async function checkScriptInDetail(host) {
  document.getElementById('detail-check-status').innerHTML = checkBadgeHTML('checking');
  scriptCheckCache[host] = { status: 'checking' };
  updateCardCheckUI(host);
  try {
    const res = await fetch(`${API}/${host}/check`);
    const json = await res.json();
    if (!json.success) {
      scriptCheckCache[host] = { status: 'error', msg: json.message };
    } else if (json.found === null) {
      scriptCheckCache[host] = { status: 'none' };
    } else {
      scriptCheckCache[host] = { status: json.found ? 'found' : 'missing' };
    }
  } catch (err) {
    scriptCheckCache[host] = { status: 'error', msg: err.message };
  }
  const el = document.getElementById('detail-check-status');
  if (el) el.innerHTML = checkBadgeHTML(scriptCheckCache[host].status, scriptCheckCache[host].msg);
  updateCardCheckUI(host);
}

async function checkScript(host) {
  scriptCheckCache[host] = { status: 'checking' };
  updateCardCheckUI(host);
  try {
    const res = await fetch(`${API}/${host}/check`);
    const json = await res.json();
    if (!json.success) {
      scriptCheckCache[host] = { status: 'error', msg: json.message };
    } else if (json.found === null) {
      scriptCheckCache[host] = { status: 'none' };
    } else {
      scriptCheckCache[host] = { status: json.found ? 'found' : 'missing' };
    }
  } catch (err) {
    scriptCheckCache[host] = { status: 'error', msg: err.message };
  }
  updateCardCheckUI(host);
}

async function checkAllScripts() {
  const btn = document.getElementById('check-all-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  const withScript = allSites.filter(s => s.scriptUrl || s.script);
  for (const s of withScript) {
    await checkScript(s.host);
  }
  if (btn) { btn.disabled = false; btn.textContent = '⟳ Check All'; }
}

// ── Init ───────────────────────────────────────────────────────────────────
loadAnalytics();
loadSites();
