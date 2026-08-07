const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Site = require('../models/Site');

// click_logs (aimedia_backend) and tracking_data (aianlyticstrack) are collections
// owned by other services on the same shared MongoDB — read directly, no Mongoose
// model needed since we don't write to them from here.
function rawDb() {
  return mongoose.connection.db;
}

function mergeCounts(...groups) {
  const map = new Map();
  for (const group of groups) {
    for (const { _id, count } of group) {
      const key = _id || 'Unknown';
      map.set(key, (map.get(key) || 0) + count);
    }
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

router.get('/overview', async (req, res) => {
  try {
    const db = rawDb();
    const site = req.query.site || null;

    const clickLogs = db.collection('click_logs');
    const trackingData = db.collection('tracking_data');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const clFilter = site ? { origin: site } : {};
    const tdFilter = site ? { origin: site } : {};
    const clTodayFilter = { ...clFilter, timestamp: { $gte: today } };
    // tracking_data.timestamp is stored as an ISO string, not a Date — $toDate
    // makes the comparison work regardless of how it was actually stored.
    const tdTodayFilter = {
      ...tdFilter,
      $expr: { $gte: [{ $toDate: '$timestamp' }, today] },
    };

    const [
      clTotal, clToday, clBySite, clByCountry, clRecentRaw, clOrigins,
      tdTotal, tdToday, tdBySite, tdByCountry, tdRecentRaw, tdOrigins,
      allConfiguredSites,
    ] = await Promise.all([
      clickLogs.countDocuments(clFilter).catch(() => 0),
      clickLogs.countDocuments(clTodayFilter).catch(() => 0),
      clickLogs.aggregate([{ $match: clFilter }, { $group: { _id: '$origin', count: { $sum: 1 } } }]).toArray().catch(() => []),
      clickLogs.aggregate([{ $match: clFilter }, { $group: { _id: '$country', count: { $sum: 1 } } }]).toArray().catch(() => []),
      clickLogs.find(clFilter).sort({ timestamp: -1 }).limit(30).toArray().catch(() => []),
      clickLogs.distinct('origin').catch(() => []),

      trackingData.countDocuments(tdFilter).catch(() => 0),
      trackingData.countDocuments(tdTodayFilter).catch(() => 0),
      trackingData.aggregate([{ $match: tdFilter }, { $group: { _id: '$origin', count: { $sum: 1 } } }]).toArray().catch(() => []),
      trackingData.aggregate([{ $match: tdFilter }, { $group: { _id: '$country', count: { $sum: 1 } } }]).toArray().catch(() => []),
      trackingData.find(tdFilter).sort({ timestamp: -1 }).limit(30).toArray().catch(() => []),
      trackingData.distinct('origin').catch(() => []),

      Site.find({}, 'host campaign').lean(),
    ]);

    const clRecent = clRecentRaw.map(d => ({
      source: 'aimedia_backend',
      origin: d.origin,
      url: d.url,
      country: d.country || '',
      timestamp: d.timestamp,
    }));
    const tdRecent = tdRecentRaw.map(d => ({
      source: 'aianlyticstrack',
      origin: d.origin,
      url: d.url,
      country: d.country || '',
      timestamp: new Date(d.timestamp),
    }));

    const recent = [...clRecent, ...tdRecent]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 40);

    const bySite = mergeCounts(clBySite, tdBySite);
    const byCountry = mergeCounts(clByCountry, tdByCountry).filter(c => c.name && c.name !== 'Unknown');

    const trackedOrigins = new Set([...clOrigins, ...tdOrigins].filter(Boolean));

    // Cross-reference with the configured site registry so domains with
    // zero real clicks still show up, flagged as untracked.
    const untrackedSites = allConfiguredSites
      .map(s => s.host)
      .filter(host => ![...trackedOrigins].some(o => o.toLowerCase().replace(/^www\./, '') === host.toLowerCase().replace(/^www\./, '')));

    res.json({
      success: true,
      totalClicks: clTotal + tdTotal,
      todayClicks: clToday + tdToday,
      bySite,
      byCountry,
      recent,
      allSites: [...trackedOrigins].sort(),
      untrackedSites: [...new Set(untrackedSites)].sort(),
      activeSite: site,
      sources: {
        click_logs: { total: clTotal, origins: clOrigins.length },
        tracking_data: { total: tdTotal, origins: tdOrigins.length },
      },
    });
  } catch (error) {
    console.error('Analytics overview error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
