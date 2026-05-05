// ============================================================
// POTrack — Server Entry Point
// ============================================================

require('dotenv').config();

const express      = require('express');
const session      = require('express-session');
const pgSession    = require('connect-pg-simple')(session);
const cookieParser = require('cookie-parser');
const path         = require('path');
const { pool, initDB } = require('./db');
const { router: authRouter, requireAuth } = require('./auth');
const apiRouter    = require('./api');
const xeroRouter   = require('./xero');

const app  = express();
const PORT = process.env.PORT || 3000;

// ---- Middleware ---------------------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(session({
  store: new pgSession({ pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  }
}));

// ---- Routes ------------------------------------------------
app.use('/auth',         authRouter);
app.use('/auth/xero',    xeroRouter);           // OAuth flow (no auth required)
app.use('/api/xero',     requireAuth, xeroRouter);  // API calls (auth required)
app.use('/api',          requireAuth, apiRouter);

// ---- Serve frontend ----------------------------------------
app.use(express.static(path.join(__dirname, '../public')));

// All other routes serve the SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ---- Start -------------------------------------------------
async function start() {
  try {
    await initDB();
    app.listen(PORT, () => {
      console.log(`✓ POTrack running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();
