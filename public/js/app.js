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
  document.getElementById('full-proj-table').innerHTML = tableWrap(
    ['Project','Job no.','Client','Budget','Due in','Due out','Status'],
    ['22%','9%','17%','12%','12%','13%','15%'],
    state.projects.length ? state.projects.map(p => `<tr onclick="openProjectModal(${p.id})">
      <td>${p.name}</td><td class="mono">${p.job_num}</td><td>${p.client||'—'}</td>
      <td class="mono">${fmt(p.budget)}</td>
      <td class="mono" style="color:var(--green)">${fmt(p.income)}</td>
      <td class="mono" style="color:var(--red)">${fmt(p.due_out)}</td>
      <td>${badge(p.status)}</td></tr>`).join('') :
    '<tr><td colspan="7"><div class="empty-state">No projects yet</div></td></tr>'
  );
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
  const s = state.settings;
  document.getElementById('setting-company').value  = s.company || '';
  document.getElementById('setting-currency').value = s.currency || 'GBP';
  document.getElementById('btn-disconnect').addEventListener('click', async () => {
    if (!confirm('Disconnect from Xero?')) return;
    await post('/api/xero/disconnect');
    state.xero = { connected: false };
    updateXeroUI(); renderXeroPage();
  });
  if (state.user?.role === 'admin') {
    document.getElementById('admin-panel').style.display = 'block';
    const users = await get('/api/users');
    document.getElementById('users-list').innerHTML = `<table class="users-table">${users.map(u =>
      `<tr><td>${u.name}</td><td style="color:var(--txt3)">${u.email}</td><td>${badge(u.role)}</td>
       <td>${u.id !== state.user.id ? `<button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})">Remove</button>` : ''}</td></tr>`
    ).join('')}</table>`;
  }
}

function bindSettings() {
  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    await post('/api/settings', { key: 'company', value: document.getElementById('setting-company').value });
    await post('/api/settings', { key: 'currency', value: document.getElementById('setting-currency').value });
    state.settings.currency = document.getElementById('setting-currency').value;
  });
}

async function deleteUser(id) {
  if (!confirm('Remove this user?')) return;
  await del(`/api/users/${id}`);
  renderSettings();
}

// ---- Top buttons -------------------------------------------
function bindTopButtons() {
  document.getElementById('btn-new-po').addEventListener('click',   () => openPOModal());
  document.getElementById('btn-new-proj').addEventListener('click', () => openProjectModal());
}

