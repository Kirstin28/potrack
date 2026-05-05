# ============================================================
# POTrack — README
# ============================================================

## What this is

POTrack with a shared PostgreSQL database. Every team member logs in
and sees the same live data. Changes sync instantly.

---

## Deploy to Railway (free tier, ~5 minutes)

### 1. Put the code on GitHub

Create a free account at github.com, then:
- Click "New repository", name it "potrack"
- Upload this folder's contents (or use GitHub Desktop app)

### 2. Deploy on Railway

1. Go to **railway.app** and sign up (free)
2. Click **New Project → Deploy from GitHub repo**
3. Select your potrack repo
4. Railway detects Node.js automatically and deploys it

### 3. Add a PostgreSQL database

1. In your Railway project, click **+ New** → **Database** → **PostgreSQL**
2. Railway automatically sets `DATABASE_URL` in your environment

### 4. Set environment variables

In Railway → your service → **Variables**, add:

| Variable | Value |
|----------|-------|
| `SESSION_SECRET` | Run `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and paste the result |
| `APP_URL` | Your Railway URL, e.g. `https://potrack-production-abc123.up.railway.app` |
| `XERO_CLIENT_ID` | From developer.xero.com (when ready) |
| `XERO_CLIENT_SECRET` | From developer.xero.com (when ready) |
| `NODE_ENV` | `production` |

### 5. Get your URL

Railway gives you a URL like `https://potrack-production.up.railway.app`.
Share that with your team — they just open it in a browser.

---

## First login

Default credentials (from demo seed data):
- **Email:** admin@yourcompany.com
- **Password:** admin123

⚠ Change the password immediately in Settings after first login.

Your team members can register their own accounts from the login screen.

---

## Running locally (for development)

1. Install Node.js from nodejs.org
2. Install PostgreSQL locally, or use a free cloud one
3. Copy `.env.example` to `.env` and fill in `DATABASE_URL` and `SESSION_SECRET`
4. Run:

```bash
npm install
npm start
```

Open http://localhost:3000

---

## Connecting Xero (when ready)

1. Go to developer.xero.com → New App → Web app
2. Set redirect URI to: `https://your-railway-url/auth/xero/callback`
3. Add `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` to Railway environment variables
4. Redeploy (Railway does this automatically when you save variables)
5. Go to the Xero page in POTrack and click Connect

---

## Project structure

```
potrack-server/
├── src/
│   ├── server.js    ← Express app entry point
│   ├── db.js        ← PostgreSQL connection + schema
│   ├── auth.js      ← Login / register / sessions
│   ├── api.js       ← Projects + POs + settings API
│   └── xero.js      ← Xero OAuth + sync
├── public/
│   ├── index.html   ← Frontend UI
│   ├── css/style.css
│   └── js/app.js    ← Frontend logic
├── .env.example     ← Copy to .env
├── package.json
└── README.md
```
