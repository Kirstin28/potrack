const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        email       TEXT UNIQUE NOT NULL,
        password    TEXT NOT NULL,
        role        TEXT DEFAULT 'member',
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS projects (
        id          SERIAL PRIMARY KEY,
        job_num     TEXT NOT NULL,
        name        TEXT NOT NULL,
        client      TEXT DEFAULT '',
        budget      NUMERIC DEFAULT 0,
        income      NUMERIC DEFAULT 0,
        status      TEXT DEFAULT 'Active',
        notes       TEXT DEFAULT '',
        start_date  TEXT DEFAULT '',
        end_date    TEXT DEFAULT '',
        location    TEXT DEFAULT '',
        created_by  INTEGER REFERENCES users(id),
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );

      ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date TEXT DEFAULT '';
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_date   TEXT DEFAULT '';
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS location   TEXT DEFAULT '';

      CREATE TABLE IF NOT EXISTS purchase_orders (
        id              SERIAL PRIMARY KEY,
        num             TEXT NOT NULL UNIQUE,
        supplier        TEXT NOT NULL,
        project_id      INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        description     TEXT DEFAULT '',
        amount          NUMERIC DEFAULT 0,
        actual_amount   NUMERIC DEFAULT NULL,
        invoice_received BOOLEAN DEFAULT FALSE,
        invoice_amount   NUMERIC DEFAULT NULL,
        invoice_date     TEXT DEFAULT '',
        spend_line_id    INTEGER DEFAULT NULL,
        status          TEXT DEFAULT 'Draft',
        due_date        TEXT DEFAULT '',
        xero_id         TEXT DEFAULT '',
        created_by      INTEGER REFERENCES users(id),
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS project_income (
        id          SERIAL PRIMARY KEY,
        project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        predicted   NUMERIC DEFAULT 0,
        actual      NUMERIC DEFAULT NULL,
        due_date    TEXT DEFAULT '',
        status      TEXT DEFAULT 'Pending',
        created_by  INTEGER REFERENCES users(id),
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS project_spend (
        id          SERIAL PRIMARY KEY,
        project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        category    TEXT NOT NULL,
        description TEXT DEFAULT '',
        predicted   NUMERIC DEFAULT 0,
        actual      NUMERIC DEFAULT NULL,
        due_date    TEXT DEFAULT '',
        created_by  INTEGER REFERENCES users(id),
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS xero_tokens (
        id            INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        access_token  TEXT,
        refresh_token TEXT,
        expires_at    BIGINT,
        tenant_id     TEXT,
        tenant_name   TEXT
      );

      CREATE TABLE IF NOT EXISTS session (
        sid     TEXT PRIMARY KEY,
        sess    JSON NOT NULL,
        expire  TIMESTAMPTZ NOT NULL
      );

      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS actual_amount      NUMERIC DEFAULT NULL;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS invoiced_date     TEXT    DEFAULT '';
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS invoiced          BOOLEAN DEFAULT FALSE;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS paid_date         TEXT    DEFAULT '';
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS paid              BOOLEAN DEFAULT FALSE;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS invoice_received  BOOLEAN DEFAULT FALSE;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS invoice_amount    NUMERIC DEFAULT NULL;
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS invoice_date      TEXT    DEFAULT '';
      ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS spend_line_id     INTEGER DEFAULT NULL;

      ALTER TABLE project_income  ADD COLUMN IF NOT EXISTS paid            BOOLEAN DEFAULT FALSE;
      ALTER TABLE project_income  ADD COLUMN IF NOT EXISTS paid_date       TEXT    DEFAULT '';
      ALTER TABLE project_income  ADD COLUMN IF NOT EXISTS invoiced        BOOLEAN DEFAULT FALSE;
      ALTER TABLE project_income  ADD COLUMN IF NOT EXISTS invoiced_date   TEXT    DEFAULT '';

      ALTER TABLE project_spend   ADD COLUMN IF NOT EXISTS paid            BOOLEAN DEFAULT FALSE;
      ALTER TABLE project_spend   ADD COLUMN IF NOT EXISTS paid_date       TEXT    DEFAULT '';
    `);

    const { rows } = await client.query('SELECT COUNT(*) FROM projects');
    if (parseInt(rows[0].count) === 0) await seedDemo(client);

    console.log('Database ready');
  } finally {
    client.release();
  }
}

async function seedDemo(client) {
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('admin123', 10);
  const user = await client.query(
    `INSERT INTO users (name, email, password, role)
     VALUES ('Admin', 'admin@yourcompany.com', $1, 'admin')
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [hash]
  );
  const userId = user.rows[0]?.id || 1;

  const projects = await client.query(`
    INSERT INTO projects (job_num, name, client, budget, income, status, created_by)
    VALUES
      ('012', 'Summer Festival AV',  'Events Co Ltd',  28000, 28000, 'Active',   $1),
      ('008', 'Office Fit-Out Leeds','Nortech Ltd',     15000, 15000, 'Active',   $1),
      ('009', 'Warehouse PA System', 'Logistics UK',    8500,  8500,  'Active',   $1),
      ('005', 'Corporate Conf Q1',   'FinanceGroup',    12000, 12000, 'Complete', $1)
    RETURNING id
  `, [userId]);

  const [p1, p2, p3, p4] = projects.rows.map(r => r.id);

  await client.query(`
    INSERT INTO purchase_orders (num, supplier, project_id, description, amount, status, due_date, created_by)
    VALUES
      ('PO012-001','AudioVision Ltd', $1, 'Main PA system hire',      4200, 'Received', '30/04/26', $5),
      ('PO012-002','CableWorld',      $1, 'Cabling and connectors',   850,  'Paid',     '15/04/26', $5),
      ('PO012-003','SoundHire UK',    $1, 'Monitor wedges and amps',  6150, 'Sent',     '02/05/26', $5),
      ('PO008-001','Lighting Direct', $2, 'Stage lighting rig',       3100, 'Sent',     '05/05/26', $5),
      ('PO008-002','PowerGen Ltd',    $2, 'Generator hire',           2700, 'Received', '28/04/26', $5),
      ('PO009-001','StructurePro',    $3, 'Truss and rigging',        2600, 'Draft',    '10/05/26', $5),
      ('PO005-001','StageRight Ltd',  $4, 'Full production package',  9100, 'Paid',     '01/04/26', $5)
  `, [p1, p2, p3, p4, userId]);

  await client.query(`
    INSERT INTO project_income (project_id, description, predicted, actual, due_date, status, created_by)
    VALUES
      ($1, 'Stage 1 deposit',    14000, 14000, '01/03/26', 'Received', $5),
      ($1, 'Final payment',      14000, NULL,  '30/06/26', 'Pending',  $5),
      ($2, 'Project invoice',    15000, NULL,  '01/06/26', 'Pending',  $5),
      ($4, 'Full project fee',   12000, 12000, '01/03/26', 'Received', $5)
  `, [p1, p2, p4, userId]);

  await client.query(`
    INSERT INTO project_spend (project_id, category, description, predicted, actual, due_date, created_by)
    VALUES
      ($1, 'Equipment', 'PA hire',        5000, 4200, '30/04/26', $5),
      ($1, 'Equipment', 'Cabling',        1000, 850,  '15/04/26', $5),
      ($1, 'Crew',      'Sound engineer', 2000, NULL, '30/06/26', $5),
      ($2, 'Lighting',  'Stage rig',      3500, 3100, '05/05/26', $5),
      ($2, 'Power',     'Generator hire', 3000, 2700, '28/04/26', $5)
  `, [p1, p2, userId]);

  console.log('Demo data seeded');
}

module.exports = { pool, initDB };
