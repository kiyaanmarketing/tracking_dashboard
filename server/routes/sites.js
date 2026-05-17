const express = require('express');
const router = express.Router();
const Site = require('../models/Site');
const puppeteer = require('puppeteer');

async function checkScriptInNetwork(pageUrl, scriptName) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  try {
    const page = await browser.newPage();
    let found = false;

    page.on('request', (request) => {
      if (request.url().toLowerCase().includes(scriptName.toLowerCase())) {
        found = true;
      }
    });

    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    return found;
  } finally {
    await browser.close();
  }
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

// GET check if script is live on site (network tab check via headless browser)
router.get('/:host/check', async (req, res) => {
  try {
    const site = await Site.findOne({ host: req.params.host.toLowerCase() });
    if (!site) return res.status(404).json({ success: false, message: 'Site nahi mili' });

    const checkStr = site.checkString || site.script;
    if (!checkStr) {
      return res.json({ success: true, found: null, reason: 'no-script' });
    }

    const checkPath = site.always ? '' : '/cart';
    const pageUrl = `https://${site.host}${checkPath}`;

    const found = await checkScriptInNetwork(pageUrl, checkStr);
    res.json({ success: true, found, checked: checkStr, page: pageUrl });
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
