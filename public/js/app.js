// ============================================================
// POTrack — Frontend (talks to server API)
// ============================================================

let state = { user: null, projects: [], pos: [], settings: {}, xero: { connected: false }, currentPage: 'dashboard' };

// ---- API helper --------------------------------------------
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Server error');
  return data;
}

const get  = (path)       => api('GET',    path);
const post = (path, body) => api('POST',   path, body);
const put  = (path, body) => api('PUT',    path, body);
const del  = (path)       => api('DELETE', path);

// ---- Boot --------------------------------------------------
async function boot() {
  bindLogin();
  const { user } = await get('/auth/me');
  if (user) {
    state.user = user;
    showApp();
  } else {
    showLogin();
  }
}

// ---- Login -------------------------------------------------
function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  updateUserUI();
  loadAndRender();
}

function bindLogin() {
  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('btn-register').addEventListener('click', doRegister);
  document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await post('/auth/logout');
    state.user = null;
    showLogin();
  });
}

async function doLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.classList.add('hidden');
  try {
    const { user } = await post('/auth/login', { email, password });
    state.user = user;
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function doRegister() {
  const name     = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl    = document.getElementById('reg-error');
  errEl.classList.add('hidden');
  try {
    const { user } = await post('/auth/register', { name, email, password });
    state.user = user;
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

function switchTab(tab) {
  document.getElementById('form-login').style.display    = tab === 'login'    ? 'block' : 'none';
  document.getElementById('form-register').style.display = tab === 'register' ? 'block' : 'none';
  document.getElementById('tab-login').classList.toggle('active',    tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
}

function updateUserUI() {
  const u = state.user;
  if (!u) return;
  document.getElementById('user-name').textContent   = u.name;
  document.getElementById('user-role').textContent   = u.role;
  document.getElementById('user-avatar').textContent = u.name.charAt(0).toUpperCase();
}

// ---- Load data ---------------------------------------------
async function loadAndRender() {
  try {
    const [projects, pos, settings, xero] = await Promise.all([
      get('/api/projects'),
      get('/api/pos'),
      get('/api/settings'),
      get('/api/xero/status'),
    ]);
    state.projects = projects;
    state.pos      = pos;
    state.settings = settings;
    state.xero     = xero;

    // Set Xero redirect URI
    const redirectEl = document.getElementById('xero-redirect-uri');
    if (redirectEl) redirectEl.textContent = `${location.origin}/auth/xero/callback`;

    updateXeroUI();
    bindNav();
    bindTopButtons();
    bindModalClose();
    bindPOModal();
    bindProjectModal();
    bindSettings();
    renderPage('dashboard');

    // Load Xero supplier suggestions if connected
    if (xero.connected) loadXeroContacts();
  } catch (err) {
    console.error('Load error:', err);
  }
}

async function refreshData() {
  const [projects, pos] = await Promise.all([ get('/api/projects'), get('/api/pos') ]);
  state.projects = projects;
  state.pos      = pos;
}

// ---- Xero contacts -----------------------------------------
async function loadXeroContacts() {
  try {
    const contacts = await get('/api/xero/contacts');
    const dl = document.getElementById('supplier-list');
    if (dl) dl.innerHTML = contacts.map(c => `<option value="${c.name}">`).join('');
  } catch (_) {}
}

// ---- Navigation --------------------------------------------
function bindNav() {
  document.querySelectorAll('[data-page]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); nav(el.dataset.page); });
  });
}

function nav(page) {
  state.currentPage = page;
  document.querySelectorAll('.nav-link').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');
  const titles = { dashboard:'Dashboard', projects:'Projects', pos:'Purchase Orders', cashflow:'Cash Flow', xero:'Xero', settings:'Settings' };
  document.getElementById('page-title').textContent = titles[page] || page;
  renderPage(page);
}

function renderPage(page) {
  if (page === 'dashboard') renderDashboard();
  if (page === 'projects')  renderProjects();
  if (page === 'pos')       renderPOs();
  if (page === 'cashflow')  renderCashflow();
  if (page === 'xero')      renderXeroPage();
  if (page === 'settings')  renderSettings();
}

// ---- Formatting --------------------------------------------
function fmt(n) {
  const sym = state.settings.currency === 'EUR' ? '€' : state.settings.currency === 'USD' ? '$' : '£';
  return sym + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function badge(status) {
  const m = { Draft:'draft', Sent:'sent', Received:'received', Paid:'paid', Active:'active', Complete:'complete', 'On hold':'on-hold' };
  return `<span class="badge badge-${m[status]||'draft'}">${status}</span>`;
}
function tableWrap(headers, widths, rows) {
  const cols = widths.map(w => `<col style="width:${w}">`).join('');
  const ths  = headers.map(h => `<th>${h}</th>`).join('');
  return `<table class="data-table"><colgroup>${cols}</colgroup><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
}

// ---- Dashboard ---------------------------------------------
function renderDashboard() {
  const openPOs  = state.pos.filter(p => p.status !== 'Paid');
  const totalOut = openPOs.reduce((a, p) => a + Number(p.amount), 0);
  const totalIn  = state.projects.reduce((a, p) => a + Number(p.income), 0);
  const active   = state.projects.filter(p => p.status === 'Active').length;

  document.getElementById('metrics').innerHTML = `
    <div class="metric-card"><div class="metric-label">Active projects</div><div class="metric-value">${active}</div><div class="metric-sub">${state.projects.length} total</div></div>
    <div class="metric-card"><div class="metric-label">Open POs</div><div class="metric-value">${openPOs.length}</div><div class="metric-sub">${fmt(totalOut)} outstanding</div></div>
    <div class="metric-card"><div class="metric-label">Expected income</div><div class="metric-value green">${fmt(totalIn)}</div><div class="metric-sub">across all projects</div></div>
    <div class="metric-card"><div class="metric-label">Due out (unpaid)</div><div class="metric-value red">${fmt(totalOut)}</div><div class="metric-sub">${openPOs.length} open POs</div></div>
  `;
  document.getElementById('xero-alert').classList.toggle('hidden', state.xero.connected);

  document.getElementById('dash-po-table').innerHTML = tableWrap(
    ['PO number','Supplier','Project','Amount','Status'],['20%','25%','25%','16%','14%'],
    state.pos.slice(0,6).map(p => `<tr onclick="openPODetail(${p.id})">
      <td class="mono">${p.num}</td><td>${p.supplier}</td><td>${p.project_name||'—'}</td>
      <td class="mono">${fmt(p.amount)}</td><td>${badge(p.status)}</td></tr>`).join('') ||
    '<tr><td colspan="5"><div class="empty-state">No purchase orders yet</div></td></tr>'
  );
  document.getElementById('dash-proj-table').innerHTML = tableWrap(
    ['Project','Job','Due in','Due out','Status'],['30%','12%','18%','18%','22%'],
    state.projects.slice(0,6).map(p => `<tr onclick="openProjectModal(${p.id})">
      <td>${p.name}</td><td class="mono">${p.job_num}</td>
      <td class="mono" style="color:var(--green)">${fmt(p.income)}</td>
      <td class="mono" style="color:var(--red)">${fmt(p.due_out)}</td>
      <td>${badge(p.status)}</td></tr>`).join('') ||
    '<tr><td colspan="5"><div class="empty-state">No projects yet</div></td></tr>'
  );
}

function renderProjects() {
  const hideCompleted = document.getElementById('hide-completed')?.checked;
  let projects = state.projects;
  if (hideCompleted) projects = projects.filter(p => p.status !== 'Complete');

  document.getElementById('full-proj-table').innerHTML = tableWrap(
    ['Project','Job no.','Client','Dates','Budget','Due in','Due out','Status'],
    ['22%','8%','13%','16%','10%','10%','10%','11%'],
    projects.length ? projects.map(p => `<tr>
      <td><a href="#" onclick="openProjectDetail(${p.id});return false;" style="color:var(--green);font-weight:500;">${p.name}</a></td>
      <td class="mono">${p.job_num}</td>
      <td>${p.client||'—'}</td>
      <td style="font-size:12px;color:var(--txt2)">${p.start_date && p.end_date ? p.start_date + ' → ' + p.end_date : p.start_date || '—'}</td>
      <td class="mono">${fmt(p.budget)}</td>
      <td class="mono" style="color:var(--green)">${fmt(p.income)}</td>
      <td class="mono" style="color:var(--red)">${fmt(p.due_out)}</td>
      <td>${badge(p.status)}</td>
      </tr>`).join('') :
    '<tr><td colspan="8"><div class="empty-state">No projects yet</div></td></tr>'
  );

  document.getElementById('hide-completed')?.addEventListener('change', renderProjects);
}

function renderPOs() {
  const sf = document.getElementById('filter-status').value;
  const pf = document.getElementById('filter-project').value;
  const qf = (document.getElementById('filter-search').value||'').toLowerCase();
  const projSel = document.getElementById('filter-project');
  if (projSel.children.length <= 1) {
    state.projects.forEach(p => {
      const o = document.createElement('option'); o.value = p.id; o.textContent = `${p.name} (${p.job_num})`; projSel.appendChild(o);
    });
  }
  let pos = state.pos;
  if (sf) pos = pos.filter(p => p.status === sf);
  if (pf) pos = pos.filter(p => p.project_id === parseInt(pf));
  if (qf) pos = pos.filter(p => p.num.toLowerCase().includes(qf) || p.supplier.toLowerCase().includes(qf));

  document.getElementById('full-po-table').innerHTML = tableWrap(
    ['PO number','Supplier','Project','Description','Amount','Status','Due'],
    ['14%','18%','17%','17%','11%','13%','10%'],
    pos.length ? pos.map(p => `<tr onclick="openPODetail(${p.id})">
      <td class="mono">${p.num}</td><td>${p.supplier}</td><td>${p.project_name||'—'}</td>
      <td style="color:var(--txt2)">${p.description||'—'}</td>
      <td class="mono">${fmt(p.amount)}</td>
      <td>${badge(p.status)}${p.xero_id?'<span class="badge badge-sent" style="margin-left:4px;background:#E0F0FB;color:#0078C8;">Xero</span>':''}</td>
      <td>${p.due_date||'—'}</td></tr>`).join('') :
    '<tr><td colspan="7"><div class="empty-state">No purchase orders match filters</div></td></tr>'
  );
  document.getElementById('filter-status').onchange  = renderPOs;
  document.getElementById('filter-project').onchange = renderPOs;
  document.getElementById('filter-search').oninput   = renderPOs;
}

async function renderCashflow() {
  const max = Math.max(...state.projects.map(p => Number(p.income)), 1);
  document.getElementById('cashflow-cards').innerHTML = state.projects.map(p => {
    const out = Number(p.due_out); const net = Number(p.income) - out;
    const inP = Math.round((Number(p.income)/max)*100); const outP = Math.round((out/max)*100);
    return `<div class="cf-card">
      <div class="cf-header"><div class="cf-project-name">${p.name}</div><div class="cf-job-num">Job ${p.job_num}</div>${badge(p.status)}<div class="cf-net" style="color:${net>=0?'var(--green)':'var(--red)'}">Net: ${fmt(net)}</div></div>
      <div class="cf-bar-row"><div class="cf-label">Due in</div><div class="cf-track"><div class="cf-fill income" style="width:${inP}%"></div></div><div class="cf-val" style="color:var(--green)">${fmt(p.income)}</div></div>
      <div class="cf-bar-row"><div class="cf-label">Due out</div><div class="cf-track"><div class="cf-fill expense" style="width:${outP}%"></div></div><div class="cf-val" style="color:var(--red)">${fmt(out)}</div></div>
    </div>`;
  }).join('') || '<div class="empty-state" style="padding:40px">No projects yet</div>';

  if (state.xero.connected) {
    document.getElementById('xero-invoices-wrap').style.display = 'block';
    try {
      const invoices = await get('/api/xero/invoices');
      document.getElementById('xero-invoices-table').innerHTML = tableWrap(
        ['Invoice','Contact','Amount due','Due','Status'],['20%','30%','18%','16%','16%'],
        invoices.length ? invoices.map(i => `<tr><td class="mono">${i.number||'—'}</td><td>${i.contact||'—'}</td><td class="mono" style="color:var(--green)">${fmt(i.amount)}</td><td>${i.due||'—'}</td><td>${badge(i.status)}</td></tr>`).join('') :
        '<tr><td colspan="5"><div class="empty-state">No outstanding invoices in Xero</div></td></tr>'
      );
    } catch (_) {}
  }
}

function renderXeroPage() {
  const c = state.xero.connected;
  document.getElementById('xero-setup-panel').style.display     = c ? 'none' : 'block';
  document.getElementById('xero-connected-panel').style.display = c ? 'block' : 'none';
  document.getElementById('xero-disconnect-wrap').style.display = c ? 'block' : 'none';
  document.getElementById('xero-page-status').textContent = c ? `Connected to ${state.xero.tenantName||'Xero'}` : 'Not connected';
  document.getElementById('xero-page-status').style.color = c ? 'var(--green)' : '';
}

function updateXeroUI() {
  const c = state.xero.connected;
  document.getElementById('xero-dot').className = 'dot ' + (c ? 'connected' : 'disconnected');
  document.getElementById('xero-pill-label').textContent = c ? `Xero: ${state.xero.tenantName||'connected'}` : 'Xero: not connected';
  document.getElementById('xero-alert')?.classList.toggle('hidden', c);
}

async function renderSettings() {
  // Settings tabs
  document.querySelectorAll('.stab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.stab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('stab-' + btn.dataset.stab).classList.add('active');
    });
  });

  // Show admin tab if admin
  if (state.user?.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'inline-block');
  }

  // Profile tab
  document.getElementById('prof-name').value  = state.user?.name  || '';
  document.getElementById('prof-email').value = state.user?.email || '';

  document.getElementById('btn-save-profile').onclick = async () => {
    const errEl = document.getElementById('prof-error');
    errEl.classList.add('hidden');
    try {
      await put('/auth/profile', {
        name:  document.getElementById('prof-name').value.trim(),
        email: document.getElementById('prof-email').value.trim(),
      });
      state.user.name  = document.getElementById('prof-name').value.trim();
      state.user.email = document.getElementById('prof-email').value.trim();
      updateUserUI();
      errEl.textContent = 'Saved!';
      errEl.style.background = '#D4F4E4';
      errEl.style.color = '#166534';
      errEl.classList.remove('hidden');
      setTimeout(() => errEl.classList.add('hidden'), 2000);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.background = '';
      errEl.style.color = '';
      errEl.classList.remove('hidden');
    }
  };

  document.getElementById('btn-change-pw').onclick = async () => {
    const errEl = document.getElementById('pw-error');
    const okEl  = document.getElementById('pw-success');
    errEl.classList.add('hidden');
    okEl.classList.add('hidden');
    const current    = document.getElementById('pw-current').value;
    const newPw      = document.getElementById('pw-new').value;
    const confirmPw  = document.getElementById('pw-confirm').value;
    if (newPw !== confirmPw) { errEl.textContent = 'New passwords do not match'; errEl.classList.remove('hidden'); return; }
    if (newPw.length < 8)    { errEl.textContent = 'Password must be at least 8 characters'; errEl.classList.remove('hidden'); return; }
    try {
      await fetch('/auth/password', { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body: JSON.stringify({ current, newPassword: newPw }) }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); });
      okEl.classList.remove('hidden');
      document.getElementById('pw-current').value = '';
      document.getElementById('pw-new').value = '';
      document.getElementById('pw-confirm').value = '';
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  };

  // Company tab
  const s = state.settings;
  document.getElementById('setting-company').value  = s.company  || '';
  document.getElementById('setting-currency').value = s.currency || 'GBP';

  document.getElementById('btn-save-settings').onclick = async () => {
    await post('/api/settings', { key: 'company',  value: document.getElementById('setting-company').value });
    await post('/api/settings', { key: 'currency', value: document.getElementById('setting-currency').value });
    state.settings.currency = document.getElementById('setting-currency').value;
    alert('Settings saved');
  };

  // Users tab (admin only)
  if (state.user?.role === 'admin') {
    await loadUsersTable();

    document.getElementById('btn-add-user').onclick = async () => {
      const errEl = document.getElementById('new-user-error');
      errEl.classList.add('hidden');
      try {
        await fetch('/auth/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            name:     document.getElementById('new-user-name').value.trim(),
            email:    document.getElementById('new-user-email').value.trim(),
            password: document.getElementById('new-user-pw').value,
            role:     document.getElementById('new-user-role').value,
          })
        }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d; });
        document.getElementById('new-user-name').value  = '';
        document.getElementById('new-user-email').value = '';
        document.getElementById('new-user-pw').value    = '';
        await loadUsersTable();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    };
  }
}

async function loadUsersTable() {
  const users = await fetch('/auth/users', { credentials:'same-origin' }).then(r => r.json());
  document.getElementById('users-list').innerHTML = `
    <table class="users-table">
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead>
      <tbody>${users.map(u => `
        <tr>
          <td>${u.name} ${u.id === state.user.id ? '<span style="font-size:10px;color:var(--txt3)">(you)</span>' : ''}</td>
          <td style="color:var(--txt2)">${u.email}</td>
          <td>
            ${u.id === state.user.id
              ? badge(u.role)
              : `<select class="role-select" onchange="changeRole(${u.id}, this.value)">
                  <option value="member"  ${u.role==='member'  ? 'selected':''}>Member</option>
                  <option value="viewer"  ${u.role==='viewer'  ? 'selected':''}>Viewer</option>
                  <option value="admin"   ${u.role==='admin'   ? 'selected':''}>Admin</option>
                </select>`
            }
          </td>
          <td>
            <div class="user-actions">
              ${u.id !== state.user.id ? `
                <button class="btn btn-secondary btn-sm" onclick="resetUserPassword(${u.id}, '${u.name}')">Reset password</button>
                <button class="btn btn-danger btn-sm" onclick="removeUser(${u.id}, '${u.name}')">Remove</button>
              ` : '—'}
            </div>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  `;
}

async function changeRole(userId, role) {
  try {
    await fetch(`/auth/users/${userId}`, {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role })
    }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); });
  } catch (err) {
    alert('Error changing role: ' + err.message);
    await loadUsersTable();
  }
}

async function resetUserPassword(userId, userName) {
  const newPw = prompt(`Set a new password for ${userName} (min. 8 characters):`);
  if (!newPw) return;
  if (newPw.length < 8) { alert('Password must be at least 8 characters'); return; }
  try {
    await fetch(`/auth/users/${userId}/password`, {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: newPw })
    }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); });
    alert(`Password for ${userName} has been reset`);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function removeUser(userId, userName) {
  if (!confirm(`Remove ${userName} from POTrack? They will no longer be able to log in.`)) return;
  try {
    await fetch(`/auth/users/${userId}`, { method: 'DELETE', credentials: 'same-origin' })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); });
    await loadUsersTable();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function bindSettings() {
  // bindings now handled inside renderSettings via onclick
}

