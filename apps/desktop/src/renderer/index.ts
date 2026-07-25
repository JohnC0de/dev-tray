// @ts-nocheck — Phase 0 verbatim port; typed in Phase 5 (Solid).

const api = window.devTray;
const card = document.getElementById('card');
const frame = document.querySelector('.frame');
const ctxMenu = document.getElementById('context-menu');
const trayCanvas = document.getElementById('tray-canvas');

// ---------------------------------------------------------------------------
// Icons (inline SVG, currentColor)
// ---------------------------------------------------------------------------
const ICON = {
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v9"/><path d="M6.4 7a8 8 0 1 0 11.2 0"/></svg>',
  ellipsis: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  branch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="8" r="2.4"/><path d="M6 8.4v7.2"/><path d="M18 10.2c0 4-3 4.5-6 5"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>',
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 1.5 21h21L12 3Zm0 6v5m0 3.2v.1" stroke="#fff" stroke-width="0"/><path d="M12 4.3 2.7 20.2h18.6L12 4.3Zm-.9 5.2h1.8v6h-1.8v-6Zm0 7.4h1.8v1.8h-1.8v-1.8Z"/></svg>',
  square: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let state = {
  appName: 'Dev Tray',
  version: '',
  settings: { refreshInterval: 5, hasCompletedOnboarding: false },
  launchAtLogin: false,
  entries: [],
  isScanning: false,
  error: null,
};

let mode = null;            // 'onboard' | 'main'
let contentEl = null;       // persistent content container in main mode
let headerEl = null;
let listEl = null;          // persistent .list when showing entries
const rowEls = new Map();   // id -> element
const groupEls = new Map(); // groupKey -> { block, body, countEl, nameEl }
const collapsedGroups = new Set();
const leavingEls = new Map(); // id -> { node, timer } — rows animating out
let settingsOpen = false;
let contentSubmode = null;
let lastHeaderKey = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function formatUptime(startISO) {
  if (!startISO) return '';
  const s = Math.floor((Date.now() - new Date(startISO).getTime()) / 1000);
  if (s < 60) return '<1m';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function statusOf() {
  const count = state.entries.length;
  if (state.error && count === 0) return 'error';
  return count === 0 ? 'idle' : 'active';
}

function healthClass(entry) {
  const h = entry.health;
  if (h === 'dead' || h === 'slow' || h === 'unknown') return `health-${h}`;
  return 'health-alive';
}

function entryGroupKey(entry) {
  return entry.groupKey || entry.projectName || String(entry.port);
}

function groupEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entryGroupKey(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Tray icon (drawn here, pushed to main)
// ---------------------------------------------------------------------------
const TRAY_COLORS = { idle: '#8e8e93', active: '#2fcb53', error: '#ff9f0a' };
let lastTrayKey = '';

function updateTray() {
  const count = state.entries.length;
  const status = statusOf();
  const key = `${status}:${count}`;
  if (key === lastTrayKey) return; // skip redundant re-raster + IPC
  lastTrayKey = key;
  if (!trayCanvas) return;
  const ctx = trayCanvas.getContext('2d');
  ctx.clearRect(0, 0, 32, 32);
  ctx.fillStyle = TRAY_COLORS[status];
  ctx.beginPath();
  ctx.roundRect(2, 2, 28, 28, 8);
  ctx.fill();
  if (count > 0) {
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = count > 99 ? '99+' : String(count);
    ctx.font = `600 ${label.length >= 3 ? 11 : label.length === 2 ? 16 : 19}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(label, 16, 17);
  }
  const tip = count === 0
    ? `${state.appName} — no dev servers`
    : `${state.appName} — ${count} dev server${count === 1 ? '' : 's'}`;
  try { api.updateTray({ dataURL: trayCanvas.toDataURL('image/png'), tooltip: tip }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Window sizing
// ---------------------------------------------------------------------------
const FRAME_PAD = 10;
const CARD_PAD = 8;

let lastSentHeight = 0;
let resizeRaf = 0;
let resizeLock = false;

function applySettingsPopLayout() {
  const pop = card.querySelector('.settings-pop');
  if (!pop) {
    card.style.minHeight = '';
    return null;
  }
  const cardTop = card.getBoundingClientRect().top;
  const popBottom = pop.getBoundingClientRect().bottom;
  card.style.minHeight = `${Math.ceil(popBottom - cardTop + CARD_PAD)}px`;
  return pop;
}

function measureFrameHeight(pop) {
  if (!pop) return Math.round(frame.offsetHeight);
  const frameTop = frame.getBoundingClientRect().top;
  const popBottom = pop.getBoundingClientRect().bottom;
  return Math.ceil(popBottom - frameTop + FRAME_PAD);
}

function commitResize() {
  if (resizeLock) return;
  resizeLock = true;
  try {
    const pop = applySettingsPopLayout();
    const h = measureFrameHeight(pop);
    if (h === lastSentHeight) return;
    lastSentHeight = h;
    api.resizeWindow(h);
  } finally {
    resizeLock = false;
  }
}

function scheduleResize() {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    commitResize();
  });
}

const ro = new ResizeObserver(() => {
  if (resizeLock) return;
  scheduleResize();
});
ro.observe(card);

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
function buildHeader() {
  const header = el('div', 'header');
  header.append(el('span', 'title', state.appName), el('span', 'spacer'));
  const controls = el('div', 'controls');

  const quit = el('button', 'hbtn', ICON.power);
  quit.title = `Quit ${state.appName}`;
  quit.addEventListener('click', () => api.quit());

  const settings = el('button', 'hbtn', ICON.ellipsis);
  settings.title = 'Settings';
  settings.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsOpen = !settingsOpen;
    renderHeader();
    scheduleResize();
  });

  controls.append(quit, settings);
  if (settingsOpen) controls.append(buildSettings());
  header.append(controls);
  return header;
}

function buildSettings() {
  const pop = el('div', 'settings-pop');
  pop.addEventListener('click', (e) => e.stopPropagation());
  pop.append(el('div', 'ver', `${state.appName} v${state.version}`));

  // refresh interval
  const intervalWrap = el('div');
  intervalWrap.append(el('div', 'sub', 'Refresh interval'));
  const seg = el('div', 'segmented');
  for (const sec of [2, 5, 10, 30]) {
    const b = el('button', sec === state.settings.refreshInterval ? 'active' : '', `${sec}s`);
    b.addEventListener('click', async () => {
      const actual = await api.setRefreshInterval(sec);
      state.settings.refreshInterval = actual;
      renderHeader();
    });
    seg.append(b);
  }
  intervalWrap.append(seg);
  pop.append(intervalWrap);

  // launch at login
  const row = el('div', 'row');
  row.append(el('span', 'label', 'Launch at Login'));
  const sw = el('label', 'switch');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = state.launchAtLogin;
  input.addEventListener('change', async () => {
    const actual = await api.setLaunchAtLogin(input.checked);
    state.launchAtLogin = actual;
    input.checked = actual;
    lastHeaderKey = headerKey(); // keep in sync; don't trigger a header rebuild
  });
  sw.append(input, el('span', 'track'), el('span', 'thumb'));
  row.append(sw);
  pop.append(row);

  return pop;
}

// Header only depends on these; rebuilding it on every ~480ms scan would reset
// an open settings popover (focus, in-progress toggles), so gate on a key.
function headerKey() {
  return [
    state.entries.length > 0 ? 1 : 0,
    settingsOpen ? 1 : 0,
    state.version,
    state.settings.refreshInterval,
    state.launchAtLogin ? 1 : 0,
  ].join('|');
}

function renderHeader() {
  const fresh = buildHeader();
  if (headerEl && headerEl.parentNode) headerEl.replaceWith(fresh);
  headerEl = fresh;
  lastHeaderKey = headerKey();
}

function maybeRenderHeader() {
  if (headerKey() !== lastHeaderKey) renderHeader();
}

// ---------------------------------------------------------------------------
// Port rows (grouped, 1-line)
// ---------------------------------------------------------------------------
function createGroupBlock(groupKey, items) {
  const block = el('section', 'group-block');
  block.dataset.group = groupKey;
  if (collapsedGroups.has(groupKey)) block.classList.add('collapsed');

  const head = el('div', 'group-head');
  head.append(el('span', 'group-chevron', ICON.chevron));

  const title = el('span', 'group-title');
  const nameEl = el('span', 'group-name', items[0].projectName);
  title.append(nameEl, el('span', 'group-dot', '·'));
  const countEl = el('span', 'group-count', String(items.length));
  title.append(countEl);
  head.append(title);

  const killGroup = el('button', 'icon-btn ghost destructive stop', ICON.stop);
  killGroup.title = 'Kill group';
  killGroup.addEventListener('click', (e) => {
    e.stopPropagation();
    for (const entry of state.entries) {
      if (entryGroupKey(entry) !== groupKey) continue;
      api.killPort(entry.pid, entry.port);
      const row = rowEls.get(entry.id);
      if (row) startLeaving(entry.id, row);
    }
  });
  head.append(killGroup);

  head.addEventListener('click', (e) => {
    if (e.target.closest('.icon-btn')) return;
    block.classList.toggle('collapsed');
    if (block.classList.contains('collapsed')) collapsedGroups.add(groupKey);
    else collapsedGroups.delete(groupKey);
    scheduleResize();
  });

  const body = el('div', 'group-body');
  block.append(head, body);
  block._refs = { body, nameEl, countEl };
  return block;
}

function updateGroupHead(block, items) {
  block._refs.nameEl.textContent = items[0].projectName;
  block._refs.nameEl.title = items[0].projectName;
  block._refs.countEl.textContent = String(items.length);
}

function createRow(entry) {
  const row = el('div', 'port-row group-row');
  row.dataset.id = entry.id;

  const branch = el('span', 'branch', `${ICON.branch}<span></span>`);
  const dot = el('span', 'dot');
  const portNum = el('span', 'port-num');
  const fw = el('span', 'tag framework');
  fw.hidden = true;
  const drift = el('span', 'tag drift', 'drift');
  drift.hidden = true;

  const openBtn = el('button', 'icon-btn ghost', ICON.open);
  openBtn.title = 'Open';
  openBtn.addEventListener('click', (e) => { e.stopPropagation(); api.openPort(entry.port); });
  const killBtn = el('button', 'icon-btn ghost destructive', ICON.close);
  killBtn.title = 'Kill';
  killBtn.addEventListener('click', (e) => { e.stopPropagation(); killRow(entry, row); });

  row.append(
    branch, dot, portNum, fw, drift,
    el('span', 'group-row-spacer'),
    el('span', 'uptime'),
    el('span', 'row-actions-divider'),
    openBtn, killBtn,
  );

  row._refs = {
    branch,
    branchText: branch.querySelector('span'),
    dot,
    portNum,
    fw,
    drift,
    uptime: row.querySelector('.uptime'),
  };
  row.addEventListener('contextmenu', (e) => showContextMenu(e, entry));
  row.addEventListener('animationend', () => row.classList.remove('entering'), { once: true });
  updateRow(row, entry);
  return row;
}

function updateRow(row, entry) {
  row._entry = entry;
  const r = row._refs;
  const branchName = entry.branchCurrent ?? entry.branch;
  if (branchName) {
    r.branch.style.display = '';
    r.branchText.textContent = branchName;
  } else {
    r.branch.style.display = 'none';
  }
  r.dot.className = `dot ${healthClass(entry)}`;
  r.portNum.textContent = `:${entry.port}`;
  if (entry.framework) {
    r.fw.hidden = false;
    r.fw.textContent = entry.framework;
  } else {
    r.fw.hidden = true;
  }
  if (entry.branchDrifted) {
    r.drift.hidden = false;
  } else {
    r.drift.hidden = true;
  }
  r.uptime.textContent = formatUptime(entry.startTime);
}

// Animate a row out, tracking its pending-removal timer so it can be reclaimed
// (if the same id reappears) or force-cleared (on a submode switch).
function startLeaving(id, row) {
  rowEls.delete(id);
  row.classList.add('leaving');
  const timer = setTimeout(() => { leavingEls.delete(id); row.remove(); }, 300);
  leavingEls.set(id, { node: row, timer });
}

function reclaimLeaving(id) {
  const l = leavingEls.get(id);
  if (!l) return null;
  clearTimeout(l.timer);
  leavingEls.delete(id);
  l.node.classList.remove('leaving');
  return l.node;
}

function clearLeaving() {
  for (const { node, timer } of leavingEls.values()) { clearTimeout(timer); node.remove(); }
  leavingEls.clear();
}

function killRow(entry, row) {
  api.killPort(entry.pid, entry.port);
  startLeaving(entry.id, row);
}

function clearListDom() {
  clearLeaving();
  rowEls.clear();
  groupEls.clear();
}

function reconcileList(entries) {
  const desired = new Map(entries.map((e) => [e.id, e]));

  for (const [id, row] of [...rowEls]) {
    if (!desired.has(id)) startLeaving(id, row);
  }

  const groups = groupEntries(entries);
  const desiredGroups = new Set(groups.keys());

  for (const [key, block] of [...groupEls]) {
    if (!desiredGroups.has(key)) {
      block.remove();
      groupEls.delete(key);
    }
  }

  for (const [key, items] of groups) {
    let block = groupEls.get(key);
    if (!block) {
      block = createGroupBlock(key, items);
      groupEls.set(key, block);
      listEl.append(block);
    } else {
      updateGroupHead(block, items);
    }

    for (const entry of items) {
      let row = rowEls.get(entry.id);
      if (!row) {
        row = reclaimLeaving(entry.id);
        if (row) {
          updateRow(row, entry);
        } else {
          row = createRow(entry);
          row.classList.add('entering');
        }
        rowEls.set(entry.id, row);
      } else {
        updateRow(row, entry);
      }
      block._refs.body.append(row);
    }

    listEl.append(block);
  }
}

// ---------------------------------------------------------------------------
// State views
// ---------------------------------------------------------------------------
function stateEmpty() {
  const s = el('div', 'state');
  const g = el('span', 'glyph empty-square', ICON.square);
  g.style.width = g.style.height = '26px';
  g.querySelector('svg').style.width = g.querySelector('svg').style.height = '26px';
  s.append(g, el('div', 'title', 'No dev servers detected'),
    el('div', 'sub', 'Start a dev server to see it here'));
  return s;
}

function stateScanning() {
  const s = el('div', 'state');
  s.append(el('span', 'spinner'), el('div', 'title', 'Scanning ports…'));
  return s;
}

function stateError(msg) {
  const s = el('div', 'state');
  const g = el('span', 'glyph warn', ICON.warn);
  g.querySelector('svg').style.width = g.querySelector('svg').style.height = '26px';
  s.append(g, el('div', 'title', 'Scan failed'), el('div', 'sub', msg || 'Port scan failed'));
  const retry = el('button', 'retry', 'Retry');
  retry.addEventListener('click', () => api.refresh());
  s.append(retry);
  return s;
}

function updateContent() {
  const count = state.entries.length;
  let submode;
  if (state.error && count === 0) submode = 'error';
  else if (count === 0 && state.isScanning) submode = 'scanning';
  else if (count === 0) submode = 'empty';
  else submode = 'list';

  if (submode === 'list') {
    if (contentSubmode !== 'list') {
      clearListDom();
      contentEl.innerHTML = '';
      listEl = el('div', 'list');
      contentEl.append(listEl);
    }
    reconcileList(state.entries);
  } else {
    clearListDom();
    contentEl.innerHTML = '';
    listEl = null;
    if (submode === 'error') contentEl.append(stateError(state.error));
    else if (submode === 'scanning') contentEl.append(stateScanning());
    else contentEl.append(stateEmpty());
  }
  contentSubmode = submode;
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------
function showContextMenu(e, entry) {
  e.preventDefault();
  ctxMenu.innerHTML = '';
  const item = (label, cls, fn) => {
    const b = el('button', cls || '', label);
    b.addEventListener('click', () => { hideContextMenu(); fn(); });
    return b;
  };
  ctxMenu.append(
    item('Copy URL', '', () => api.copy(`http://localhost:${entry.port}`)),
    item('Copy Port', '', () => api.copy(String(entry.port))),
    el('div', 'sep'),
    item('Open in Browser', '', () => api.openPort(entry.port)),
    el('div', 'sep'),
    item('Kill Server', 'destructive', () => {
      const row = rowEls.get(entry.id);
      if (row) killRow(entry, row); else api.killPort(entry.pid, entry.port);
    }),
  );
  ctxMenu.hidden = false;
  const mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight;
  const x = Math.min(e.clientX, window.innerWidth - mw - 6);
  const y = Math.min(e.clientY, window.innerHeight - mh - 6);
  ctxMenu.style.left = `${Math.max(6, x)}px`;
  ctxMenu.style.top = `${Math.max(6, y)}px`;
}

function hideContextMenu() { ctxMenu.hidden = true; }

document.addEventListener('click', (e) => {
  if (!ctxMenu.hidden) hideContextMenu();
  if (settingsOpen && !e.target.closest('.settings-pop') && !e.target.closest('.controls')) {
    settingsOpen = false;
    renderHeader();
    scheduleResize();
  }
});
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.port-row')) e.preventDefault();
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideContextMenu(); api.hideWindow(); } });

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------
const GLYPHS = '0123456789abcdefABCDEF!@#$%&*?<>{}[]|~'.split('');
const ONBOARD_PORTS = [
  ['localhost:3000', 49, 40], ['localhost:5173', 240, 28],
  ['localhost:8080', 32, 124], ['localhost:4000', 232, 120],
  ['localhost:3001', 128, 72], ['localhost:9000', 64, 205],
  ['localhost:8000', 236, 195], ['localhost:5000', 150, 168],
];
const REVEAL_DELAYS = [50, 250, 420, 560, 670, 750, 810, 860];

