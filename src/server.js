require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cookieParser = require('cookie-parser');
const path = require('path');
const { pool, initDB } = require('./db');
const { router: authRouter, requireAuth } = require('./auth');
const apiRouter = require('./api');
const xeroRouter = require('./xero');
const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  store: new pgSession({ pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  name: 'potrack.sid',
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
}));
app.use('/auth', authRouter);
app.use('/auth/xero', xeroRouter);
app.use('/api/xero', requireAuth, xeroRouter);
app.use('/api', requireAuth, apiRouter);
app.use(express.static(path.join(__dirname, '../public')));
app.get('*', (req, res) => { res.sendFile(path.join(__dirname, '../public/index.html')); });
async function start() {
  try {
    await initDB();
    app.listen(PORT, () => { console.log('POTrack running on port ' + PORT); });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}
start();