// ---- Top buttons -------------------------------------------
function bindTopButtons() {
  document.getElementById('btn-new-po').addEventListener('click',   () => openPOModal());
  document.getElementById('btn-new-proj').addEventListener('click', () => openProjectModal());
}

// ---- Modals ------------------------------------------------
function bindModalClose() {
  document.getElementById('modal-backdrop').addEventListener('click', () => {
    // Only close top-level modals, not the project detail if sub-modals are layered
    const openModals = [...document.querySelectorAll('.modal.open')];
    if (openModals.length > 1) {
      // Close all except proj-detail
      openModals.forEach(m => { if (m.id !== 'modal-proj-detail') m.classList.remove('open'); });
    } else {
      closeModals();
    }
  });
  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => {
      const modal = el.closest('.modal');
      if (modal) {
        modal.classList.remove('open');
        const stillOpen = document.querySelector('.modal.open');
        if (!stillOpen) document.getElementById('modal-backdrop').classList.remove('open');
      } else {
        closeModals();
      }
    });
  });
}
function openModal(id) {
  document.getElementById('modal-backdrop').classList.add('open');
  // If opening a sub-modal while proj-detail is open, don't close proj-detail
  const projDetailOpen = document.getElementById('modal-proj-detail')?.classList.contains('open');
  const subModals = ['modal-po-invoice','modal-income-line','modal-spend-line','modal-po-detail','modal-po','modal-project'];
  if (projDetailOpen && subModals.includes(id)) {
    // Keep proj-detail open, just open the new one on top
    document.getElementById(id).classList.add('open');
    document.getElementById(id).style.zIndex = '300';
    return;
  }
  document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
  document.getElementById(id).classList.add('open');
  document.getElementById(id).style.zIndex = '';
}
function closeModals() {
  document.getElementById('modal-backdrop').classList.remove('open');
  document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
}
function closeTopModal() {
  // Close the topmost modal, keep project detail open if it was open
  const open = [...document.querySelectorAll('.modal.open')];
  if (open.length === 0) return;
  const top = open[open.length - 1];
  top.classList.remove('open');
  // If project detail is still open, keep backdrop
  if (document.querySelector('.modal.open')) {
    document.getElementById('modal-backdrop').classList.add('open');
  } else {
    document.getElementById('modal-backdrop').classList.remove('open');
  }
}

