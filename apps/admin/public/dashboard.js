// Ariadne Admin Dashboard — vanilla JS, no build step

const STATUS_INTERVAL = 5_000;
const LOG_INTERVAL    = 6_000;
const ERROR_INTERVAL  = 15_000;

// ── Utilities ──────────────────────────────────────────────────────────────

function el(id) { return document.getElementById(id); }

function fmtUptime(secs) {
  if (secs == null) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString();
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

// ── Status panel ───────────────────────────────────────────────────────────

async function refreshStatus() {
  let data;
  try {
    const r = await fetch('/api/status');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch (e) {
    el('status-bar').textContent = `Status fetch failed: ${e.message}`;
    return;
  }

  // Supervisor uptime
  el('supervisor-uptime').textContent =
    `Supervisor up ${fmtUptime(data.supervisorUptime)}`;

  el('last-refresh').textContent =
    `Last refresh: ${new Date().toLocaleTimeString()}`;

  // Process list
  const list = el('process-list');
  list.innerHTML = '';

  for (const child of data.children) {
    const row = document.createElement('div');
    row.className = 'process-row';

    const dot = document.createElement('span');
    dot.className = `process-dot ${child.running ? 'dot-up' : 'dot-down'}`;

    const name = document.createElement('span');
    name.className = 'process-name';
    name.textContent = child.name;

    const meta = document.createElement('span');
    meta.className = 'process-meta';
    const parts = [];
    if (child.pid) parts.push(`PID ${child.pid}`);
    if (child.running && child.uptime != null) parts.push(`up ${fmtUptime(child.uptime)}`);
    if (!child.running && child.lastExitCode != null) parts.push(`exit ${child.lastExitCode}`);
    if (child.restartCount > 0) parts.push(`↺ ${child.restartCount}`);
    meta.textContent = parts.join('  ·  ') || '—';

    const actions = document.createElement('div');
    actions.className = 'process-actions';

    const restartBtn = document.createElement('button');
    restartBtn.className = 'btn-ghost';
    restartBtn.textContent = 'Restart';
    restartBtn.onclick = () => restartProcess(child.name, restartBtn);

    actions.appendChild(restartBtn);
    row.append(dot, name, meta, actions);
    list.appendChild(row);
  }

  // Tunnel URL
  const tunnelPanel = el('tunnel-panel');
  const tunnelBadge = el('tunnel-badge');
  const tunnelProcess = data.children.find(c => c.name === 'tunnel');

  if (data.tunnelUrl) {
    tunnelBadge.className = 'badge badge-up';
    tunnelBadge.textContent = 'Active';
    tunnelPanel.innerHTML = '';

    const urlSpan = document.createElement('span');
    urlSpan.className = 'tunnel-url';
    urlSpan.textContent = data.tunnelUrl;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.onclick = () => copyToClipboard(data.tunnelUrl, copyBtn);

    const openBtn = document.createElement('a');
    openBtn.href = data.tunnelUrl;
    openBtn.target = '_blank';
    openBtn.rel = 'noopener noreferrer';
    openBtn.className = 'btn-ghost';
    openBtn.style.textDecoration = 'none';
    openBtn.textContent = 'Open ↗';

    tunnelPanel.append(urlSpan, copyBtn, openBtn);
  } else {
    tunnelBadge.className = 'badge badge-down';
    tunnelBadge.textContent = tunnelProcess?.running ? 'Starting…' : 'Down';
    tunnelPanel.innerHTML =
      '<span class="tunnel-placeholder">Waiting for tunnel URL…</span>';
  }
}

// ── Log viewer ─────────────────────────────────────────────────────────────

async function refreshLogs() {
  const name = el('log-select').value;
  const out  = el('log-output');
  let data;
  try {
    const r = await fetch(`/api/logs?name=${encodeURIComponent(name)}&lines=150`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch (e) {
    out.textContent = `Log fetch failed: ${e.message}`;
    return;
  }
  const text = (data.lines || []).join('\n');
  out.textContent = text || '(no log lines yet)';
  // Auto-scroll to bottom
  out.scrollTop = out.scrollHeight;
}

// Re-fetch when user changes the dropdown
el('log-select').addEventListener('change', refreshLogs);

// ── Error analysis ─────────────────────────────────────────────────────────

async function refreshErrors() {
  const list = el('error-list');
  let data;
  try {
    const r = await fetch('/api/errors');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch (e) {
    list.innerHTML = `<div class="text-muted text-sm">Fetch failed: ${e.message}</div>`;
    return;
  }

  if (!data.errors || data.errors.length === 0) {
    list.innerHTML = '<div class="no-errors">No errors detected in logs.</div>';
    return;
  }

  list.innerHTML = '';
  for (const err of data.errors) {
    const entry = document.createElement('div');
    entry.className = 'error-entry';

    const msg = document.createElement('div');
    msg.className = 'error-msg';
    msg.textContent = err.message;

    const diag = document.createElement('div');
    diag.className = 'error-diagnosis';
    diag.textContent = err.diagnosis;

    const meta = document.createElement('div');
    meta.className = 'error-meta';
    meta.textContent = `×${err.count}  ·  last seen ${fmtTime(err.lastSeen)}`;

    entry.append(msg, diag, meta);
    list.appendChild(entry);
  }
}

// ── Manual restart ─────────────────────────────────────────────────────────

async function restartProcess(name, btn) {
  btn.disabled = true;
  btn.textContent = 'Restarting…';
  try {
    const r = await fetch(`/api/restart?name=${encodeURIComponent(name)}`, {
      method: 'POST',
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${r.status}`);
    }
    btn.textContent = 'Sent';
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = 'Restart';
    }, 3000);
  } catch (e) {
    btn.textContent = `Error: ${e.message}`;
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = 'Restart';
    }, 4000);
  }
}

// ── Polling loops ──────────────────────────────────────────────────────────

function startPolling() {
  refreshStatus();
  refreshLogs();
  refreshErrors();

  setInterval(refreshStatus, STATUS_INTERVAL);
  setInterval(refreshLogs,   LOG_INTERVAL);
  setInterval(refreshErrors, ERROR_INTERVAL);
}

// Kick off once DOM is ready (script is deferred by placement at bottom of body)
startPolling();
