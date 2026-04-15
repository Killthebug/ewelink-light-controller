const express = require('express');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3456;
const HOST = process.env.HOST || '0.0.0.0';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Config ──────────────────────────────────────────────────
const APP_ID = process.env.EWELINK_APP_ID;
const APP_SECRET = process.env.EWELINK_APP_SECRET;
const EMAIL = process.env.EWELINK_EMAIL;
const PASSWORD = process.env.EWELINK_PASSWORD;
const REDIRECT_URL = process.env.EWELINK_REDIRECT_URL || 'https://127.0.0.1:8888';

// ── Token cache ─────────────────────────────────────────────
let tokenCache = {
  accessToken: null,
  refreshToken: null,
  apikey: null,
  region: null,
  host: null,
  expiresAt: 0,
};

let cachedDevices = null;
let lastFetch = 0;
const CACHE_TTL = 30000;

// ── Helpers ─────────────────────────────────────────────────
function makeSign(key, message) {
  return crypto.createHmac('sha256', key).update(message).digest('base64');
}

function getTs() {
  return Date.now().toString();
}

function getNonce() {
  return Math.random().toString(36).substring(2, 10);
}

function isConfigured() {
  return APP_ID && APP_SECRET && EMAIL && PASSWORD &&
    EMAIL !== 'your_email@example.com';
}

// ── OAuth2 Flow ─────────────────────────────────────────────
// eWeLink locked direct /v2/user/login behind enterprise ($2k/yr) in late 2024.
// This implements the OAuth2 code flow: get code → exchange for token → fetch devices.

