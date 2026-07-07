const express = require('express');
const router = express.Router();
const Site = require('../models/Site');
const puppeteer = require('puppeteer');

const MAX_CONCURRENT_CHECKS = 3;
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
  return new Promise(resolve => {
    checkQueue.push({ resolve, fn });
    runNextInQueue();
  });
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

async function checkScriptInNetwork(pageUrl, scriptName) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  let found = false;

  let earlyResolve;
  const earlyExit = new Promise(r => { earlyResolve = r; });

  page.on('request', request => {
    if (request.url().toLowerCase().includes(scriptName.toLowerCase())) {
      found = true;
      earlyResolve();
    }
  });

  try {
    await Promise.race([
      page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
      earlyExit
    ]);
    return found;
  } finally {
    await page.close();
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
    const { host, always, cartExtra, script, scriptUrl, api, pixel, checkString, checkUrl } = req.body;

    if (!host) {
      return res.status(400).json({ success: false, message: 'Host required hai' });
    }

    const cleanHost = host.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();

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

    const pageUrl = site.checkUrl || (site.always ? `https://${site.host}` : `https://${site.host}/cart`);

    const result = await queuedCheck(() => checkScriptInNetwork(pageUrl, checkStr));
    if (result && result.error) throw result.error;
    res.json({ success: true, found: result, checked: checkStr, page: pageUrl });
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
