const express = require('express');
const path = require('path');
const eWeLink = require('ewelink-api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3456;
const HOST = process.env.HOST || '0.0.0.0';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── eWeLink Connection ──────────────────────────────────────────────
let connection = null;
let cachedDevices = null;
let lastFetch = 0;
const CACHE_TTL = 30000; // 30s device cache

function getConnection() {
  if (!connection) {
    const email = process.env.EWELINK_EMAIL;
    const password = process.env.EWELINK_PASSWORD;
    if (!email || !password || email === 'your_email@example.com') {
      return null;
    }
    connection = new eWeLink({
      email,
      password,
      region: 'us',
    });
  }
  return connection;
}

// ── API Routes ──────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  res.json({
    connected: !!getConnection(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/devices', async (req, res) => {
  const conn = getConnection();
  if (!conn) {
    return res.status(503).json({ error: 'eWeLink not configured. Set EWELINK_EMAIL and EWELINK_PASSWORD in .env' });
  }
  try {
    if (cachedDevices && (Date.now() - lastFetch) < CACHE_TTL) {
      return res.json(cachedDevices);
    }
    const devices = await conn.getDevices();
    cachedDevices = devices;
    lastFetch = Date.now();
    res.json(devices);
  } catch (err) {
    console.error('Failed to fetch devices:', err.message);
    if (err.message?.includes('auth') || err.message?.includes('login')) {
      connection = null;
    }
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/devices/:deviceId/toggle', async (req, res) => {
  const conn = getConnection();
  if (!conn) {
    return res.status(503).json({ error: 'eWeLink not configured' });
  }
  const { deviceId } = req.params;
  const { state, brightness, colorTemp } = req.body;
  try {
    let result;
    if (brightness !== undefined || colorTemp !== undefined) {
      const params = {};
      if (brightness !== undefined) params.brightness = brightness;
      if (colorTemp !== undefined) params.colorTemp = colorTemp;
      params.switch = state || 'on';
      result = await conn.setDevicePowerState(deviceId, state || 'on');
      if (brightness !== undefined || colorTemp !== undefined) {
        try {
          const status = await conn.getDevicePowerState(deviceId);
          result = { ...result, status };
        } catch (e) { /* ignore */ }
      }
    } else {
      result = await conn.setDevicePowerState(deviceId, state || 'toggle');
    }
    cachedDevices = null;
    res.json({ success: true, state, result });
  } catch (err) {
    console.error(`Failed to toggle device ${deviceId}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/devices/:deviceId/status', async (req, res) => {
  const conn = getConnection();
  if (!conn) {
    return res.status(503).json({ error: 'eWeLink not configured' });
  }
  const { deviceId } = req.params;
  try {
    const status = await conn.getDevicePowerState(deviceId);
    res.json({ deviceId, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/devices/:deviceId', async (req, res) => {
  const conn = getConnection();
  if (!conn) {
    return res.status(503).json({ error: 'eWeLink not configured' });
  }
  const { deviceId } = req.params;
  try {
    const device = await conn.getDevice(deviceId);
    res.json(device);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/refresh', async (req, res) => {
  cachedDevices = null;
  lastFetch = 0;
  res.json({ success: true, message: 'Device cache cleared' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║   eWeLink Light Controller              ║`);
  console.log(`  ║   Running at http://localhost:${PORT}       ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
  const conn = getConnection();
  if (!conn) {
    console.log('⚠  No eWeLink credentials found in .env');
    console.log('   Copy .env.example to .env and add your credentials');
  } else {
    console.log('✓ eWeLink connection configured');
  }
});