// ---- PO Modal ----------------------------------------------
function bindPOModal() {
  document.getElementById('f-jobnum').addEventListener('input', async () => {
    const j = document.getElementById('f-jobnum').value.trim();
    if (!j || document.getElementById('f-po-id').value) return;
    const padded = String(j).trim().padStart(3, '0').slice(0, 15);
    try { const { num } = await get(`/api/pos/next-num/${padded}`); document.getElementById('po-num-display').textContent = num; } catch(_) {}
  });
  document.getElementById('btn-save-po').addEventListener('click', savePOForm);
  document.getElementById('btn-delete-po').addEventListener('click', async () => {
    const id = parseInt(document.getElementById('f-po-id').value);
    if (!id || !confirm('Delete this PO?')) return;
    await del(`/api/pos/${id}`);
    await refreshData(); closeModals(); renderPage(state.currentPage);
  });
}

async function openPOModal(poId) {
  const isEdit = !!poId;
  document.getElementById('po-modal-title').textContent = isEdit ? 'Edit purchase order' : 'New purchase order';
  document.getElementById('btn-delete-po').style.display = isEdit ? 'inline-block' : 'none';
  document.getElementById('f-project-select').innerHTML = state.projects.map(p => `<option value="${p.id}">${p.name} — Job ${p.job_num}</option>`).join('');
  if (isEdit) {
    const po = state.pos.find(p => p.id === poId);
    document.getElementById('f-po-id').value    = po.id;
    document.getElementById('f-jobnum').value   = po.num.replace('PO','').split('-')[0];
    document.getElementById('po-num-display').textContent = po.num;
    document.getElementById('f-supplier').value = po.supplier;
    document.getElementById('f-project-select').value = po.project_id;
    document.getElementById('f-desc').value         = po.description||'';
    document.getElementById('f-amount').value       = po.amount;
    document.getElementById('f-due').value          = po.due_date||'';
    document.getElementById('f-status').value       = po.status;
    document.getElementById('f-invoiced').checked   = po.invoiced||false;
    document.getElementById('f-invoiced-date').value= po.invoiced_date||'';
    document.getElementById('f-paid').checked       = po.paid||false;
    document.getElementById('f-paid-date').value    = po.paid_date||'';
  } else {
    ['f-po-id','f-jobnum','f-supplier','f-desc','f-amount','f-due','f-invoiced-date','f-paid-date'].forEach(id => document.getElementById(id).value='');
    document.getElementById('po-num-display').textContent = 'Enter job number';
    document.getElementById('f-status').value    = 'Draft';
    document.getElementById('f-invoiced').checked = false;
    document.getElementById('f-paid').checked     = false;
  }
  openModal('modal-po');
}

