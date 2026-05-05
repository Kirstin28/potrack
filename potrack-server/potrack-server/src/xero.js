// ============================================================
// POTrack — Xero OAuth Routes
// ============================================================

const express = require('express');
const axios   = require('axios');
const { pool } = require('./db');
const router  = express.Router();

const XERO_AUTH_URL  = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const SCOPES         = 'openid profile email accounting.transactions accounting.contacts offline_access';

function redirectUri() {
  return `${process.env.APP_URL}/auth/xero/callback`;
}

// GET /auth/xero/connect — redirect to Xero login
router.get('/connect', (req, res) => {
  if (!process.env.XERO_CLIENT_ID) {
    return res.status(400).send('Xero Client ID not configured in environment variables.');
  }
  const url = `${XERO_AUTH_URL}?response_type=code&client_id=${process.env.XERO_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri())}&scope=${encodeURIComponent(SCOPES)}&state=potrack`;
  res.redirect(url);
});

// GET /auth/xero/callback — Xero redirects here after login
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.send(`<script>window.close();</script><p>Xero connection failed: ${error || 'no code'}. Close this window.</p>`);
  }

  try {
    const tokenRes = await axios.post(XERO_TOKEN_URL,
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() }),
      {
        auth: { username: process.env.XERO_CLIENT_ID, password: process.env.XERO_CLIENT_SECRET },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    const tenantsRes = await axios.get('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const tenant = tenantsRes.data[0];

    await pool.query(`
      INSERT INTO xero_tokens (id, access_token, refresh_token, expires_at, tenant_id, tenant_name)
      VALUES (1, $1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET
        access_token=$1, refresh_token=$2, expires_at=$3, tenant_id=$4, tenant_name=$5
    `, [access_token, refresh_token, Date.now() + expires_in * 1000, tenant.tenantId, tenant.tenantName]);

    res.send(`
      <html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#F2F1EE;margin:0;">
      <div style="text-align:center;background:#fff;padding:40px;border-radius:12px;border:1px solid #E2DFD8;">
        <div style="font-size:32px;margin-bottom:12px">✓</div>
        <h2 style="color:#1A8C67;margin-bottom:8px">Connected to Xero!</h2>
        <p style="color:#5A5855">Connected to <strong>${tenant.tenantName}</strong>.</p>
        <p style="color:#5A5855;margin-top:8px">You can close this window and return to POTrack.</p>
      </div></body></html>
    `);
  } catch (err) {
    console.error('Xero callback error:', err.response?.data || err.message);
    res.status(500).send('<p>Error connecting to Xero. Check server logs. Close this window and try again.</p>');
  }
});

// GET /api/xero/status
router.get('/status', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM xero_tokens WHERE id = 1');
    if (!rows[0]) return res.json({ connected: false });
    res.json({ connected: true, tenantName: rows[0].tenant_name });
  } catch (err) {
    res.json({ connected: false });
  }
});

// POST /api/xero/disconnect
router.post('/disconnect', async (req, res) => {
  await pool.query('DELETE FROM xero_tokens WHERE id = 1');
  res.json({ ok: true });
});

// Helper — get valid token (refresh if needed)
async function getToken() {
  const { rows } = await pool.query('SELECT * FROM xero_tokens WHERE id = 1');
  if (!rows[0]) throw new Error('Xero not connected');
  const token = rows[0];

  if (Date.now() < parseInt(token.expires_at) - 60000) return token;

  // Refresh
  const res = await axios.post(XERO_TOKEN_URL,
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token }),
    { auth: { username: process.env.XERO_CLIENT_ID, password: process.env.XERO_CLIENT_SECRET }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  const { access_token, refresh_token, expires_in } = res.data;
  await pool.query(
    'UPDATE xero_tokens SET access_token=$1, refresh_token=$2, expires_at=$3 WHERE id=1',
    [access_token, refresh_token, Date.now() + expires_in * 1000]
  );
  return { ...token, access_token };
}

// GET /api/xero/contacts — supplier list
router.get('/contacts', async (req, res) => {
  try {
    const token = await getToken();
    const r = await axios.get('https://api.xero.com/api.xro/2.0/Contacts?where=IsSupplier=true&summaryOnly=true', {
      headers: { Authorization: `Bearer ${token.access_token}`, 'Xero-tenant-id': token.tenant_id, Accept: 'application/json' }
    });
    res.json(r.data.Contacts.map(c => ({ id: c.ContactID, name: c.Name })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/xero/invoices — outstanding invoices (money due IN)
router.get('/invoices', async (req, res) => {
  try {
    const token = await getToken();
    const r = await axios.get('https://api.xero.com/api.xro/2.0/Invoices?Statuses=AUTHORISED,SUBMITTED&order=DueDateUTC ASC', {
      headers: { Authorization: `Bearer ${token.access_token}`, 'Xero-tenant-id': token.tenant_id, Accept: 'application/json' }
    });
    res.json(r.data.Invoices.map(i => ({
      id: i.InvoiceID, number: i.InvoiceNumber,
      contact: i.Contact?.Name, amount: i.AmountDue,
      due: i.DueDateString, status: i.Status,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/xero/push-po/:id — push PO to Xero as bill
router.post('/push-po/:id', async (req, res) => {
  try {
    const token = await getToken();
    const { rows } = await pool.query('SELECT * FROM purchase_orders WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'PO not found' });
    const po = rows[0];

    const billData = {
      Type: 'ACCPAY',
      Contact: { Name: po.supplier },
      LineItems: [{ Description: po.description || po.num, Quantity: 1, UnitAmount: po.amount, AccountCode: '300' }],
      Status: po.status === 'Draft' ? 'DRAFT' : 'SUBMITTED',
      Reference: po.num,
    };

    const r = await axios.post('https://api.xero.com/api.xro/2.0/Invoices', billData, {
      headers: { Authorization: `Bearer ${token.access_token}`, 'Xero-tenant-id': token.tenant_id, 'Content-Type': 'application/json', Accept: 'application/json' }
    });

    const xeroId = r.data.Invoices[0].InvoiceID;
    await pool.query('UPDATE purchase_orders SET xero_id = $1 WHERE id = $2', [xeroId, po.id]);
    res.json({ ok: true, xeroId });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.Detail || err.message });
  }
});

module.exports = router;
