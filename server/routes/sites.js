const express = require('express');
const router = express.Router();
const Site = require('../models/Site');
const puppeteer = require('puppeteer');
const dns = require('dns').promises;
const net = require('net');

const MAX_CONCURRENT_CHECKS = 3;
const MAX_QUEUE_SIZE = 20;
let activeChecks = 0;
const checkQueue = [];

function runNextInQueue() {
  if (activeChecks >= MAX_CONCURRENT_CHECKS || checkQueue.length === 0) return;
  const { resolve, fn } = checkQueue.shift();
  activeChecks++;
  fn().then(result => { resolve(result); }).catch(err => { resolve({ error: err }); }).finally(() => {
    activeChecks--;
    runNextInQueue();
  });
}

function queuedCheck(fn) {
  return new Promise((resolve, reject) => {
    if (checkQueue.length >= MAX_QUEUE_SIZE) {
      return reject(new Error('Check queue busy hai, thodi der baad try karo'));
    }
    checkQueue.push({ resolve, fn });
    runNextInQueue();
  });
}

// ── SSRF guard ────────────────────────────────────────────────────────────
// checkUrl/host user-controlled hain aur seedhe Puppeteer se navigate hote hain.
// Sirf public http(s) hostnames allow karo — private/loopback/link-local IPs
// (internal network, cloud metadata endpoint waghera) block karo.
function isPrivateIP(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80')) return true;
    if (/^fc|^fd/.test(lower)) return true;
    if (lower.startsWith('::ffff:')) {
      const v4 = lower.split(':').pop();
      if (net.isIPv4(v4)) return isPrivateIP(v4);
    }
    return false;
  }
  return true; // pehchana na jaaye to safe side pe block
}

async function isSafeCheckUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.hostname === 'localhost') return false;

  let addresses;
  try {
    addresses = await dns.lookup(parsed.hostname, { all: true });
  } catch {
    return false;
  }
  if (!addresses.length) return false;
  return addresses.every(a => !isPrivateIP(a.address));
}

let _browser = null;

async function getBrowser() {
  if (_browser && _browser.connected) return _browser;
  _browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
           '--blink-settings=imagesEnabled=false', '--disable-extensions', '--disable-sync']
  });
  _browser.on('disconnected', () => { _browser = null; });
  return _browser;
}

// Puppeteer ka default UA mein "HeadlessChrome" hota hai — kaafi WAFs/CDNs
// (jaise Fastly) isse detect karke block/redirect kar dete hain. Real desktop
// Chrome UA se navigate karna un false blocks ko avoid karta hai.
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

async function checkScriptInNetwork(pageUrl, scriptName) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(DESKTOP_UA);
  let found = false;
  let navError = null;
  const needle = scriptName.toLowerCase();
  const tagErrors = [];

  let earlyResolve;
  const earlyExit = new Promise(r => { earlyResolve = r; });

  page.on('request', request => {
    if (request.url().toLowerCase().includes(needle)) {
      found = true;
      earlyResolve();
    }
  });

  // Tag ka apna script jab console.error ya uncaught exception de, sirf wahi
  // pakdo (location/stack mein scriptName match karke) — poore page ki har
  // error nahi, warna kisi aur third-party script ka noise bhi "tag error"
  // dikhne lagega.
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const loc = msg.location() || {};
    if ((loc.url || '').toLowerCase().includes(needle)) {
      tagErrors.push(msg.text());
    }
  });
  page.on('pageerror', err => {
    const stack = (err.stack || err.message || '').toLowerCase();
    if (stack.includes(needle)) {
      tagErrors.push(err.message);
    }
  });

  try {
    await Promise.race([
      page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 }).catch(err => { navError = err; }),
      earlyExit
    ]);
    // Agar script pehle hi request mein mil chuki hai to nav error ignore karo
    // (page baad mein slow/timeout ho sakta hai, par jo dhoondhna tha wo mil gaya).
    // Warna nav error ko "not found" mat treat karo — page hi load nahi hui to
    // pata nahi chalta script hai ya nahi, isliye error surface karna zaroori hai.
    if (!found && navError) throw navError;
    // Early exit ke case mein script abhi-abhi request hui hai, execute/error
    // hone ka mauka nahi mila — thoda ruk ke dekho.
    if (found) await new Promise(r => setTimeout(r, 800));
    return { found, tagErrors: tagErrors.slice(0, 5) };
  } finally {
    await page.close();
  }
}

