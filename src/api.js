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
        -- Due out: POs with no spend line that aren't paid
        COALESCE(SUM(CASE WHEN po.status != 'Paid' AND po.spend_line_id IS NULL THEN po.amount ELSE 0 END), 0) AS due_out,
        -- Paid out: POs marked as paid + spend lines marked as paid
        COALESCE((
          SELECT SUM(CASE WHEN ps.paid = true THEN COALESCE(ps.actual, ps.predicted, 0) ELSE 0 END)
          FROM project_spend ps WHERE ps.project_id = p.id
        ), 0) AS paid_out,
        -- Awaiting invoice: POs that have NOT yet received an invoice
        COALESCE(SUM(CASE WHEN po.invoice_received = false OR po.invoice_received IS NULL THEN po.amount ELSE 0 END), 0) AS awaiting_invoice,
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

router.get('/pos/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT po.*, p.name AS project_name, p.job_num, u.name AS created_by_name
      FROM purchase_orders po
      LEFT JOIN projects p ON po.project_id = p.id
      LEFT JOIN users u ON po.created_by = u.id
      WHERE po.id = $1
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
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

    // If marked as paid, also update the linked spend line
    if (paid) {
      const poRow = await pool.query('SELECT spend_line_id FROM purchase_orders WHERE id=$1', [req.params.id]);
      const spendLineId = poRow.rows[0]?.spend_line_id;
      if (spendLineId) {
        await pool.query(
          'UPDATE project_spend SET paid=true, paid_date=$1 WHERE id=$2',
          [paid_date||'', spendLineId]
        );
      }
    }

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
    const { description, predicted, actual, due_date, status, paid, paid_date, invoiced, invoiced_date, vat_rate, vat_amount } = req.body;
    const { rows } = await pool.query(`
      INSERT INTO project_income (project_id, description, predicted, actual, due_date, status, paid, paid_date, invoiced, invoiced_date, vat_rate, vat_amount, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *
    `, [req.params.id, description, predicted||0, actual||null, due_date||'', status||'Pending', paid||false, paid_date||'', invoiced||false, invoiced_date||'', vat_rate||0, vat_amount||null, req.session.userId]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/income/:id', async (req, res) => {
  try {
    const { description, predicted, actual, due_date, status, paid, paid_date, invoiced, invoiced_date, vat_rate, vat_amount } = req.body;
    const { rows } = await pool.query(`
      UPDATE project_income SET description=$1, predicted=$2, actual=$3, due_date=$4, status=$5,
        paid=$6, paid_date=$7, invoiced=$8, invoiced_date=$9, vat_rate=$10, vat_amount=$11
      WHERE id=$12 RETURNING *
    `, [description, predicted||0, actual||null, due_date||'', status||'Pending', paid||false, paid_date||'', invoiced||false, invoiced_date||'', vat_rate||0, vat_amount||null, req.params.id]);
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
    const { category, description, predicted, actual, due_date, paid, paid_date, vat_rate, vat_amount, vat_reclaimable } = req.body;
    const { rows } = await pool.query(`
      INSERT INTO project_spend (project_id, category, description, predicted, actual, due_date, paid, paid_date, vat_rate, vat_amount, vat_reclaimable, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
    `, [req.params.id, category||'Other', description||'', predicted||0, actual||null, due_date||'', paid||false, paid_date||'', vat_rate||0, vat_amount||null, vat_reclaimable!==false, req.session.userId]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/spend/:id', async (req, res) => {
  try {
    const { category, description, predicted, actual, due_date, paid, paid_date, vat_rate, vat_amount, vat_reclaimable } = req.body;
    const { rows } = await pool.query(`
      UPDATE project_spend SET category=$1, description=$2, predicted=$3, actual=$4, due_date=$5, paid=$6, paid_date=$7, vat_rate=$8, vat_amount=$9, vat_reclaimable=$10
      WHERE id=$11 RETURNING *
    `, [category||'Other', description||'', predicted||0, actual||null, due_date||'', paid||false, paid_date||'', vat_rate||0, vat_amount||null, vat_reclaimable!==false, req.params.id]);
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

// ---- Mark PO invoice received + auto-create spend line ----

router.post('/pos/:id/invoice', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { invoice_received, invoice_amount, invoice_date, invoice_due_date } = req.body;
    const poId = req.params.id;

    const poRes = await client.query('SELECT * FROM purchase_orders WHERE id=$1', [poId]);
    if (!poRes.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'PO not found' });
    }
    const po = poRes.rows[0];

    if (!invoice_received) {
      // Un-marking — remove auto-created spend line
      if (po.spend_line_id) {
        await client.query(
          "DELETE FROM project_spend WHERE id=$1 AND description LIKE 'PO:%'",
          [po.spend_line_id]
        );
      }
      await client.query(
        'UPDATE purchase_orders SET invoice_received=false, invoice_amount=NULL, invoice_date=$1, invoice_due_date=$2, spend_line_id=NULL WHERE id=$3',
        [invoice_date||'', invoice_due_date||'', poId]
      );
      await client.query('COMMIT');
      const updated = await pool.query(
        `SELECT po.*, p.name as project_name, p.job_num FROM purchase_orders po LEFT JOIN projects p ON po.project_id=p.id WHERE po.id=$1`,
        [poId]
      );
      return res.json(updated.rows[0]);
    }

    const amount = parseFloat(invoice_amount) || 0;
    let spendLineId = po.spend_line_id;

    if (po.project_id) {
      if (spendLineId) {
        // Update existing spend line
        await client.query(
          'UPDATE project_spend SET actual=$1, due_date=$2, description=$3 WHERE id=$4',
          [amount, invoice_due_date||invoice_date||'', `PO: ${po.num} — ${po.supplier}`, spendLineId]
        );
      } else {
        // Create new spend line
        const slRes = await client.query(`
          INSERT INTO project_spend (project_id, category, description, predicted, actual, due_date, paid, paid_date, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
        `, [
          po.project_id,
          'Equipment',
          `PO: ${po.num} — ${po.supplier}`,
          Number(po.amount),
          amount,
          invoice_due_date||invoice_date||'',
          false,
          '',
          req.session.userId
        ]);
        spendLineId = slRes.rows[0].id;
      }
    }

    await client.query(
      'UPDATE purchase_orders SET invoice_received=true, invoice_amount=$1, invoice_date=$2, invoice_due_date=$3, spend_line_id=$4, status=$5 WHERE id=$6',
      [amount, invoice_date||'', invoice_due_date||'', spendLineId, 'Received', poId]
    );

    await client.query('COMMIT');

    const updated = await pool.query(
      `SELECT po.*, p.name as project_name, p.job_num FROM purchase_orders po LEFT JOIN projects p ON po.project_id=p.id WHERE po.id=$1`,
      [poId]
    );
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Invoice route error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
