// ═══════════════════════════════════════════════════════════════
// eWeLink Light Controller — Client Application
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── State ───────────────────────────────────────────────────
  let devices = [];
  let currentFilter = 'all';
  let searchQuery = '';
  let refreshInterval = null;

  // ── DOM References ──────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    connectionStatus: $('#connectionStatus'),
    refreshBtn: $('#refreshBtn'),
    themeToggle: $('#themeToggle'),
    searchInput: $('#searchInput'),
    deviceGrid: $('#deviceGrid'),
    totalDevices: $('#totalDevices'),
    onlineDevices: $('#onlineDevices'),
    onDevices: $('#onDevices'),
    noResults: $('#noResults'),
    modalOverlay: $('#modalOverlay'),
    modalClose: $('#modalClose'),
    modalDeviceName: $('#modalDeviceName'),
    modalDeviceId: $('#modalDeviceId'),
    modalBody: $('#modalBody'),
    toastContainer: $('#toastContainer'),
  };

  // ── Theme ───────────────────────────────────────────────────
  function initTheme() {
    const saved = localStorage.getItem('ewelink-theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }

  function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('ewelink-theme', isDark ? 'light' : 'dark');
  }

  // ── API ─────────────────────────────────────────────────────
  async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // ── Toast Notifications ────────────────────────────────────
  function toast(message, type = '') {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    els.toastContainer.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  // ── View Management ─────────────────────────────────────────
  function showView(id) {
    $$('.state-view').forEach((v) => (v.style.display = 'none'));
    const view = $(`#${id}`);
    if (view) view.style.display = '';
  }

  // ── Device Icon SVGs ───────────────────────────────────────
  function getDeviceIcon(device) {
    const brand = (device.brandName || '').toLowerCase();
    const model = (device.productModel || '').toLowerCase();
    const name = (device.name || '').toLowerCase();
    const params = device.params || {};
    const uiid = device.extra?.uiid || 0;

    if (params.brightness !== undefined || params.lightType || name.includes('bulb') || name.includes('light') || name.includes('lamp')) {
      if (name.includes('rgb') || name.includes('color') || (params.colorR !== undefined)) {
        return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg>`;
      }
      return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2v1"/><path d="M12 7a5 5 0 0 1 5 5c0 .76-.17 1.48-.47 2.12"/><path d="M12 7a5 5 0 0 0-5 5c0 .76.17 1.48.47 2.12"/></svg>`;
    }

    if (name.includes('switch') || name.includes('plug') || name.includes('outlet') || name.includes('socket') || brand.includes('sonoff')) {
      return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 1v3"/><path d="M15 1v3"/><path d="M9 20v3"/><path d="M15 20v3"/><path d="M1 9h3"/><path d="M1 15h3"/><path d="M20 9h3"/><path d="M20 15h3"/></svg>`;
    }

    if (name.includes('fan')) {
      return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 12c-1.5-4-5-6-5-6s3.5 2 5 6z"/><path d="M12 12c1.5-4 5-6 5-6s-3.5 2-5 6z"/><path d="M12 12c4-1.5 6-5 6-5s-2 3.5-6 5z"/><path d="M12 12c4 1.5 6 5 6 5s-2-3.5-6-5z"/><path d="M12 12c-4 1.5-6 5-6 5s2-3.5 6-5z"/><path d="M12 12c-4-1.5-6-5-6-5s2 3.5 6 5z"/><circle cx="12" cy="12" r="2"/></svg>`;
    }

    return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v3"/><path d="M12 12h.01"/></svg>`;
  }

  // ── Parse Device State ──────────────────────────────────────
  function getDeviceState(device) {
    const params = device.params || {};
    const online = device.online || false;
    const switchState = params.switch || params.switch_0 || params.state || params.power;
    const isOn = switchState === 'on' || switchState === 1 || switchState === true;
    const brightness = params.brightness !== undefined
      ? Math.round((parseInt(params.brightness) / 100) * 100)
      : null;
    const colorTemp = params.colorTemp || null;
    return { online, isOn, brightness, colorTemp, switchState };
  }

  // ── Render Device Card ──────────────────────────────────────
  function renderDeviceCard(device) {
    const state = getDeviceState(device);
    const statusClass = state.online ? (state.isOn ? 'is-on' : '') : 'is-offline';
    const statusText = !state.online ? 'Offline' : state.isOn ? 'On' : 'Off';
    const statusDotClass = !state.online ? 'offline' : state.isOn ? 'on' : '';
    const model = device.productModel || device.model || 'Unknown';
    const hasBrightness = state.brightness !== null;
    const brightnessPercent = hasBrightness ? state.brightness : 0;

    const card = document.createElement('div');
    card.className = `device-card ${statusClass}`;
    card.dataset.deviceId = device.deviceid;
    card.dataset.on = state.isOn ? '1' : '0';
    card.dataset.offline = state.online ? '0' : '1';

    card.innerHTML = `
      <div class="device-card-header">
        <div class="device-name">${escapeHtml(device.name || 'Unnamed Device')}</div>
        <label class="toggle" onclick="event.stopPropagation()">
          <input type="checkbox" ${state.isOn ? 'checked' : ''} ${!state.online ? 'disabled' : ''} data-toggle="${device.deviceid}">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="device-info">
        <div class="device-meta">
          <div class="device-model">${escapeHtml(model)}</div>
          <div class="device-status">
            <span class="status-dot ${statusDotClass}"></span>
            ${statusText}${hasBrightness && state.isOn ? ` · ${brightnessPercent}%` : ''}
          </div>
        </div>
        <div class="device-icon">${getDeviceIcon(device)}</div>
      </div>
      ${hasBrightness ? `
      <div class="device-brightness" onclick="event.stopPropagation()">
        <div class="brightness-label">
          <span>Brightness</span>
          <span class="brightness-value">${brightnessPercent}%</span>
        </div>
        <input type="range" class="brightness-slider" min="1" max="100" value="${brightnessPercent}" ${!state.online || !state.isOn ? 'disabled' : ''} data-brightness="${device.deviceid}">
      </div>
      ` : ''}
    `;

    const toggle = card.querySelector(`[data-toggle="${device.deviceid}"]`);
    toggle.addEventListener('change', async () => {
      const newState = toggle.checked ? 'on' : 'off';
      try {
        toggle.disabled = true;
        await api(`/devices/${device.deviceid}/toggle`, {
          method: 'POST',
          body: JSON.stringify({ state: newState }),
        });
        toast(`${device.name} turned ${newState}`, 'success');
        await fetchDevices();
      } catch (err) {
        toast(`Failed: ${err.message}`, 'error');
        toggle.checked = !toggle.checked;
        toggle.disabled = !state.online;
      }
    });

    if (hasBrightness) {
      const slider = card.querySelector(`[data-brightness="${device.deviceid}"]`);
      let debounce;
      slider.addEventListener('input', (e) => {
        const val = e.target.value;
        card.querySelector('.brightness-value').textContent = val + '%';
        clearTimeout(debounce);
        debounce = setTimeout(async () => {
          try {
            await api(`/devices/${device.deviceid}/toggle`, {
              method: 'POST',
              body: JSON.stringify({ state: 'on', brightness: parseInt(val) }),
            });
          } catch (err) {
            toast(`Brightness error: ${err.message}`, 'error');
          }
        }, 300);
      });
    }

    card.addEventListener('click', () => openModal(device));
    return card;
  }

  // ── Render Device Grid ──────────────────────────────────────
  function renderDevices() {
    const grid = els.deviceGrid;
    grid.innerHTML = '';
    let filtered = [...devices];

    if (currentFilter === 'on') filtered = filtered.filter((d) => getDeviceState(d).isOn);
    else if (currentFilter === 'off') filtered = filtered.filter((d) => getDeviceState(d).online && !getDeviceState(d).isOn);
    else if (currentFilter === 'offline') filtered = filtered.filter((d) => !getDeviceState(d).online);

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (d) =>
          (d.name || '').toLowerCase().includes(q) ||
          (d.productModel || '').toLowerCase().includes(q) ||
          (d.deviceid || '').toLowerCase().includes(q) ||
          (d.brandName || '').toLowerCase().includes(q)
      );
    }

    els.noResults.style.display = filtered.length === 0 ? '' : 'none';
    filtered.forEach((device) => { grid.appendChild(renderDeviceCard(device)); });

    const total = devices.length;
    const online = devices.filter((d) => d.online).length;
    const on = devices.filter((d) => getDeviceState(d).isOn).length;
    els.totalDevices.textContent = total;
    els.onlineDevices.textContent = online;
    els.onDevices.textContent = on;
  }

  // ── Fetch Devices ───────────────────────────────────────────
  async function fetchDevices() {
    try {
      const data = await api('/devices');
      devices = Array.isArray(data) ? data : [];
      showView('devices');
      renderDevices();
    } catch (err) {
      if (err.message.includes('not configured')) {
        showView('unconfigured');
      } else {
        $('#errorMessage').textContent = err.message;
        if (err.hint) {
          $('#errorMessage').textContent += '\n\n💡 ' + err.hint;
        }
        showView('error');
      }
    }
  }

  // ── Debug / Diagnostics ─────────────────────────────────────
  async function runDebug() {
    const debugBtn = $('#debugBtn');
    const debugInfo = $('#debugInfo');
    if (!debugBtn || !debugInfo) return;

    debugBtn.textContent = 'Running diagnostics...';
    debugBtn.disabled = true;

    try {
      const info = await api('/debug');
      debugInfo.style.display = 'block';

      let html = '';
      if (!info.configured) {
        html = `<strong style="color:var(--brick)">⚠ Not configured</strong><br>${info.hint}`;
      } else if (!info.authenticated) {
        html = `<strong style="color:var(--brick)">⚠ Authentication failed</strong><br>`;
        html += `Error ${info.error}: ${info.msg}<br><br>`;
        html += `<strong>💡 Fix:</strong> ${info.hint}<br><br>`;
        html += `<span style="opacity:0.7">Common causes:<br>`;
        html += `• Wrong email or password<br>`;
        html += `• Using developer API credentials instead of your app login<br>`;
        html += `• Email not verified on eWeLink<br>`;
        html += `• Account locked — try logging in via the eWeLink app first</span>`;
      } else if (info.devicesError) {
        html = `<strong style="color:var(--amber)">⚠ Auth OK, but no devices</strong><br>`;
        html += `${info.devicesMsg}<br><br>`;
        html += `<strong>💡 Fix:</strong> ${info.hint}`;
      } else {
        html = `<strong style="color:var(--forest)">✓ Connected!</strong><br>`;
        html += `Region: ${info.region}<br>`;
        html += `Devices found: ${info.deviceCount}<br><br>`;
        if (info.devices && info.devices.length) {
          html += `<strong>Devices:</strong><br>`;
          info.devices.forEach(d => {
            html += `• ${d.name} (${d.model}) — ${d.online ? '🟢 online' : '🔴 offline'}<br>`;
          });
        } else {
          html += `No devices on your account. Add devices in the eWeLink app first.`;
        }
      }

      debugInfo.innerHTML = html;
    } catch (err) {
      debugInfo.style.display = 'block';
      debugInfo.innerHTML = `<strong style="color:var(--brick)">Debug failed:</strong> ${err.message}<br><br>Check that the server is running and your .env is correct.`;
    }

    debugBtn.textContent = 'Run Diagnostics';
    debugBtn.disabled = false;
  }

  // ── Check Connection ────────────────────────────────────────
  async function checkConnection() {
    try {
      const status = await api('/status');
      els.connectionStatus.textContent = status.connected ? '● Connected' : '○ Not configured';
      els.connectionStatus.style.color = status.connected ? 'var(--forest)' : 'var(--amber)';
      return status.connected;
    } catch {
      els.connectionStatus.textContent = '● Disconnected';
      els.connectionStatus.style.color = 'var(--brick)';
      return false;
    }
  }

  // ── Open Device Modal ───────────────────────────────────────
  function openModal(device) {
    const state = getDeviceState(device);
    const params = device.params || {};

    els.modalDeviceName.textContent = device.name || 'Unnamed Device';
    els.modalDeviceId.textContent = device.deviceid || '';

    let bodyHtml = '';

    bodyHtml += `
      <div class="modal-section">
        <div class="modal-section-title">Power</div>
        <div class="modal-toggle-row">
          <span class="modal-toggle-label">${state.isOn ? 'On' : 'Off'}</span>
          <label class="toggle">
            <input type="checkbox" ${state.isOn ? 'checked' : ''} ${!state.online ? 'disabled' : ''} id="modalPowerToggle">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    `;

    const hasBrightness = state.brightness !== null;
    if (hasBrightness) {
      bodyHtml += `
        <div class="modal-section">
          <div class="modal-section-title">Brightness</div>
          <div class="modal-slider-group">
            <div class="modal-slider-label">
              <span>Level</span>
              <span class="val" id="modalBrightnessVal">${state.brightness}%</span>
            </div>
            <input type="range" class="modal-slider" min="1" max="100" value="${state.brightness}" ${!state.online || !state.isOn ? 'disabled' : ''} id="modalBrightness">
          </div>
        </div>
      `;
    }

    const hasColorTemp = state.colorTemp !== null;
    if (hasColorTemp) {
      bodyHtml += `
        <div class="modal-section">
          <div class="modal-section-title">Color Temperature</div>
          <div class="modal-slider-group">
            <div class="modal-slider-label">
              <span>Warm ← → Cool</span>
              <span class="val" id="modalColorTempVal">${state.colorTemp}</span>
            </div>
            <input type="range" class="modal-slider" min="0" max="100" value="${state.colorTemp}" ${!state.online || !state.isOn ? 'disabled' : ''} id="modalColorTemp">
          </div>
        </div>
      `;
    }

    if (state.online) {
      bodyHtml += `
        <div class="modal-section">
          <div class="modal-section-title">Quick Actions</div>
          <div class="quick-actions">
            <button class="quick-action-btn" id="modalQuickOn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41"/></svg>
              Turn On
            </button>
            <button class="quick-action-btn" id="modalQuickOff">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="4" opacity="0.3"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" opacity="0.3"/></svg>
              Turn Off
            </button>
            ${hasBrightness ? `
            <button class="quick-action-btn" id="modalQuick25">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 5v2m0 10v2" opacity="0.5"/></svg>
              25%
            </button>
            <button class="quick-action-btn" id="modalQuick100">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="6"/><path d="M12 3v1m0 16v1" opacity="0.8"/><path d="M5.64 5.64l.7.7m11.32 11.32l.7.7" opacity="0.6"/><path d="M5.64 18.36l.7-.7m11.32-11.32l.7-.7" opacity="0.6"/></svg>
              100%
            </button>
            ` : ''}
          </div>
        </div>
      `;
    }

    bodyHtml += `
      <div class="modal-section">
        <div class="modal-section-title">Device Info</div>
        <div class="info-grid">
          <div class="info-item">
            <div class="info-item-label">Brand</div>
            <div class="info-item-value">${escapeHtml(device.brandName || device.brandId || '—')}</div>
          </div>
          <div class="info-item">
            <div class="info-item-label">Model</div>
            <div class="info-item-value">${escapeHtml(device.productModel || '—')}</div>
          </div>
          <div class="info-item">
            <div class="info-item-label">Status</div>
            <div class="info-item-value">${state.online ? (state.isOn ? '🟢 On' : '⚫ Off') : '🔴 Offline'}</div>
          </div>
          <div class="info-item">
            <div class="info-item-label">Type</div>
            <div class="info-item-value">${escapeHtml(device.type || device.category || '—')}</div>
          </div>
          <div class="info-item">
            <div class="info-item-label">UIID</div>
            <div class="info-item-value">${device.extra?.uiid || '—'}</div>
          </div>
          <div class="info-item">
            <div class="info-item-label">API</div>
            <div class="info-item-value">${device.showApi || '—'}</div>
          </div>
          <div class="info-item" style="grid-column: 1 / -1;">
            <div class="info-item-label">Parameters</div>
            <div class="info-item-value" style="font-family: 'Space Mono', monospace; font-size: 11px; opacity: 0.7;">${escapeHtml(JSON.stringify(params, null, 2))}</div>
          </div>
        </div>
      </div>
    `;

    els.modalBody.innerHTML = bodyHtml;
    els.modalOverlay.classList.add('open');

    const modalToggle = $('#modalPowerToggle');
    if (modalToggle) {
      modalToggle.addEventListener('change', async () => {
        const newState = modalToggle.checked ? 'on' : 'off';
        try {
          await api(`/devices/${device.deviceid}/toggle`, {
            method: 'POST',
            body: JSON.stringify({ state: newState }),
          });
          toast(`${device.name} turned ${newState}`, 'success');
          await fetchDevices();
          closeModal();
        } catch (err) {
          toast(`Failed: ${err.message}`, 'error');
          modalToggle.checked = !modalToggle.checked;
        }
      });
    }

    const modalBrightness = $('#modalBrightness');
    if (modalBrightness) {
      modalBrightness.addEventListener('input', (e) => {
        $('#modalBrightnessVal').textContent = e.target.value + '%';
      });
      let deb;
      modalBrightness.addEventListener('change', (e) => {
        clearTimeout(deb);
        deb = setTimeout(async () => {
          try {
            await api(`/devices/${device.deviceid}/toggle`, {
              method: 'POST',
              body: JSON.stringify({ state: 'on', brightness: parseInt(e.target.value) }),
            });
            toast(`Brightness set to ${e.target.value}%`, 'success');
          } catch (err) {
            toast(`Error: ${err.message}`, 'error');
          }
        }, 200);
      });
    }

    const modalColorTemp = $('#modalColorTemp');
    if (modalColorTemp) {
      modalColorTemp.addEventListener('input', (e) => {
        $('#modalColorTempVal').textContent = e.target.value;
      });
      let deb2;
      modalColorTemp.addEventListener('change', (e) => {
        clearTimeout(deb2);
        deb2 = setTimeout(async () => {
          try {
            await api(`/devices/${device.deviceid}/toggle`, {
              method: 'POST',
              body: JSON.stringify({ state: 'on', colorTemp: parseInt(e.target.value) }),
            });
            toast(`Color temperature set to ${e.target.value}`, 'success');
          } catch (err) {
            toast(`Error: ${err.message}`, 'error');
          }
        }, 200);
      });
    }

    const quickOn = $('#modalQuickOn');
    const quickOff = $('#modalQuickOff');
    const quick25 = $('#modalQuick25');
    const quick100 = $('#modalQuick100');

    if (quickOn) quickOn.addEventListener('click', () => sendQuickAction(device, 'on'));
    if (quickOff) quickOff.addEventListener('click', () => sendQuickAction(device, 'off'));
    if (quick25) quick25.addEventListener('click', () => sendQuickAction(device, 'on', 25));
    if (quick100) quick100.addEventListener('click', () => sendQuickAction(device, 'on', 100));
  }

  async function sendQuickAction(device, state, brightness) {
    try {
      const body = { state };
      if (brightness !== undefined) body.brightness = brightness;
      await api(`/devices/${device.deviceid}/toggle`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const msg = brightness !== undefined
        ? `${device.name}: ${brightness}% brightness`
        : `${device.name} turned ${state}`;
      toast(msg, 'success');
      await fetchDevices();
      closeModal();
    } catch (err) {
      toast(`Failed: ${err.message}`, 'error');
    }
  }

  function closeModal() {
    els.modalOverlay.classList.remove('open');
  }

  // ── Helpers ─────────────────────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  // ── Event Listeners ─────────────────────────────────────────
  function bindEvents() {
    els.themeToggle.addEventListener('click', toggleTheme);

    els.refreshBtn.addEventListener('click', async () => {
      els.refreshBtn.style.opacity = '0.5';
      els.refreshBtn.style.pointerEvents = 'none';
      try {
        await api('/refresh', { method: 'POST' });
        await fetchDevices();
        toast('Devices refreshed', 'success');
      } catch (err) {
        toast(`Refresh failed: ${err.message}`, 'error');
      } finally {
        els.refreshBtn.style.opacity = '';
        els.refreshBtn.style.pointerEvents = '';
      }
    });

    els.searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      renderDevices();
    });

    $$('.filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        renderDevices();
      });
    });

    els.modalClose.addEventListener('click', closeModal);
    els.modalOverlay.addEventListener('click', (e) => {
      if (e.target === els.modalOverlay) closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    const debugBtn = $('#debugBtn');
    if (debugBtn) {
      debugBtn.addEventListener('click', runDebug);
    }
  }

  // ── Initialize ──────────────────────────────────────────────
  async function init() {
    initTheme();
    bindEvents();
    showView('loading');
    await checkConnection();
    await fetchDevices();
    refreshInterval = setInterval(async () => {
      await fetchDevices();
    }, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