const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,}$/i;

function serverError(res, label, err) {
  console.error(label, err);
  res.status(500).json({ success: false, message: 'Kuch galat ho gaya, server logs check karo' });
}

// GET all sites
router.get('/', async (req, res) => {
  try {
    const sites = await Site.find().sort({ createdAt: -1 });
    res.json({ success: true, data: sites });
  } catch (err) {
    serverError(res, 'GET /api/sites failed:', err);
  }
});

// GET single site by host
router.get('/:host', async (req, res) => {
  try {
    const site = await Site.findOne({ host: req.params.host.toLowerCase() });
    if (!site) return res.status(404).json({ success: false, message: 'Site nahi mili' });
    res.json({ success: true, data: site });
  } catch (err) {
    serverError(res, 'GET /api/sites/:host failed:', err);
  }
});

// POST create or update site (upsert)
router.post('/', async (req, res) => {
  try {
    const { host, always, cartExtra, script, scriptUrl, api, pixel, checkString, checkUrl } = req.body;

    if (!host) {
      return res.status(400).json({ success: false, message: 'Host required hai' });
    }

    const cleanHost = String(host).replace(/^https?:\/\//, '').split('/')[0].toLowerCase();

    if (!HOSTNAME_RE.test(cleanHost)) {
      return res.status(400).json({ success: false, message: 'Host invalid hai — valid domain daalo (e.g. www.example.com)' });
    }

    for (const [label, val] of [['Script URL', scriptUrl], ['Check URL', checkUrl], ['API Endpoint', api], ['Pixel URL', pixel]]) {
      if (val) {
        try {
          const u = new URL(val);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
        } catch {
          return res.status(400).json({ success: false, message: `${label} invalid hai — http(s):// se start honi chahiye` });
        }
      }
    }

    const site = await Site.findOneAndUpdate(
      { host: cleanHost },
      {
        $set: { always, cartExtra, script, scriptUrl, api, pixel, checkString, checkUrl },
        $setOnInsert: { host: cleanHost, campaign: cleanHost }
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.json({ success: true, data: site, message: 'Site save ho gayi' });
  } catch (err) {
    serverError(res, 'POST /api/sites failed:', err);
  }
});

// GET check if script is live on site (network tab check via headless browser)
router.get('/:host/check', async (req, res) => {
  try {
    const site = await Site.findOne({ host: req.params.host.toLowerCase() });
    if (!site) return res.status(404).json({ success: false, message: 'Site nahi mili' });

    const checkStr = site.checkString || site.script;
    if (!checkStr) {
      return res.json({ success: true, found: null, reason: 'no-script' });
    }

    const pageUrl = site.checkUrl || (site.always ? `https://${site.host}` : `https://${site.host}/cart`);

    if (!(await isSafeCheckUrl(pageUrl))) {
      return res.status(400).json({ success: false, message: 'Check URL allowed nahi hai (internal/private address block hai)' });
    }

    let result;
    try {
      result = await queuedCheck(() => checkScriptInNetwork(pageUrl, checkStr));
    } catch (queueErr) {
      return res.status(503).json({ success: false, message: queueErr.message });
    }
    if (result && result.error) {
      const navErr = result.error;
      const isTimeout = navErr.name === 'TimeoutError' || /timeout/i.test(navErr.message || '');
      const msg = isTimeout
        ? 'Page load nahi hui (30s timeout) — site slow hai ya bot-protection block kar rahi hai. Manually browser mein check karo.'
        : 'Page load nahi ho payi — URL/site down ho sakti hai.';
      console.error('GET /api/sites/:host/check nav failed:', navErr);
      return res.status(502).json({ success: false, message: msg });
    }
    res.json({
      success: true,
      found: result.found,
      hasErrors: result.tagErrors.length > 0,
      errors: result.tagErrors,
      checked: checkStr,
      page: pageUrl
    });
  } catch (err) {
    serverError(res, 'GET /api/sites/:host/check failed:', err);
  }
});

// DELETE site
router.delete('/:host', async (req, res) => {
  try {
    const result = await Site.findOneAndDelete({ host: req.params.host.toLowerCase() });
    if (!result) return res.status(404).json({ success: false, message: 'Site nahi mili' });
    res.json({ success: true, message: 'Site delete ho gayi' });
  } catch (err) {
    serverError(res, 'DELETE /api/sites/:host failed:', err);
  }
});

router.closeBrowser = async function closeBrowser() {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
};

module.exports = router;