// ---- Modals ------------------------------------------------
function bindModalClose() {
  document.getElementById('modal-backdrop').addEventListener('click', closeModals);
  document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeModals));
}
function openModal(id) { document.getElementById('modal-backdrop').classList.add('open'); document.getElementById(id).classList.add('open'); }
function closeModals() { document.getElementById('modal-backdrop').classList.remove('open'); document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')); }

// ---- PO Modal ----------------------------------------------
function bindPOModal() {
  document.getElementById('f-jobnum').addEventListener('input', async () => {
    const j = document.getElementById('f-jobnum').value.trim();
    if (!j || document.getElementById('f-po-id').value) return;
    const padded = String(parseInt(j)||0).padStart(3,'0');
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
    document.getElementById('f-desc').value     = po.description||'';
    document.getElementById('f-amount').value   = po.amount;
    document.getElementById('f-due').value      = po.due_date||'';
    document.getElementById('f-status').value   = po.status;
  } else {
    ['f-po-id','f-jobnum','f-supplier','f-desc','f-amount','f-due'].forEach(id => document.getElementById(id).value='');
    document.getElementById('po-num-display').textContent = 'Enter job number';
    document.getElementById('f-status').value = 'Draft';
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
    project_id:  parseInt(document.getElementById('f-project-select').value),
    description: document.getElementById('f-desc').value.trim(),
    amount:      parseFloat(document.getElementById('f-amount').value)||0,
    status:      document.getElementById('f-status').value,
    due_date:    document.getElementById('f-due').value.trim(),
  };
  try {
    if (existId) await put(`/api/pos/${existId}`, body);
    else await post('/api/pos', body);
    await refreshData(); closeModals(); renderPage(state.currentPage);
  } catch (err) { alert(err.message); }
}

async function openPODetail(poId) {
  const po   = state.pos.find(p => p.id === poId);
  const proj = state.projects.find(p => p.id === po.project_id)||{};
  document.getElementById('po-detail-num').textContent = po.num;
  document.getElementById('po-detail-body').innerHTML = `
    <div class="po-detail-grid">
      <div class="po-detail-field"><div class="pdf-label">Supplier</div><div class="pdf-value">${po.supplier}</div></div>
      <div class="po-detail-field"><div class="pdf-label">Amount</div><div class="pdf-value mono" style="color:var(--red)">${fmt(po.amount)}</div></div>
      <div class="po-detail-field"><div class="pdf-label">Project</div><div class="pdf-value">${po.project_name||'—'}</div></div>
      <div class="po-detail-field"><div class="pdf-label">Job number</div><div class="pdf-value mono">${po.job_num||proj.job_num||'—'}</div></div>
      <div class="po-detail-field"><div class="pdf-label">Description</div><div class="pdf-value">${po.description||'—'}</div></div>
      <div class="po-detail-field"><div class="pdf-label">Due date</div><div class="pdf-value">${po.due_date||'—'}</div></div>
      <div class="po-detail-field"><div class="pdf-label">Status</div><div class="pdf-value">${badge(po.status)}</div></div>
      <div class="po-detail-field"><div class="pdf-label">Added by</div><div class="pdf-value">${po.created_by_name||'—'}</div></div>
    </div>
    ${po.xero_id ? `<div style="background:var(--blue-light);border-radius:var(--r);padding:10px 12px;font-size:12px;color:var(--blue);">✓ Pushed to Xero — Bill ID: <code>${po.xero_id}</code></div>` : ''}
  `;
  const pushBtn = document.getElementById('btn-push-xero');
  pushBtn.style.display = (state.xero.connected && !po.xero_id) ? 'inline-block' : 'none';
  pushBtn.onclick = async () => {
    pushBtn.textContent='Pushing…'; pushBtn.disabled=true;
    try {
      await post(`/api/xero/push-po/${poId}`);
      await refreshData(); closeModals(); renderPage(state.currentPage);
    } catch (err) { alert('Xero error: '+err.message); pushBtn.textContent='Push to Xero as bill'; pushBtn.disabled=false; }
  };
  document.getElementById('btn-edit-from-detail').onclick = () => { closeModals(); openPOModal(poId); };
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
    document.getElementById('pf-id').value     = p.id;
    document.getElementById('pf-name').value   = p.name;
    document.getElementById('pf-jobnum').value = p.job_num;
    document.getElementById('pf-client').value = p.client||'';
    document.getElementById('pf-budget').value = p.budget;
    document.getElementById('pf-income').value = p.income;
    document.getElementById('pf-status').value = p.status;
    document.getElementById('pf-notes').value  = p.notes||'';
  } else {
    ['pf-id','pf-name','pf-jobnum','pf-client','pf-budget','pf-income','pf-notes'].forEach(id => document.getElementById(id).value='');
    document.getElementById('pf-status').value = 'Active';
  }
  openModal('modal-project');
}

async function saveProjectForm() {
  const existId = document.getElementById('pf-id').value;
  const name    = document.getElementById('pf-name').value.trim();
  if (!name) { alert('Please enter a project name'); return; }
  const body = {
    job_num: String(parseInt(document.getElementById('pf-jobnum').value)||0).padStart(3,'0'),
    name, client: document.getElementById('pf-client').value.trim(),
    budget: parseFloat(document.getElementById('pf-budget').value)||0,
    income: parseFloat(document.getElementById('pf-income').value)||0,
    status: document.getElementById('pf-status').value,
    notes:  document.getElementById('pf-notes').value.trim(),
  };
  try {
    if (existId) await put(`/api/projects/${existId}`, body);
    else await post('/api/projects', body);
    await refreshData(); closeModals(); renderPage(state.currentPage);
  } catch (err) { alert(err.message); }
}

// ---- Start -------------------------------------------------
boot();