async function savePOForm() {
  const existId = document.getElementById('f-po-id').value;
  const num     = document.getElementById('po-num-display').textContent;
  const supplier = document.getElementById('f-supplier').value.trim();
  if (!supplier) { alert('Please enter a supplier'); return; }
  const body = {
    num, supplier,
    project_id:    parseInt(document.getElementById('f-project-select').value),
    description:   document.getElementById('f-desc').value.trim(),
    amount:        parseFloat(document.getElementById('f-amount').value)||0,
    status:        document.getElementById('f-status').value,
    due_date:      document.getElementById('f-due').value.trim(),
    invoiced:      document.getElementById('f-invoiced').checked,
    invoiced_date: document.getElementById('f-invoiced-date').value.trim(),
    paid:          document.getElementById('f-paid').checked,
    paid_date:     document.getElementById('f-paid-date').value.trim(),
  };
  try {
    if (existId) await put(`/api/pos/${existId}`, body);
    else await post('/api/pos', body);
    await refreshData(); closeModals(); renderPage(state.currentPage);
  } catch (err) { alert(err.message); }
}

async function openPODetail(poId) {
  // Fetch fresh data in case we're coming from project detail
  await refreshData();
  const po   = state.pos.find(p => p.id === poId);
  if (!po) return;
  const proj = state.projects.find(p => p.id === po.project_id)||{};

  document.getElementById('po-detail-num').textContent = po.num;
  document.getElementById('po-detail-body').innerHTML = `
    <div class="po-detail-grid">
      <div class="po-detail-field"><div class="pdf-label">Supplier</div><div class="pdf-value">${po.supplier}</div></div>
      <div class="po-detail-field"><div class="pdf-label">PO amount</div><div class="pdf-value mono" style="color:var(--red)">${fmt(po.amount)}</div></div>
      <div class="po-detail-field"><div class="pdf-label">Project</div><div class="pdf-value">${po.project_name||'—'}</div></div>
      <div class="po-detail-field"><div class="pdf-label">Job number</div><div class="pdf-value mono">${po.job_num||proj.job_num||'—'}</div></div>
      <div class="po-detail-field"><div class="pdf-label">Description</div><div class="pdf-value">${po.description||'—'}</div></div>
      <div class="po-detail-field"><div class="pdf-label">PO due date</div><div class="pdf-value">${po.due_date||'—'}</div></div>
      <div class="po-detail-field"><div class="pdf-label">Status</div><div class="pdf-value">${badge(po.status)}</div></div>
      <div class="po-detail-field"><div class="pdf-label">Added by</div><div class="pdf-value">${po.created_by_name||'—'}</div></div>
    </div>

    <div class="payment-track-box" style="margin-top:14px;">
      <div class="payment-track-title">Invoice from supplier</div>
      <div class="field-group">
        <label><input type="checkbox" id="pod-inv-received" style="width:auto;margin-right:6px;">${po.invoice_received ? '<strong>Invoice received</strong>' : 'Mark invoice as received'}</label>
      </div>
      <div id="pod-inv-fields" style="margin-top:12px;${po.invoice_received ? '' : 'display:none;'}">
        <div class="form-row">
          <div class="field-group">
            <label>Invoice amount (£)</label>
            <input type="number" id="pod-inv-amount" placeholder="0.00" step="0.01" min="0" value="${po.invoice_amount != null ? po.invoice_amount : po.amount}">
          </div>
          <div class="field-group">
            <label>Invoice date <span class="hint">date received</span></label>
            <input type="text" id="pod-inv-date" placeholder="DD/MM/YY" value="${po.invoice_date||''}">
          </div>
        </div>
        <div class="field-group">
          <label>Invoice due date <span class="hint">when payment is due to supplier</span></label>
          <input type="text" id="pod-inv-due-date" placeholder="DD/MM/YY" value="${po.invoice_due_date||''}">
        </div>
        <div style="font-size:11px;color:var(--blue);background:var(--blue-light);padding:8px 10px;border-radius:var(--r);margin-top:8px;">
          Saving this will automatically update the Cash Out section of the linked project.
        </div>
      </div>
    </div>

    <div class="payment-track-box" style="margin-top:10px;">
      <div class="payment-track-title">Payment to supplier</div>
      <div class="form-row">
        <div class="field-group">
          <label><input type="checkbox" id="pod-paid" style="width:auto;margin-right:6px;">We have paid this invoice</label>
        </div>
        <div class="field-group">
          <label>Date paid</label>
          <input type="text" id="pod-paid-date" placeholder="DD/MM/YY" value="${po.paid_date||''}">
        </div>
      </div>
    </div>

    ${po.xero_id ? `<div style="background:var(--blue-light);border-radius:var(--r);padding:10px 12px;font-size:12px;color:var(--blue);margin-top:10px;">✓ Pushed to Xero — Bill ID: <code>${po.xero_id}</code></div>` : ''}
  `;

  // Set checkbox states
  document.getElementById('pod-inv-received').checked = po.invoice_received||false;
  document.getElementById('pod-paid').checked         = po.paid||false;

  // Toggle invoice fields visibility
  document.getElementById('pod-inv-received').addEventListener('change', function() {
    document.getElementById('pod-inv-fields').style.display = this.checked ? 'block' : 'none';
  });

  // Save invoice details button handler
  const saveBtn = document.getElementById('btn-edit-from-detail');
  saveBtn.textContent = 'Save changes';
  saveBtn.disabled = false;
  // Clone to remove any previous listeners
  const newSaveBtn = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
  newSaveBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    newSaveBtn.textContent = 'Saving…';
    newSaveBtn.disabled = true;
    try {
      const invoiceReceived = document.getElementById('pod-inv-received').checked;
      const invAmountEl  = document.getElementById('pod-inv-amount');
      const invDateEl    = document.getElementById('pod-inv-date');
      const invDueDateEl = document.getElementById('pod-inv-due-date');
      const paidChkEl    = document.getElementById('pod-paid');
      const paidDateEl   = document.getElementById('pod-paid-date');

      const invoiceAmount  = invAmountEl  ? (parseFloat(invAmountEl.value)  || null) : null;
      const invoiceDate    = invDateEl    ? invDateEl.value.trim()    : '';
      const invoiceDueDate = invDueDateEl ? invDueDateEl.value.trim() : '';
      const paid           = paidChkEl    ? paidChkEl.checked         : false;
      const paidDate       = paidDateEl   ? paidDateEl.value.trim()   : '';

      // Single combined update — invoice details + paid status in one route
      const res1 = await fetch(`/api/pos/${poId}/invoice`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_received: invoiceReceived, invoice_amount: invoiceAmount, invoice_date: invoiceDate, invoice_due_date: invoiceDueDate })
      });
      if (!res1.ok) {
        const d = await res1.json().catch(() => ({}));
        throw new Error(d.error || `Invoice save failed (${res1.status})`);
      }

      // Update paid status directly
      const res2 = await fetch(`/api/pos/${poId}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier:      po.supplier      || '',
          project_id:    po.project_id    || null,
          description:   po.description   || '',
          amount:        Number(po.amount) || 0,
          status:        invoiceReceived ? 'Received' : (po.status || 'Draft'),
          due_date:      po.due_date      || '',
          invoiced:      po.invoiced      || false,
          invoiced_date: po.invoiced_date || '',
          paid,
          paid_date:     paidDate,
        })
      });
      if (!res2.ok) {
        const d = await res2.json().catch(() => ({}));
        throw new Error(d.error || `Paid status save failed (${res2.status})`);
      }

      await refreshData();

      if (detailProjectId) {
        const freshData = await get(`/api/projects/${detailProjectId}/detail`);
        renderDetailBody(freshData);
      }

      newSaveBtn.textContent = 'Saved ✓';
      setTimeout(() => closeTopModal(), 600);
    } catch (err) {
      alert('Error saving: ' + err.message);
      newSaveBtn.textContent = 'Save changes';
      newSaveBtn.disabled = false;
    }
  });

  const pushBtn = document.getElementById('btn-push-xero');
  pushBtn.style.display = (state.xero.connected && !po.xero_id) ? 'inline-block' : 'none';
  pushBtn.onclick = async () => {
    pushBtn.textContent='Pushing…'; pushBtn.disabled=true;
    try {
      await post(`/api/xero/push-po/${poId}`);
      await refreshData(); closeTopModal(); renderPage(state.currentPage);
    } catch (err) { alert('Xero error: '+err.message); pushBtn.textContent='Push to Xero as bill'; pushBtn.disabled=false; }
  };

  openModal('modal-po-detail');
}

// ---- Project Modal -----------------------------------------
function bindProjectModal() {
  document.getElementById('btn-save-proj').addEventListener('click', saveProjectForm);
  document.getElementById('btn-delete-proj').addEventListener('click', async () => {
    const id = parseInt(document.getElementById('pf-id').value);
    if (!id || !confirm('Delete this project?')) return;
    await del(`/api/projects/${id}`);
    await refreshData(); closeModals(); renderPage(state.currentPage);
  });
}

async function openProjectModal(projId) {
  const isEdit = !!projId;
  document.getElementById('proj-modal-title').textContent = isEdit ? 'Edit project' : 'New project';
  document.getElementById('btn-delete-proj').style.display = isEdit ? 'inline-block' : 'none';
  if (isEdit) {
    const p = state.projects.find(p => p.id === projId);
    document.getElementById('pf-id').value       = p.id;
    document.getElementById('pf-name').value     = p.name;
    document.getElementById('pf-jobnum').value   = p.job_num;
    document.getElementById('pf-client').value   = p.client||'';
    document.getElementById('pf-budget').value   = p.budget;
    document.getElementById('pf-income').value   = p.income;
    document.getElementById('pf-status').value   = p.status;
    document.getElementById('pf-start').value    = p.start_date||'';
    document.getElementById('pf-end').value      = p.end_date||'';
    document.getElementById('pf-location').value = p.location||'';
    document.getElementById('pf-notes').value    = p.notes||'';
  } else {
    ['pf-id','pf-name','pf-jobnum','pf-client','pf-budget','pf-income','pf-start','pf-end','pf-location','pf-notes'].forEach(id => document.getElementById(id).value='');
    document.getElementById('pf-status').value = 'Active';
  }
  openModal('modal-project');
}

async function saveProjectForm() {
  const existId = document.getElementById('pf-id').value;
  const name    = document.getElementById('pf-name').value.trim();
  if (!name) { alert('Please enter a project name'); return; }
  const body = {
    job_num:    document.getElementById('pf-jobnum').value.trim().padStart(3,'0').slice(0,15),
    name,
    client:     document.getElementById('pf-client').value.trim(),
    budget:     parseFloat(document.getElementById('pf-budget').value)||0,
    income:     parseFloat(document.getElementById('pf-income').value)||0,
    status:     document.getElementById('pf-status').value,
    start_date: document.getElementById('pf-start').value.trim(),
    end_date:   document.getElementById('pf-end').value.trim(),
    location:   document.getElementById('pf-location').value.trim(),
    notes:      document.getElementById('pf-notes').value.trim(),
  };
  try {
    if (existId) await put(`/api/projects/${existId}`, body);
    else await post('/api/projects', body);
    await refreshData(); closeModals(); renderPage(state.currentPage);
  } catch (err) { alert(err.message); }
}

// ---- Start -------------------------------------------------
boot();

// ============================================================
// PROJECT DETAIL
// ============================================================

let detailProjectId = null;

async function openProjectDetail(projId) {
  detailProjectId = projId;
  const data = await get(`/api/projects/${projId}/detail`);
  const p = data.project;

  document.getElementById('proj-detail-title').textContent = p.name;
  const dateRange = p.start_date || p.end_date
    ? (p.start_date && p.end_date ? `${p.start_date} → ${p.end_date}` : p.start_date || p.end_date)
    : null;
  const subParts = [
    `Job ${p.job_num}`,
    p.client || null,
    p.status,
    dateRange,
    p.location || null,
    p.notes || null,
  ].filter(Boolean);
  document.getElementById('proj-detail-sub').textContent = subParts.join(' · ');

  // Render a clean info bar above the metrics
  const infoBar = document.createElement('div');
  infoBar.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:18px;';
  const infoFields = [
    { label: 'Client',    value: p.client     || '—' },
    { label: 'Job no.',   value: p.job_num    || '—' },
    { label: 'Status',    value: p.status     || '—' },
    { label: 'Start',     value: p.start_date || '—' },
    { label: 'End',       value: p.end_date   || '—' },
    { label: 'Location',  value: p.location   || '—' },
    { label: 'Budget',    value: fmt(p.budget)       },
    { label: 'Notes',     value: p.notes      || '—' },
  ];
  infoBar.innerHTML = infoFields.map(f => `
    <div style="background:var(--bg);border-radius:var(--r);padding:10px 12px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.6px;color:var(--txt3);font-weight:500;margin-bottom:3px;">${f.label}</div>
      <div style="font-size:13px;font-weight:500;">${f.value}</div>
    </div>`).join('');

  document.getElementById('btn-proj-detail-edit').onclick = () => {
    closeModals();
    openProjectModal(projId);
  };

  renderDetailBody(data, infoBar);
  openModal('modal-proj-detail');
}

function renderDetailBody(data, infoBar) {
  const p      = data.project;
  const pos    = data.pos    || [];
  const income = data.income || [];
  const spend  = data.spend  || [];

  // Totals
  const totalIncomePredicted = income.reduce((a, i) => a + Number(i.predicted), 0);
  const totalIncomeActual    = income.reduce((a, i) => a + Number(i.actual || 0), 0);
  // Only include POs in totals if they don't already have a linked spend line
  // (to avoid double-counting when invoice has been received and spend line auto-created)
  const posWithoutSpendLine    = pos.filter(po => !po.spend_line_id);
  const posWithSpendLine       = pos.filter(po => po.spend_line_id);

  const totalSpendPredicted  = spend.reduce((a, s) => a + Number(s.predicted), 0)
                             + posWithoutSpendLine.reduce((a, po) => a + Number(po.amount), 0);
  const totalSpendActual     = spend.reduce((a, s) => a + Number(s.actual || 0), 0)
                             + posWithoutSpendLine.filter(po => po.actual_amount != null).reduce((a, po) => a + Number(po.actual_amount), 0)
                             + posWithoutSpendLine.filter(po => po.status === 'Paid' && po.actual_amount == null).reduce((a, po) => a + Number(po.amount), 0);
  const netPredicted = totalIncomePredicted - totalSpendPredicted;
  const netActual    = totalIncomeActual    - totalSpendActual;

  const bodyEl = document.getElementById('proj-detail-body');
  bodyEl.innerHTML = '';
  if (infoBar) bodyEl.appendChild(infoBar);
  const mainContent = document.createElement('div');
  mainContent.innerHTML = `

    <!-- SUMMARY METRICS -->
    <div class="proj-metrics">
      <div class="proj-metric">
        <div class="proj-metric-label">Income predicted</div>
        <div class="proj-metric-val" style="color:var(--green)">${fmt(totalIncomePredicted)}</div>
      </div>
      <div class="proj-metric">
        <div class="proj-metric-label">Income actual</div>
        <div class="proj-metric-val" style="color:var(--green)">${fmt(totalIncomeActual)}</div>
      </div>
      <div class="proj-metric">
        <div class="proj-metric-label">Spend predicted</div>
        <div class="proj-metric-val" style="color:var(--red)">${fmt(totalSpendPredicted)}</div>
      </div>
      <div class="proj-metric">
        <div class="proj-metric-label">Spend actual</div>
        <div class="proj-metric-val" style="color:var(--red)">${fmt(totalSpendActual)}</div>
      </div>
      <div class="proj-metric">
        <div class="proj-metric-label">Net (predicted)</div>
        <div class="proj-metric-val" style="color:${netPredicted >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(netPredicted)}</div>
      </div>
    </div>

    <!-- INCOME -->
    <div class="detail-section">
      <div class="detail-section-head">
        <div class="detail-section-title">Cash in — income</div>
        <button class="btn btn-primary btn-sm" id="proj-add-income" data-projid="${p.id}">+ Add income</button>
      </div>
      <div class="table-card">
        <table class="line-table">
          <thead><tr><th>Description</th><th>Due date</th><th>Predicted</th><th>Actual</th><th>Variance</th><th>Invoiced</th><th>Paid</th></tr></thead>
          <tbody>
            ${income.map(i => {
              const variance = i.actual != null ? Number(i.actual) - Number(i.predicted) : null;
              const invoicedPill = i.invoiced ? `<span class="pill-invoiced">✓ Invoiced${i.invoiced_date ? ' · ' + i.invoiced_date : ''}</span>` : `<span class="pill-unpaid">Not invoiced</span>`;
              const paidPill     = i.paid     ? `<span class="pill-paid">✓ Paid${i.paid_date ? ' · ' + i.paid_date : ''}</span>`         : `<span class="pill-unpaid">Unpaid</span>`;
              return `<tr class="proj-income-row" data-lid="${i.id}" data-projid="${p.id}">
                <td>${i.description}</td>
                <td>${i.due_date || '—'}</td>
                <td class="mono">${fmt(i.predicted)}</td>
                <td class="mono" style="color:var(--green)">${i.actual != null ? fmt(i.actual) : '<span class="actual-blank">not yet</span>'}</td>
                <td>${variance != null ? `<span class="${variance >= 0 ? 'variance-pos' : 'variance-neg'}">${variance >= 0 ? '+' : ''}${fmt(variance)}</span>` : '—'}</td>
                <td>${invoicedPill}</td>
                <td>${paidPill}</td>
              </tr>`;
            }).join('')}
            ${income.length === 0 ? '<tr><td colspan="6"><div class="empty-state">No income lines yet — click + Add income</div></td></tr>' : ''}
            ${income.length > 0 ? `<tr class="totals-row">
              <td colspan="2"><strong>Total</strong></td>
              <td class="mono"><strong>${fmt(totalIncomePredicted)}</strong></td>
              <td class="mono" style="color:var(--green)"><strong>${fmt(totalIncomeActual)}</strong></td>
              <td colspan="2"></td>
            </tr>` : ''}
          </tbody>
        </table>
      </div>
    </div>

    <!-- SPEND -->
    <div class="detail-section">
      <div class="detail-section-head">
        <div class="detail-section-title">Cash out — predicted vs actual spend</div>
        <button class="btn btn-primary btn-sm" id="proj-add-spend" data-projid="${p.id}">+ Add spend</button>
      </div>
      <div class="table-card">
        <table class="line-table">
          <thead><tr><th>Category</th><th>Description</th><th>Due date</th><th>Predicted</th><th>Actual</th><th>Variance</th><th>Payment</th></tr></thead>
          <tbody>
            ${spend.map(s => {
              const variance = s.actual != null ? Number(s.actual) - Number(s.predicted) : null;
              const spaidPill = s.paid ? `<span class="pill-paid">✓ Paid${s.paid_date ? ' · ' + s.paid_date : ''}</span>` : `<span class="pill-unpaid">Unpaid</span>`;
              return `<tr class="proj-spend-row" data-lid="${s.id}" data-projid="${p.id}">
                <td>${badge(s.category)}</td>
                <td>${s.description || '—'}</td>
                <td>${s.due_date || '—'}</td>
                <td class="mono">${fmt(s.predicted)}</td>
                <td class="mono" style="color:var(--red)">${s.actual != null ? fmt(s.actual) : '<span class="actual-blank">not yet</span>'}</td>
                <td>${variance != null ? `<span class="${variance <= 0 ? 'variance-pos' : 'variance-neg'}">${variance > 0 ? '+' : ''}${fmt(variance)}</span>` : '—'}</td>
                <td>${spaidPill}</td>
              </tr>`;
            }).join('')}
            ${spend.length === 0 ? '<tr><td colspan="6"><div class="empty-state">No spend lines yet — click + Add spend</div></td></tr>' : ''}
            ${spend.length > 0 ? `<tr class="totals-row">
              <td colspan="3"><strong>Total</strong></td>
              <td class="mono"><strong>${fmt(totalSpendPredicted)}</strong></td>
              <td class="mono" style="color:var(--red)"><strong>${fmt(totalSpendActual)}</strong></td>
              <td></td>
            </tr>` : ''}
          </tbody>
        </table>
      </div>
    </div>

    <!-- PURCHASE ORDERS -->
    <div class="detail-section">
      <div class="detail-section-head">
        <div class="detail-section-title">Purchase orders linked to this job</div>
        <button class="btn btn-primary btn-sm" id="proj-detail-new-po">+ New PO</button>
      </div>
      <div class="table-card">
        <table class="line-table">
          <thead><tr><th>PO number</th><th>Supplier</th><th>Description</th><th>PO value</th><th>Invoice amount</th><th>Invoice status</th><th>PO status</th></tr></thead>
          <tbody id="proj-detail-po-tbody">
            ${pos.map(po => {
              const invPill = po.invoice_received
                ? `<span class="pill-invoice-received">✓ Invoiced${po.invoice_date ? ' · ' + po.invoice_date : ''}${po.invoice_amount != null ? ' · ' + fmt(po.invoice_amount) : ''}${po.invoice_due_date ? ' · Due: ' + po.invoice_due_date : ''}</span>`
                : `<span class="pill-unpaid">Awaiting invoice</span>`;
              return `<tr>
                <td class="mono"><a href="#" class="proj-po-link" data-poid="${po.id}" style="color:var(--green);font-weight:500;">${po.num}</a></td>
                <td>${po.supplier}</td>
                <td style="color:var(--txt2)">${po.description || '—'}</td>
                <td class="mono">${fmt(po.amount)}</td>
                <td class="mono" style="color:var(--red)">${po.invoice_amount != null ? fmt(po.invoice_amount) : '<span class="actual-blank">not yet</span>'}</td>
                <td>${invPill}</td>
                <td>${badge(po.status)}</td>
              </tr>`;
            }).join('')}
            ${pos.length === 0 ? '<tr><td colspan="7"><div class="empty-state">No POs linked to this job yet</div></td></tr>' : ''}
          </tbody>
        </table>
      </div>
    </div>
  `;
  bodyEl.appendChild(mainContent);

  // Bind all events scoped to bodyEl so they work inside the modal
  const newPOBtn = bodyEl.querySelector('#proj-detail-new-po');
  if (newPOBtn) newPOBtn.addEventListener('click', () => { closeModals(); openPOModal(); });

  bodyEl.querySelectorAll('.proj-po-link').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      openPODetail(parseInt(el.dataset.poid));
    });
  });

  // Mark invoiced button removed — invoice tracking now handled inside PO detail

  // Bind income rows
  const addIncomeBtn = bodyEl.querySelector('#proj-add-income');
  if (addIncomeBtn) addIncomeBtn.addEventListener('click', e => {
    e.stopPropagation();
    openIncomeLineModal(null, parseInt(addIncomeBtn.dataset.projid));
  });

  bodyEl.querySelectorAll('.proj-income-row').forEach(el => {
    el.addEventListener('click', () => openIncomeLineModal(parseInt(el.dataset.lid), parseInt(el.dataset.projid)));
  });

  // Bind spend rows
  const addSpendBtn = bodyEl.querySelector('#proj-add-spend');
  if (addSpendBtn) addSpendBtn.addEventListener('click', e => {
    e.stopPropagation();
    openSpendLineModal(null, parseInt(addSpendBtn.dataset.projid));
  });

  bodyEl.querySelectorAll('.proj-spend-row').forEach(el => {
    el.addEventListener('click', () => openSpendLineModal(parseInt(el.dataset.lid), parseInt(el.dataset.projid)));
  });
}

// ---- Income line modal -------------------------------------

function openIncomeLineModal(lineId, projectId) {
  const isEdit = !!lineId;
  document.getElementById('income-line-title').textContent = isEdit ? 'Edit income' : 'Add income';
  document.getElementById('btn-delete-income').style.display = isEdit ? 'inline-block' : 'none';
  document.getElementById('il-id').value = lineId || '';

  if (!isEdit) {
    ['il-desc','il-predicted','il-actual','il-due'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('il-status').value = 'Pending';
  } else {
    // find from last loaded data - reload if needed
    const rows = document.querySelectorAll('#proj-detail-body .line-table tbody tr');
    // just clear and let user fill — data is in the table visually
  }

  if (!isEdit) {
    document.getElementById('il-invoiced').checked   = false;
    document.getElementById('il-invoiced-date').value = '';
    document.getElementById('il-paid').checked       = false;
    document.getElementById('il-paid-date').value    = '';
  }

  document.getElementById('btn-save-income').onclick = async () => {
    const body = {
      description: document.getElementById('il-desc').value.trim(),
      predicted:   parseFloat(document.getElementById('il-predicted').value) || 0,
      actual:      document.getElementById('il-actual').value !== '' ? parseFloat(document.getElementById('il-actual').value) : null,
      due_date:    document.getElementById('il-due').value.trim(),
      status:      document.getElementById('il-status').value,
      invoiced:      document.getElementById('il-invoiced').checked,
      invoiced_date: document.getElementById('il-invoiced-date').value.trim(),
      paid:          document.getElementById('il-paid').checked,
      paid_date:     document.getElementById('il-paid-date').value.trim(),
    };
    if (!body.description) { alert('Please enter a description'); return; }
    if (isEdit) {
      await fetch(`/api/income/${lineId}`, { method:'PUT', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    } else {
      await fetch(`/api/projects/${projectId}/income`, { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    }
    closeModals();
    const data = await get(`/api/projects/${projectId}/detail`);
    renderDetailBody(data);
    openModal('modal-proj-detail');
  };

  document.getElementById('btn-delete-income').onclick = async () => {
    if (!confirm('Delete this income line?')) return;
    await fetch(`/api/income/${lineId}`, { method:'DELETE', credentials:'same-origin' });
    closeModals();
    const data = await get(`/api/projects/${projectId}/detail`);
    renderDetailBody(data);
    openModal('modal-proj-detail');
  };

  openModal('modal-income-line');
}

// ---- Spend line modal --------------------------------------

function openSpendLineModal(lineId, projectId) {
  const isEdit = !!lineId;
  document.getElementById('spend-line-title').textContent = isEdit ? 'Edit spend' : 'Add spend';
  document.getElementById('btn-delete-spend').style.display = isEdit ? 'inline-block' : 'none';
  document.getElementById('sl-id').value = lineId || '';

  if (!isEdit) {
    ['sl-desc','sl-predicted','sl-actual','sl-due','sl-paid-date'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('sl-category').value = 'Equipment';
    document.getElementById('sl-paid').checked = false;
  }

  document.getElementById('btn-save-spend').onclick = async () => {
    const body = {
      category:    document.getElementById('sl-category').value,
      description: document.getElementById('sl-desc').value.trim(),
      predicted:   parseFloat(document.getElementById('sl-predicted').value) || 0,
      actual:      document.getElementById('sl-actual').value !== '' ? parseFloat(document.getElementById('sl-actual').value) : null,
      due_date:    document.getElementById('sl-due').value.trim(),
      paid:        document.getElementById('sl-paid').checked,
      paid_date:   document.getElementById('sl-paid-date').value.trim(),
    };
    if (isEdit) {
      await fetch(`/api/spend/${lineId}`, { method:'PUT', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    } else {
      await fetch(`/api/projects/${projectId}/spend`, { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    }
    closeModals();
    const data = await get(`/api/projects/${projectId}/detail`);
    renderDetailBody(data);
    openModal('modal-proj-detail');
  };

  document.getElementById('btn-delete-spend').onclick = async () => {
    if (!confirm('Delete this spend line?')) return;
    await fetch(`/api/spend/${lineId}`, { method:'DELETE', credentials:'same-origin' });
    closeModals();
    const data = await get(`/api/projects/${projectId}/detail`);
    renderDetailBody(data);
    openModal('modal-proj-detail');
  };

  openModal('modal-spend-line');
}