async function getAccessCode() {
  const seq = getTs();
  const nonce = getNonce();
  const state = '12345';
  const sign = makeSign(APP_SECRET, `${APP_ID}_${seq}`);

  const payload = {
    authorization: `Sign ${sign}`,
    email: EMAIL,
    password: PASSWORD,
    seq,
    clientId: APP_ID,
    state,
    grantType: 'authorization_code',
    redirectUrl: REDIRECT_URL,
    nonce,
  };

  const headers = {
    'X-CK-Appid': APP_ID,
    'X-CK-Nonce': nonce,
    'X-CK-Seq': seq,
    'Authorization': `Sign ${sign}`,
    'Content-Type': 'application/json; charset=utf-8',
  };

  const res = await fetch('https://apia.coolkit.cn/v2/user/oauth/code', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (data.error !== 0) {
    throw new Error(data.msg || `OAuth code error: ${data.error}`);
  }

  return data.data; // { code, region }
}

async function exchangeToken(code, region) {
  const host = `https://${region}-apia.coolkit.cc`;
  const nonce = getNonce();

  const payload = {
    code,
    redirectUrl: REDIRECT_URL,
    grantType: 'authorization_code',
  };

  const sign = makeSign(APP_SECRET, JSON.stringify(payload));

  const headers = {
    'X-CK-Appid': APP_ID,
    'X-CK-Nonce': nonce,
    'Authorization': `Sign ${sign}`,
    'Content-Type': 'application/json; charset=utf-8',
  };

  const res = await fetch(`${host}/v2/user/oauth/token`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (data.error !== 0) {
    throw new Error(data.msg || `Token exchange error: ${data.error}`);
  }

  return { ...data.data, host, region };
}

async function resolveApikey(accessToken, host) {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'X-CK-Appid': APP_ID,
  };

  const res = await fetch(`${host}/v2/family`, { headers });
  const data = await res.json();

  if (data.data?.familyList?.length) {
    return data.data.familyList[0].apikey;
  }
  return null;
}

async function authenticate() {
  // Return cached token if still valid (with 60s buffer)
  if (tokenCache.accessToken && tokenCache.expiresAt > Date.now() + 60000) {
    return tokenCache;
  }

  console.log('Authenticating via OAuth2...');

  // Step 1: Get authorization code (auto-detects region)
  const codeData = await getAccessCode();
  const { code, region } = codeData;

  // Step 2: Exchange code for access token
  const tokenData = await exchangeToken(code, region);

  // Step 3: Resolve apikey from family list (needed for WebSocket)
  let apikey = tokenData.apikey;
  if (!apikey) {
    apikey = await resolveApikey(tokenData.accessToken, tokenData.host);
  }

  tokenCache = {
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken,
    apikey,
    region,
    host: tokenData.host,
    expiresAt: Date.now() + (tokenData.expireTime || 86400) * 1000,
  };

  console.log(`Authenticated (region: ${region}, expires: ${new Date(tokenCache.expiresAt).toISOString()})`);
  return tokenCache;
}

// ── Device fetching ─────────────────────────────────────────

async function fetchDevicesFromApi() {
  const auth = await authenticate();
  const headers = {
    'Authorization': `Bearer ${auth.accessToken}`,
    'X-CK-Appid': APP_ID,
  };

  const allThings = [];

  // Fetch with and without family apikey to catch all devices
  for (const fk of [auth.apikey, undefined]) {
    let page = 1;
    while (true) {
      let url = `${auth.host}/v2/device/thing?num=100&page=${page}&type=1`;
      if (fk) url += `&familyApikey=${fk}`;

      const res = await fetch(url, { headers });
      const data = await res.json();
      if (data.error !== 0) break;

      const things = data.data?.thingList || [];
      allThings.push(...things);

      if (allThings.length >= (data.data?.total || 0) || things.length < 100) break;
      page++;
    }
  }

  // Deduplicate and return raw device objects
  const seen = new Set();
  return allThings
    .filter(thing => {
      const id = thing.itemData?.deviceid;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(thing => thing.itemData || thing);
}

// ── WebSocket device control ────────────────────────────────

async function getDispatchServer(auth) {
  const url = `https://${auth.region}-dispa.coolkit.cc/dispatch/app`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${auth.accessToken}` },
  });
  const data = await res.json();
  if (data.error !== 0) {
    throw new Error('Failed to get dispatch server');
  }
  return { domain: data.domain, port: data.port };
}

function sendWsCommand(auth, deviceId, params) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('WebSocket command timed out'));
      try { ws.terminate(); } catch (e) { /* noop */ }
    }, 10000);

    let ws;

    getDispatchServer(auth).then(({ domain, port }) => {
      ws = new WebSocket(`wss://${domain}:${port}/api/ws`);

      ws.on('open', () => {
        // Handshake
        ws.send(JSON.stringify({
          action: 'userOnline',
          version: 8,
          ts: Math.floor(Date.now() / 1000),
          at: auth.accessToken,
          userAgent: 'app',
          apikey: auth.apikey,
          appid: APP_ID,
          nonce: getNonce(),
          sequence: getTs(),
        }));
      });

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());

        if (msg.action === 'userOnline' && msg.error === 0) {
          // Handshake OK — send device command
          ws.send(JSON.stringify({
            action: 'update',
            deviceid: deviceId,
            apikey: auth.apikey,
            userAgent: 'app',
            sequence: getTs(),
            params,
          }));
        } else if (msg.action === 'update') {
          clearTimeout(timeout);
          ws.close();
          resolve(msg);
        } else if (msg.action === 'userOnline' && msg.error !== 0) {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(msg.msg || 'WebSocket handshake failed'));
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    }).catch(err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// ── Express Routes ──────────────────────────────────────────

app.get('/api/status', (req, res) => {
  res.json({ connected: isConfigured(), timestamp: new Date().toISOString() });
});

function getErrorHint(err) {
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('appid') || msg.includes('unauthorized'))
    return 'Your APP_ID is unauthorized. Check credentials at dev.ewelink.cc';
  if (msg.includes('wrong') || msg.includes('invalid') || msg.includes('credentials'))
    return 'Wrong email or password. Use your eWeLink app login.';
  if (msg.includes('not activated') || msg.includes('402'))
    return 'Your eWeLink account email is not verified.';
  if (msg.includes('503'))
    return 'eWeLink service unavailable. Try again shortly.';
  if (msg.includes('timeout') || msg.includes('network') || msg.includes('econn'))
    return 'Network error — check your internet connection.';
  return err.message || 'Unknown error';
}

// Debug endpoint
app.get('/api/debug', async (req, res) => {
  if (!isConfigured()) {
    return res.json({
      configured: false,
      issue: 'Missing credentials',
      hint: 'Set EWELINK_APP_ID, EWELINK_APP_SECRET, EWELINK_EMAIL, and EWELINK_PASSWORD in .env',
      steps: [
        '1. Go to https://dev.ewelink.cc and register/log in',
        '2. Create a new app — note the APP_ID and APP_SECRET',
        '3. Add a redirect URL (e.g. https://127.0.0.1:8888) — it will not actually be used',
        '4. Copy all four values to your .env file',
        '5. Restart the server',
      ],
    });
  }

  try {
    const auth = await authenticate();
    const devices = await fetchDevicesFromApi();

    return res.json({
      configured: true,
      authenticated: true,
      region: auth.region,
      host: auth.host,
      tokenExpires: new Date(auth.expiresAt).toISOString(),
      deviceCount: devices.length,
      devices: devices.map(d => ({
        id: d.deviceid,
        name: d.name,
        online: d.online,
        model: d.productModel || d.extra?.model || '',
        brand: d.brandName || d.brandId || '',
      })),
    });
  } catch (err) {
    return res.json({
      configured: true,
      authenticated: false,
      error: err.message,
      hint: getErrorHint(err),
    });
  }
});

// Get all devices
app.get('/api/devices', async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'eWeLink not configured. Set credentials in .env' });
  }
  try {
    if (cachedDevices && (Date.now() - lastFetch) < CACHE_TTL) {
      return res.json(cachedDevices);
    }
    cachedDevices = await fetchDevicesFromApi();
    lastFetch = Date.now();
    res.json(cachedDevices);
  } catch (err) {
    console.error('Failed to fetch devices:', err.message);
    res.status(500).json({ error: err.message, hint: getErrorHint(err) });
  }
});