let onboardCancelled = false;
let onboardTimers = [];
function oTimeout(fn, ms) {
  const id = setTimeout(() => {
    onboardTimers = onboardTimers.filter((t) => t !== id);
    if (!onboardCancelled) fn();
  }, ms);
  onboardTimers.push(id);
  return id;
}
function cancelOnboard() {
  onboardCancelled = true;
  onboardTimers.forEach(clearTimeout);
  onboardTimers = [];
}

function scramble(node, target) {
  let step = 0;
  const steps = 14;
  const tick = () => {
    if (onboardCancelled) return;
    step++;
    if (step >= steps) { node.textContent = target; return; }
    const resolved = Math.floor(target.length * (step / steps));
    node.textContent = target.split('').map((c, i) =>
      (i < resolved || c === ':' || c === '.' ) ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
    ).join('');
    setTimeout(tick, 40);
  };
  node.textContent = target.split('').map((c) => (c === ':' || c === '.') ? c : GLYPHS[0]).join('');
  setTimeout(tick, 40);
}

function buildOnboarding() {
  mode = 'onboard';
  settingsOpen = false;
  onboardCancelled = false;
  onboardTimers.forEach(clearTimeout);
  onboardTimers = [];
  card.innerHTML = '';
  const root = el('div', 'onboard');
  const portsLayer = el('div', 'ports-layer');
  const ghosts = ONBOARD_PORTS.map(([label, x, y]) => {
    const g = el('div', 'ghost');
    g.style.left = `${x}px`;
    g.style.top = `${y}px`;
    portsLayer.append(g);
    return { node: g, label };
  });

  const content = el('div', 'content');
  const h1 = el('h1', 'reveal', 'localhost,\norganized.');
  const p = el('p', 'reveal', 'A tray app that tracks your\ndev servers across projects.');
  content.append(h1, p);

  const actions = el('div', 'actions reveal');
  const getStarted = el('button', 'btn-primary', 'Get Started');
  getStarted.addEventListener('click', async () => {
    cancelOnboard();
    await api.completeOnboarding();
    state.settings.hasCompletedOnboarding = true;
    buildMain();
    applyState();
  });
  actions.append(getStarted);

  root.append(portsLayer, content, actions);
  card.append(root);
  scheduleResize();

  // animation sequence (all timers cancellable when leaving onboarding)
  ghosts.forEach((g, i) => {
    oTimeout(() => {
      g.node.style.opacity = '0.22';
      g.node.style.transform = 'scale(1)';
      g.node.style.filter = 'blur(0)';
      scramble(g.node, g.label);
    }, REVEAL_DELAYS[i]);
  });
  oTimeout(() => {
    ghosts.forEach((g) => {
      g.node.style.opacity = '0';
      g.node.style.transform = 'scale(0.94)';
      g.node.style.filter = 'blur(6px)';
    });
    oTimeout(() => h1.classList.add('show'), 250);
    oTimeout(() => p.classList.add('show'), 420);
    oTimeout(() => actions.classList.add('show'), 550);
  }, 1700);
}

