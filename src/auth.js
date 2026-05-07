const express  = require('express');
const bcrypt   = require('bcryptjs');
const { pool } = require('./db');
const router   = express.Router();

function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  res.status(401).json({ error: 'Not logged in' });
}

function requireAdmin(req, res, next) {
  if (req.session?.userRole === 'admin') return next();
  res.status(403).json({ error: 'Admin access required' });
}

// GET /auth/me
router.get('/me', (req, res) => {
  if (!req.session?.userId) return res.json({ user: null });
  res.json({ user: { id: req.session.userId, name: req.session.userName, email: req.session.userEmail, role: req.session.userRole } });
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

// POST /auth/register (open - anyone can register as member)
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password, role) VALUES ($1,$2,$3,'member') RETURNING id, name, email, role`,
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
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// PUT /auth/password — change own password
router.put('/password', requireAuth, async (req, res) => {
  try {
    const { current, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
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

// PUT /auth/profile — change own name/email
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
    await pool.query('UPDATE users SET name=$1, email=$2 WHERE id=$3', [name.trim(), email.toLowerCase().trim(), req.session.userId]);
    req.session.userName  = name.trim();
    req.session.userEmail = email.toLowerCase().trim();
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'That email is already in use' });
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /auth/users — admin: list all users
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, email, role, created_at FROM users ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /auth/users — admin: create a user directly (no self-registration needed)
router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const validRoles = ['admin', 'member', 'viewer'];
    const assignedRole = validRoles.includes(role) ? role : 'member';
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role, created_at`,
      [name.trim(), email.toLowerCase().trim(), hash, assignedRole]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'An account with that email already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /auth/users/:id — admin: update role
router.put('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    const validRoles = ['admin', 'member', 'viewer'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (parseInt(req.params.id) === req.session.userId) return res.status(400).json({ error: 'Cannot change your own role' });
    const { rows } = await pool.query(
      'UPDATE users SET role=$1 WHERE id=$2 RETURNING id, name, email, role',
      [role, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /auth/users/:id/password — admin: reset any user's password
router.put('/users/:id/password', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hash = await bcrypt.hash(newPassword, 10);
    const { rows } = await pool.query('UPDATE users SET password=$1 WHERE id=$2 RETURNING id', [hash, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /auth/users/:id — admin: remove user
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.session.userId) return res.status(400).json({ error: 'Cannot delete your own account' });
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = { router, requireAuth, requireAdmin };
