// ============================================================
// POTrack — API Routes (projects + purchase orders)
// ============================================================

const express  = require('express');
const { pool } = require('./db');
const router   = express.Router();

// ---- Projects ----------------------------------------------

router.get('/projects', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*,
        u.name AS created_by_name,
        COALESCE(SUM(CASE WHEN po.status != 'Paid' THEN po.amount ELSE 0 END), 0) AS due_out,
        COALESCE(SUM(po.amount), 0) AS po_total,
        COUNT(po.id) AS po_count
      FROM projects p
      LEFT JOIN users u ON p.created_by = u.id
      LEFT JOIN purchase_orders po ON po.project_id = p.id
      GROUP BY p.id, u.name
      ORDER BY p.id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/projects', async (req, res) => {
  try {
    const { job_num, name, client, budget, income, status, notes, start_date, end_date, location } = req.body;
    if (!name) return res.status(400).json({ error: 'Project name required' });
    const { rows } = await pool.query(`
      INSERT INTO projects (job_num, name, client, budget, income, status, notes, start_date, end_date, location, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
    `, [job_num, name, client||'', budget||0, income||0, status||'Active', notes||'', start_date||'', end_date||'', location||'', req.session.userId]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/projects/:id', async (req, res) => {
  try {
    const { job_num, name, client, budget, income, status, notes, start_date, end_date, location } = req.body;
    const { rows } = await pool.query(`
      UPDATE projects SET job_num=$1, name=$2, client=$3, budget=$4, income=$5,
        status=$6, notes=$7, start_date=$8, end_date=$9, location=$10, updated_at=NOW()
      WHERE id=$11 RETURNING *
    `, [job_num, name, client||'', budget||0, income||0, status, notes||'', start_date||'', end_date||'', location||'', req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/projects/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- Purchase Orders ---------------------------------------

router.get('/pos', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT po.*, p.name AS project_name, p.job_num, u.name AS created_by_name
      FROM purchase_orders po
      LEFT JOIN projects p ON po.project_id = p.id
      LEFT JOIN users u ON po.created_by = u.id
      ORDER BY po.id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/pos/next-num/:jobNum', async (req, res) => {
  try {
    const padded = String(req.params.jobNum).trim().padStart(3, '0').slice(0, 15);
    const prefix = `PO${padded}-`;
    const { rows } = await pool.query(
      `SELECT num FROM purchase_orders WHERE num LIKE $1`,
      [prefix + '%']
    );
    if (!rows.length) return res.json({ num: prefix + '001' });
    const nums = rows.map(r => parseInt(r.num.split('-')[1]) || 0);
    const next = String(Math.max(...nums) + 1).padStart(3, '0');
    res.json({ num: prefix + next });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/pos', async (req, res) => {
  try {
    const { num, supplier, project_id, description, amount, status, due_date, invoiced, invoiced_date, paid, paid_date } = req.body;
    if (!supplier) return res.status(400).json({ error: 'Supplier required' });
    const { rows } = await pool.query(`
      INSERT INTO purchase_orders (num, supplier, project_id, description, amount, status, due_date, invoiced, invoiced_date, paid, paid_date, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
    `, [num, supplier, project_id||null, description||'', amount||0, status||'Draft', due_date||'', invoiced||false, invoiced_date||'', paid||false, paid_date||'', req.session.userId]);

    // Fetch with project name
    const full = await pool.query(`
      SELECT po.*, p.name AS project_name, p.job_num
      FROM purchase_orders po LEFT JOIN projects p ON po.project_id = p.id
      WHERE po.id = $1`, [rows[0].id]);
    res.json(full.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'PO number already exists' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/pos/:id', async (req, res) => {
  try {
    const { supplier, project_id, description, amount, status, due_date, invoiced, invoiced_date, paid, paid_date } = req.body;
    await pool.query(`
      UPDATE purchase_orders SET supplier=$1, project_id=$2, description=$3,
        amount=$4, status=$5, due_date=$6, invoiced=$7, invoiced_date=$8, paid=$9, paid_date=$10, updated_at=NOW()
      WHERE id=$11
    `, [supplier, project_id||null, description||'', amount||0, status, due_date||'', invoiced||false, invoiced_date||'', paid||false, paid_date||'', req.params.id]);

    const { rows } = await pool.query(`
      SELECT po.*, p.name AS project_name, p.job_num
      FROM purchase_orders po LEFT JOIN projects p ON po.project_id = p.id
      WHERE po.id = $1`, [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/pos/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM purchase_orders WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- Settings ----------------------------------------------

router.get('/settings', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM settings');
    res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/settings', async (req, res) => {
  try {
    const { key, value } = req.body;
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = $2`,
      [key, value]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- Users (admin) -----------------------------------------

router.get('/users', async (req, res) => {
  try {
    if (req.session.userRole !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { rows } = await pool.query('SELECT id, name, email, role, created_at FROM users ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    if (req.session.userRole !== 'admin') return res.status(403).json({ error: 'Admin only' });
    if (parseInt(req.params.id) === req.session.userId) return res.status(400).json({ error: 'Cannot delete yourself' });
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

// ---- Project Detail ----------------------------------------

router.get('/projects/:id/detail', async (req, res) => {
  try {
    const id = req.params.id;

    const proj = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (!proj.rows[0]) return res.status(404).json({ error: 'Not found' });

    const pos = await pool.query(`
      SELECT * FROM purchase_orders WHERE project_id = $1 ORDER BY created_at ASC
    `, [id]);

    const income = await pool.query(`
      SELECT * FROM project_income WHERE project_id = $1 ORDER BY created_at ASC
    `, [id]);

    const spend = await pool.query(`
      SELECT * FROM project_spend WHERE project_id = $1 ORDER BY created_at ASC
    `, [id]);

    res.json({
      project:  proj.rows[0],
      pos:      pos.rows,
      income:   income.rows,
      spend:    spend.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- Income line items -------------------------------------

router.post('/projects/:id/income', async (req, res) => {
  try {
    const { description, predicted, actual, due_date, status, paid, paid_date } = req.body;
    const { rows } = await pool.query(`
      INSERT INTO project_income (project_id, description, predicted, actual, due_date, status, paid, paid_date, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [req.params.id, description, predicted||0, actual||null, due_date||'', status||'Pending', paid||false, paid_date||'', req.session.userId]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/income/:id', async (req, res) => {
  try {
    const { description, predicted, actual, due_date, status, paid, paid_date } = req.body;
    const { rows } = await pool.query(`
      UPDATE project_income SET description=$1, predicted=$2, actual=$3, due_date=$4, status=$5, paid=$6, paid_date=$7
      WHERE id=$8 RETURNING *
    `, [description, predicted||0, actual||null, due_date||'', status||'Pending', paid||false, paid_date||'', req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/income/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM project_income WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- Spend line items --------------------------------------

router.post('/projects/:id/spend', async (req, res) => {
  try {
    const { category, description, predicted, actual, due_date, paid, paid_date } = req.body;
    const { rows } = await pool.query(`
      INSERT INTO project_spend (project_id, category, description, predicted, actual, due_date, paid, paid_date, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [req.params.id, category||'Other', description||'', predicted||0, actual||null, due_date||'', paid||false, paid_date||'', req.session.userId]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/spend/:id', async (req, res) => {
  try {
    const { category, description, predicted, actual, due_date, paid, paid_date } = req.body;
    const { rows } = await pool.query(`
      UPDATE project_spend SET category=$1, description=$2, predicted=$3, actual=$4, due_date=$5, paid=$6, paid_date=$7
      WHERE id=$8 RETURNING *
    `, [category||'Other', description||'', predicted||0, actual||null, due_date||'', paid||false, paid_date||'', req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/spend/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM project_spend WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- Update PO actual amount -------------------------------

router.put('/pos/:id/actual', async (req, res) => {
  try {
    const { actual_amount } = req.body;
    const { rows } = await pool.query(`
      UPDATE purchase_orders SET actual_amount=$1, updated_at=NOW() WHERE id=$2 RETURNING *
    `, [actual_amount||null, req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