// ---------------------------------------------------------------------------
// Main scaffold
// ---------------------------------------------------------------------------
function buildMain() {
  mode = 'main';
  card.innerHTML = '';
  headerEl = buildHeader();
  lastHeaderKey = headerKey();
  contentEl = el('div');
  contentSubmode = null;
  listEl = null;
  clearListDom();
  card.append(headerEl, el('div', 'divider'), contentEl);
}

// ---------------------------------------------------------------------------
// Apply state
// ---------------------------------------------------------------------------
function applyState() {
  if (!state.settings.hasCompletedOnboarding) {
    if (mode !== 'onboard') buildOnboarding();
    updateTray();
    return;
  }
  if (mode !== 'main') buildMain();
  maybeRenderHeader();
  updateContent();
  updateTray();
  scheduleResize();
}

// uptime ticker
setInterval(() => {
  if (document.visibilityState !== 'visible') return; // popover hidden — skip work
  for (const row of rowEls.values()) {
    if (row._entry) row._refs.uptime.textContent = formatUptime(row._entry.startTime);
  }
}, 1000);

// ---------------------------------------------------------------------------
// IPC wiring
// ---------------------------------------------------------------------------
api.onPortsUpdate((data) => {
  state.entries = data.entries || [];
  state.isScanning = !!data.isScanning;
  state.error = data.error || null;
  applyState();
});

api.onWillShow(() => {
  hideContextMenu();
  if (settingsOpen) { settingsOpen = false; if (mode === 'main') renderHeader(); }
  scheduleResize();
});

(async function init() {
  try {
    const info = await api.init();
    state.appName = info.appName || state.appName;
    state.version = info.version || '';
    state.settings = info.settings || state.settings;
    state.launchAtLogin = !!info.launchAtLogin;
  } catch (e) {
    console.error('init failed', e);
  }
  applyState();
})();
