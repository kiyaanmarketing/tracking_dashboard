require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const sitesRouter = require('./routes/sites');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DASHBOARD_USER = process.env.DASHBOARD_USER;
const DASHBOARD_PASS = process.env.DASHBOARD_PASS;
const CORS_ORIGIN = process.env.CORS_ORIGIN;

// Required env vars — inke bina app start hi nahi karni chahiye
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI env var missing hai — .env file check karo');
  process.exit(1);
}
if (!DASHBOARD_USER || !DASHBOARD_PASS) {
  console.error('❌ DASHBOARD_USER / DASHBOARD_PASS env vars missing hain — dashboard ab auth ke bina expose nahi hoti. .env mein add karo.');
  process.exit(1);
}

// Basic Auth — poori app (UI + API) is layer ke peeche hai
function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function basicAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sepIdx = decoded.indexOf(':');
    const user = sepIdx === -1 ? decoded : decoded.slice(0, sepIdx);
    const pass = sepIdx === -1 ? '' : decoded.slice(sepIdx + 1);
    if (safeEqual(user, DASHBOARD_USER) && safeEqual(pass, DASHBOARD_PASS)) {
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="Tracking Dashboard"');
  res.status(401).send('Authentication required');
}

app.use(basicAuth);

// Middleware
// App same-origin serve hoti hai (frontend + API dono is server se) — cross-origin
// access by default zaroori nahi hai. Sirf tabhi enable karo jab CORS_ORIGIN set ho.
if (CORS_ORIGIN) {
  app.use(cors({ origin: CORS_ORIGIN }));
}
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/api/sites', sitesRouter);

// Frontend ke liye catch-all
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// MongoDB connect
let server;
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB Atlas connected');
    server = app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });

// Graceful shutdown — browser instance aur DB connection saaf band karo
async function shutdown(signal) {
  console.log(`\n${signal} mila, shutting down...`);
  try {
    await sitesRouter.closeBrowser();
  } catch (err) {
    console.error('Browser close error:', err.message);
  }
  if (server) server.close();
  try {
    await mongoose.connection.close();
  } catch (_) {}
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
