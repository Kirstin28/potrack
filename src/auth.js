// ============================================================
// POTrack — Auth Routes
// ============================================================

const express  = require('express');
const bcrypt   = require('bcryptjs');
const { pool } = require('./db');
const router   = express.Router();

// Middleware — require login for API routes
function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  res.status(401).json({ error: 'Not logged in' });
}

// GET /auth/me
router.get('/me', (req, res) => {
  if (!req.session?.userId) return res.json({ user: null });
  res.json({
    user: {
      id:    req.session.userId,
      name:  req.session.userName,
      email: req.session.userEmail,
      role:  req.session.userRole,
    }
  });
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.session.userId    = user.id;
    req.session.userName  = user.name;
    req.session.userEmail = user.email;
    req.session.userRole  = user.role;

    res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password, role)
       VALUES ($1, $2, $3, 'member') RETURNING id, name, email, role`,
      [name.trim(), email.toLowerCase().trim(), hash]
    );

    const user = rows[0];
    req.session.userId    = user.id;
    req.session.userName  = user.name;
    req.session.userEmail = user.email;
    req.session.userRole  = user.role;

    res.json({ ok: true, user });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'An account with that email already exists' });
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// PUT /auth/password
router.put('/password', requireAuth, async (req, res) => {
  try {
    const { current, newPassword } = req.body;
    const { rows } = await pool.query('SELECT password FROM users WHERE id = $1', [req.session.userId]);
    if (!rows[0] || !(await bcrypt.compare(current, rows[0].password))) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hash, req.session.userId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = { router, requireAuth };
