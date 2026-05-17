const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');
const Site = require('../models/Site');

function fetchHTML(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    let settled = false;
    const settle = (fn, val) => { if (!settled) { settled = true; fn(val); } };

    const opts = {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36' },
      rejectUnauthorized: false
    };

    const req = lib.get(url, opts, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return fetchHTML(next, redirects + 1).then(v => settle(resolve, v)).catch(e => settle(reject, e));
      }
      let html = '';
      res.on('data', chunk => {
        html += chunk;
        if (html.length > 600000) { settle(resolve, html); req.destroy(); }
      });
      res.on('end', () => settle(resolve, html));
      res.on('error', err => settle(reject, err));
    });
    req.setTimeout(15000, () => { settle(reject, new Error('Timeout — site slow hai')); req.destroy(); });
    req.on('error', err => settle(reject, err));
  });
}

// GET all sites
router.get('/', async (req, res) => {
  try {
    const sites = await Site.find().sort({ createdAt: -1 });
    res.json({ success: true, data: sites });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET single site by host
router.get('/:host', async (req, res) => {
  try {
    const site = await Site.findOne({ host: req.params.host.toLowerCase() });
    if (!site) return res.status(404).json({ success: false, message: 'Site nahi mili' });
    res.json({ success: true, data: site });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST create or update site (upsert)
router.post('/', async (req, res) => {
  try {
    const { host, always, cartExtra, script, scriptUrl, api, pixel, checkString } = req.body;

    if (!host) {
      return res.status(400).json({ success: false, message: 'Host required hai' });
    }

    const cleanHost = host.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();

    const site = await Site.findOneAndUpdate(
      { host: cleanHost },
      { host: cleanHost, campaign: cleanHost, always, cartExtra, script, scriptUrl, api, pixel, checkString },
      { upsert: true, new: true, runValidators: true }
    );

    res.json({ success: true, data: site, message: 'Site save ho gayi' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET check if script is live on site
router.get('/:host/check', async (req, res) => {
  try {
    const site = await Site.findOne({ host: req.params.host.toLowerCase() });
    if (!site) return res.status(404).json({ success: false, message: 'Site nahi mili' });

    if (!site.checkString && !site.scriptUrl && !site.script) {
      return res.json({ success: true, found: null, reason: 'no-script' });
    }

    const checkStr = site.checkString || site.scriptUrl || site.script;
    const checkPath = site.always ? '' : '/cart';
    let html;
    try {
      html = await fetchHTML(`https://${site.host}${checkPath}`);
    } catch {
      html = await fetchHTML(`http://${site.host}${checkPath}`);
    }

    const found = html.includes(checkStr);
    res.json({ success: true, found, checked: checkStr });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE site
router.delete('/:host', async (req, res) => {
  try {
    const result = await Site.findOneAndDelete({ host: req.params.host.toLowerCase() });
    if (!result) return res.status(404).json({ success: false, message: 'Site nahi mili' });
    res.json({ success: true, message: 'Site delete ho gayi' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