// Toggle / control device
app.post('/api/devices/:deviceId/toggle', async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'eWeLink not configured' });
  }

  const { deviceId } = req.params;
  const { state, brightness, colorTemp } = req.body;

  try {
    const auth = await authenticate();

    const params = {};
    if (state) params.switch = state;
    if (brightness !== undefined) params.brightness = parseInt(brightness);
    if (colorTemp !== undefined) params.colorTemp = parseInt(colorTemp);

    const result = await sendWsCommand(auth, deviceId, params);
    cachedDevices = null;

    res.json({ success: true, state, result });
  } catch (err) {
    console.error(`Failed to toggle ${deviceId}:`, err.message);
    res.status(500).json({ error: err.message, hint: getErrorHint(err) });
  }
});

// Refresh cache
app.post('/api/refresh', async (req, res) => {
  cachedDevices = null;
  lastFetch = 0;
  tokenCache = { accessToken: null, refreshToken: null, apikey: null, region: null, host: null, expiresAt: 0 };
  res.json({ success: true, message: 'Cache and token cleared' });
});

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`\n  \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557`);
  console.log(`  \u2551   eWeLink Light Controller v2            \u2551`);
  console.log(`  \u2551   Running at http://localhost:${PORT}       \u2551`);
  console.log(`  \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D\n`);

  if (!isConfigured()) {
    console.log('\u26A0  eWeLink credentials not configured');
    console.log('   1. Register at https://dev.ewelink.cc');
    console.log('   2. Create an app to get APP_ID & APP_SECRET');
    console.log('   3. Set them in .env along with your email & password');
  } else {
    console.log(`\u2713 eWeLink configured (APP_ID: ${APP_ID.substring(0, 8)}...)`);
  }

  if (parseFloat(process.versions.node) < 18) {
    console.log('\n\u26A0  Warning: Node.js 18+ required (uses built-in fetch)');
    console.log(`   Current: ${process.versions.node}`);
  }
});
