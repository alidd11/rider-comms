// Rider Comms Operations Hub: separate staff PWA login and web dashboard.
// Staff authenticate using their Rider Comms account through /auth/staff-login.
// The installed /staff/ app has its own session key, manifest and worker.
// Every admin/moderation API still enforces the current server-side staff role.
//
// Rider-supplied text (names, report details, notes) is only ever inserted
// with textContent, never parsed as HTML.
(() => {
  const API_BASE_URL = 'https://backend-production-7fa0.up.railway.app';
  const SESSION_KEY = 'rider-comms-session-v1';
  const STAFF_SESSION_KEY = 'rider-comms-staff-session-v1';
  const STAFF_SIGNED_OUT_KEY = 'rider-comms-staff-signed-out-v1';
  const IS_STAFF_PWA = /\/staff\/(?:index\.html)?$/.test(location.pathname);
  const PERIOD_KEY = 'rider-comms-admin-period';
  const MAX_NOTE_LENGTH = 1000;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const VIEWS = ['overview', 'inbox', 'riders', 'moderation', 'audit', 'staff', 'system', 'rider'];
  const VIEW_TITLES = { overview: 'Overview', inbox: 'Action inbox', riders: 'Riders', moderation: 'Moderation', audit: 'Audit log', staff: 'Staff and roles', system: 'System', rider: 'Rider' };
  const VIEW_PERMISSIONS = { overview: 'view_overview', inbox: 'moderate', riders: 'view_riders', moderation: 'moderate', audit: 'view_audit', staff: 'manage_staff', system: 'view_system', rider: 'view_riders' };
  /** Ready-made reasons staff can start a note from; they can edit before saving. */
  const NOTE_TEMPLATES = {
    dismiss: ['Checked the conversation: no rule broken.', 'Duplicate of an earlier report.', 'Not enough to act on; watching the account.'],
    suspend: ['Harassment of other riders.', 'Spam or scam messages.', 'Sexual content sent without consent.', 'Dangerous riding encouraged or shown.'],
  };
  const SUSPENSION_LENGTHS = [['1', '1 day'], ['7', '7 days'], ['30', '30 days'], ['', 'No end date']];
  const ROLE_LABELS = { admin: 'Admin', moderator: 'Moderator', support: 'Support', analyst: 'Analyst' };
  const ROLE_TONES = { admin: 'accent', moderator: 'warning', support: 'success', analyst: null };
  // What each role can do, in words; mirrors backend/src/staffRoles.ts.
  const ROLE_SUMMARIES = [
    ['admin', 'Everything, including adding and removing staff. Set with ADMIN_RIDER_IDS on the backend.'],
    ['moderator', 'Reports, hidden Social posts and suspensions. Can look riders up and read the audit log.'],
    ['support', 'Account help: looks riders up, verifies email, sends password resets and signs out lost devices. Cannot suspend or see reports.'],
    ['analyst', 'Overview and system status only. No rider details, reports or notes.'],
  ];
  const PERMISSION_LABELS = [
    ['view_overview', 'Overview'], ['view_riders', 'Rider lookup'], ['moderate', 'Moderation'],
    ['verify_email', 'Verify email'], ['account_help', 'Password resets and devices'], ['view_audit', 'Audit log'], ['manage_staff', 'Staff'], ['view_system', 'System'],
  ];
  const ROLE_MATRIX = {
    admin: ['view_overview', 'view_riders', 'moderate', 'verify_email', 'account_help', 'view_audit', 'manage_staff', 'view_system'],
    moderator: ['view_overview', 'view_riders', 'moderate', 'view_audit', 'view_system'],
    support: ['view_overview', 'view_riders', 'verify_email', 'account_help', 'view_audit', 'view_system'],
    analyst: ['view_overview', 'view_system'],
  };
  const REASON_LABELS = {
    harassment: 'Harassment',
    unsafe: 'Unsafe riding or behaviour',
    spam: 'Spam',
    sexual: 'Sexual content',
    other: 'Other',
  };
  const ACTION_LABELS = { dismiss: 'Dismissed a report', suspend: 'Suspended rider', unsuspend: 'Unsuspended rider', verify_email: 'Verified email', social_post_restore: 'Restored a Social post', social_post_remove: 'Removed a Social post', staff_grant: 'Gave a staff role', staff_revoke: 'Removed a staff role', data_export: 'Exported data', sign_out_everywhere: 'Signed out everywhere', password_reset_sent: 'Sent a password reset' };
  const ACTION_GROUPS = [
    ['all', 'All actions', null],
    ['reports', 'Reports', ['dismiss', 'suspend', 'unsuspend']],
    ['social', 'Social posts', ['social_post_restore', 'social_post_remove']],
    ['accounts', 'Accounts', ['verify_email', 'data_export', 'sign_out_everywhere', 'password_reset_sent']],
    ['staff', 'Staff', ['staff_grant', 'staff_revoke']],
  ];

  const pageEl = document.getElementById('page');
  const navEl = document.getElementById('nav');
  const footerEl = document.getElementById('sidebarFooter');
  const reportCountEl = document.getElementById('navReportCount');
  const refreshMobile = document.getElementById('refreshMobile');

  // #rider/<id> opens one rider; every other hash is a section.
  function parseHash(hash) {
    const match = /^rider\/([A-Za-z0-9_-]{1,64})$/.exec(hash);
    if (match) return { view: 'rider', riderId: match[1] };
    return { view: VIEWS.includes(hash) && hash !== 'rider' ? hash : 'overview', riderId: null };
  }
  let { view, riderId: detailRiderId } = parseHash(location.hash.slice(1));
  let period = readPeriod();
  let moderationView = 'open';
  let inboxFilter = 'all';
  // A local view over the returned 50-item snapshot, never a global ownership count.
  let inboxOwnerFilter = 'all';
  let inboxFocusTarget = null;
  let riderQuery = '';
  let auditGroup = 'all';
  let auditRider = '';
  let me = null;
  const allowed = (permission) => Boolean(me?.permissions?.includes(permission));
  let overviewCache = null;
  let chartSeq = 0;
  // Ignore responses from a section or filter the staff member has already left.
  let renderGeneration = 0;
  const isCurrentRender = (generation) => generation === renderGeneration;
  let displayedKey = null;
  let focusHeadingOnNextRender = false;
  const renderKey = () => JSON.stringify([view, detailRiderId,
    view === 'riders' ? riderQuery : null,
    view === 'moderation' ? moderationView : null,
    view === 'moderation' ? inboxFocusTarget?.id ?? null : null,
    view === 'inbox' ? inboxFilter : null,
    view === 'inbox' ? inboxOwnerFilter : null,
    view === 'audit' ? auditGroup : null,
    view === 'audit' ? auditRider : null]);
  const names = new Map();

  // ------------------------------------------------------------ Utilities

  function readPeriod() {
    try { return localStorage.getItem(PERIOD_KEY) === '30' ? 30 : 7; } catch { return 7; }
  }
  function savePeriod(value) {
    try { localStorage.setItem(PERIOD_KEY, String(value)); } catch { /* Per-browser preference only. */ }
  }

  function readSession() {
    try {
      const stored = JSON.parse(localStorage.getItem(STAFF_SESSION_KEY) || 'null');
      if (stored?.token && stored?.riderId) return { ...stored, source: 'staff' };
    } catch { /* Storage is optional; staff may sign in again. */ }
    // Keep legacy /admin.html access for signed-in Rider Comms users, but
    // installed /staff/ must NEVER depend on another app's isolated storage.
    if (IS_STAFF_PWA) return null;
    try { if (sessionStorage.getItem(STAFF_SIGNED_OUT_KEY) === '1') return null; } catch { /* no-op */ }
    for (const storage of [localStorage, sessionStorage]) {
      try {
        const stored = JSON.parse(storage.getItem(SESSION_KEY) || 'null');
        if (stored?.token && stored?.riderId) return { ...stored, source: 'legacy' };
      } catch { /* Ignore unreadable storage. */ }
    }
    return null;
  }
  let session = readSession();
  if (IS_STAFF_PWA && 'serviceWorker' in navigator) {
    // Isolated scope: the main rider worker must never own the staff shell.
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  }

  class ApiError extends Error {
    constructor(status, code) {
      super(code || `HTTP ${status}`);
      this.status = status;
      this.code = code;
    }
  }

  async function request(method, path, body) {
    const headers = { Authorization: `Bearer ${session.token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(response.status, json.error);
    return json;
  }

  // Staff changes need the password re-entered every 15 minutes. When the
  // backend asks, confirm it here and send the change again once.
  async function api(method, path, body) {
    try {
      return await request(method, path, body);
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'reauth_required') throw error;
      if (!(await confirmPassword())) throw new ApiError(403, 'reauth_cancelled');
      return request(method, path, body);
    }
  }

  /** A password dialog; resolves true once the backend accepts it, false if closed. */
  function confirmPassword() {
    return new Promise((resolve) => {
      const input = el('input', { class: 'input', type: 'password', id: 'reauthPassword', autocomplete: 'current-password', 'aria-label': 'Password', required: true });
      const error = el('p', { class: 'error-text', role: 'alert' });
      const submit = el('button', { type: 'submit', class: 'button button-primary', text: 'Confirm' });
      const cancel = el('button', { type: 'button', class: 'button', value: 'cancel', text: 'Cancel' });
      const form = el('form', { class: 'dialog-body', novalidate: true }, [
        el('h2', { class: 'card-title', id: 'reauthTitle', text: 'Confirm it’s you' }),
        el('p', { class: 'card-description', text: 'Enter your Rider Comms password to make staff changes for the next 15 minutes.' }),
        input,
        error,
        el('div', { class: 'actions' }, [cancel, submit]),
      ]);
      const dialog = el('dialog', { class: 'dialog', 'aria-labelledby': 'reauthTitle' }, [form]);
      let accepted = false;
      cancel.addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => { dialog.remove(); resolve(accepted); });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!input.value) {
          error.textContent = 'Enter your password.';
          return;
        }
        submit.disabled = true;
        error.textContent = '';
        try {
          await request('POST', '/auth/reauthenticate', { password: input.value });
          accepted = true;
          dialog.close();
        } catch (failure) {
          submit.disabled = false;
          input.value = '';
          input.focus();
          error.textContent = failure instanceof ApiError && failure.status === 401 ? 'That password isn’t right.'
            : failure instanceof ApiError && failure.status === 429 ? 'Too many tries. Wait a minute, then try again.'
            : 'Could not reach the server. Try again.';
        }
      });
      document.body.append(dialog);
      dialog.showModal();
      input.focus();
    });
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of [].concat(children)) if (child !== null && child !== undefined && child !== false) node.append(child);
    return node;
  }

  function svg(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) if (value !== undefined) node.setAttribute(key, String(value));
    return node;
  }

  /** Small stroke icons (16px grid), drawn as SVG nodes. */
  const ICON_PATHS = {
    up: ['M8 12.5v-9', 'M4 7.5l4-4 4 4'],
    down: ['M8 3.5v9', 'M4 8.5l4 4 4-4'],
    flat: ['M3.5 8h9'],
    search: ['M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M14 14l-3.5-3.5'],
    external: ['M9.5 2.5h4v4', 'M13.5 2.5 7.5 8.5', 'M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3'],
    inbox: ['M2 9.5h3.5l1 2h3l1-2H14', 'M3.5 3.5h9L14 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9.5z'],
    lock: ['M4 7.5h8v6H4z', 'M5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5'],
    users: ['M6 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M1.5 13.5c.6-2.3 2.4-3.5 4.5-3.5s3.9 1.2 4.5 3.5'],
    wifiOff: ['M2 2l12 12', 'M8 12.5v.01', 'M5.5 10a3.5 3.5 0 0 1 5 0'],
  };
  function icon(name) {
    const node = svg('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    for (const d of ICON_PATHS[name]) node.append(svg('path', { d }));
    return node;
  }

  const numberFormat = new Intl.NumberFormat();
  const compactFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
  function formatNumber(value) {
    if (value === null || value === undefined) return '—';
    return Math.abs(value) >= 10_000 ? compactFormat.format(value) : numberFormat.format(value);
  }
  function percent(part, whole) {
    return whole > 0 ? Math.round((part / whole) * 100) : null;
  }
  function formatDay(isoDay, month = 'short') {
    return new Date(`${isoDay}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month, timeZone: 'UTC' });
  }
  function formatRelative(ms) {
    if (!ms) return null;
    const seconds = Math.round((Date.now() - ms) / 1000);
    if (seconds < 90) return 'Just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days}d ago`;
    return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function timeEl(ms, fallback = '—') {
    const text = formatRelative(ms);
    if (!text) return document.createTextNode(fallback);
    return el('time', { datetime: new Date(ms).toISOString(), title: new Date(ms).toLocaleString(), text });
  }
  function sum(values) {
    return values.reduce((total, value) => total + (value ?? 0), 0);
  }

  function hashHue(text) {
    let hash = 0;
    for (const char of text) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    return String(hash % 6);
  }
  function initials(name) {
    const parts = String(name || '?').replace(/^@/, '').trim().split(/[\s._-]+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[1][0] : parts[0]?.[1] ?? '')).toUpperCase();
  }
  function avatar(name, key) {
    return el('span', { class: 'avatar', dataset: { hue: hashHue(key || name) }, 'aria-hidden': 'true', text: initials(name) });
  }
  function person(name, sub, key, { link = true } = {}) {
    const content = [
      avatar(name, key),
      el('div', { class: 'person-text' }, [
        el('div', { class: 'person-name', text: name }),
        sub ? el('div', { class: 'person-sub', text: sub }) : null,
      ]),
    ];
    // Anyone who can look riders up can open the rider's page from here.
    const canOpen = link && typeof key === 'string' && /^rider_[A-Za-z0-9_-]+$/.test(key) && allowed('view_riders');
    return canOpen
      ? el('a', { class: 'person person-link', href: `#rider/${key}`, dataset: { riderLink: key } }, content)
      : el('div', { class: 'person' }, content);
  }
  function badge(text, tone, plain = false) {
    return el('span', { class: plain ? 'badge plain' : 'badge', dataset: tone ? { tone } : {}, text });
  }

  /** Change badge: good/bad colour depends on whether up is good. */
  function deltaBadge(current, previous, { lowerIsBetter = false } = {}) {
    if (previous === null || previous === undefined) return null;
    let tone = 'neutral';
    let label;
    let direction = 'flat';
    if (previous === 0 && current === 0) label = '0%';
    else if (previous === 0) { label = 'New'; direction = 'up'; }
    else {
      const change = ((current - previous) / previous) * 100;
      const rounded = Math.abs(change) >= 10 ? Math.round(change) : Math.round(change * 10) / 10;
      label = `${rounded > 0 ? '+' : ''}${rounded}%`;
      direction = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
    }
    if (direction !== 'flat') tone = (direction === 'up') !== lowerIsBetter ? 'good' : 'bad';
    const node = el('span', { class: 'delta', dataset: { tone } }, [icon(direction), label]);
    node.setAttribute('aria-label', `${label} versus the previous period`);
    return node;
  }

  function setBusy(busy) {
    pageEl.setAttribute('aria-busy', String(busy));
    refreshMobile.setAttribute('aria-busy', String(busy));
    for (const button of pageEl.querySelectorAll('[data-refresh]')) button.setAttribute('aria-busy', String(busy));
  }

  // ------------------------------------------------------------ Charts

  /** Splits a series into runs of consecutive non-null points. */
  function runs(points) {
    const out = [];
    let current = [];
    for (const point of points) {
      if (point.value === null) { if (current.length) out.push(current); current = []; } else current.push(point);
    }
    if (current.length) out.push(current);
    return out;
  }
  function linePath(points) {
    return points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  }
  function niceMax(max) {
    if (max <= 4) return 4;
    const magnitude = 10 ** Math.floor(Math.log10(max / 4));
    return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * magnitude).find((candidate) => candidate * 4 >= max) * 4;
  }
  function gradient(defs, id, opacityTop) {
    const grad = svg('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(
      // Colour comes from CSS (.grad-stop): presentation attributes can't read custom properties.
      svg('stop', { class: 'grad-stop', offset: '0%', 'stop-opacity': opacityTop }),
      svg('stop', { class: 'grad-stop', offset: '100%', 'stop-opacity': 0 }),
    );
    defs.append(grad);
  }

  function sparkline(values) {
    const node = svg('svg', { class: 'kpi-spark', viewBox: '0 0 100 36', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    const tracked = values.filter((v) => v !== null);
    if (tracked.length < 2) return node;
    // Scaled to the series' own range (not from zero) so movement is visible.
    const max = Math.max(...tracked);
    const min = Math.min(...tracked);
    const span = max - min || 1;
    const id = `spark${chartSeq += 1}`;
    const defs = svg('defs');
    gradient(defs, id, 0.18);
    node.append(defs);
    const step = 100 / (values.length - 1);
    const points = values.map((value, i) => ({ x: i * step, y: value === null ? null : 32 - ((value - min) / span) * 24, value }));
    for (const run of runs(points)) {
      if (run.length < 2) continue;
      node.append(svg('path', { class: 'chart-area', fill: `url(#${id})`, d: `${linePath(run)} L${run.at(-1).x},36 L${run[0].x},36 Z` }));
      node.append(svg('path', { class: 'chart-line', d: linePath(run) }));
    }
    return node;
  }

  /**
   * Daily area chart for the selected period, with the previous period as a
   * dashed comparison line, today's incomplete value dashed, gaps (untracked
   * days) left as gaps, a hover/keyboard crosshair and a table view.
   */
  function average(values) {
    const tracked = values.filter((v) => v !== null);
    return tracked.length ? Math.round(sum(tracked) / tracked.length) : null;
  }

  function areaChart({ title, days, values, previous, unit, emptyNote, aggregate = 'sum' }) {
    const card = el('section', { class: 'card chart-card', 'aria-label': title });
    // Daily counts of distinct riders can't be added up across days (the
    // same rider is counted every day), so those charts headline an average.
    const combine = aggregate === 'average' ? average : sum;
    const total = combine(values);
    const tracked = values.some((v) => v !== null);
    const previousTotal = previous && previous.some((v) => v !== null) ? combine(previous) : null;
    card.append(el('div', { class: 'card-header' }, [
      el('div', {}, [
        el('h3', { class: 'card-title', text: title }),
        el('div', { class: 'chart-figure' }, [
          el('span', { class: 'chart-total', text: tracked ? formatNumber(total) : '—' }),
          tracked && previousTotal !== null ? deltaBadge(total, previousTotal) : null,
        ]),
        el('p', { class: 'card-description', text: aggregate === 'average' ? `${unit}, daily average over the last ${days.length} days` : `${unit} in the last ${days.length} days` }),
      ]),
    ]));
    const body = el('div', { class: 'chart-body' });
    const plot = svg('svg', { class: 'chart-svg', role: 'img', tabindex: 0, 'aria-label': `${title}. Use the left and right arrow keys to read daily values, or open the table.` });
    const tooltip = el('div', { class: 'tooltip', role: 'status', hidden: true });
    body.append(plot, tooltip);
    if (!tracked && emptyNote) body.append(el('div', { class: 'chart-empty' }, [el('p', { text: emptyNote })]));
    card.append(body);

    const tableWrap = el('div', { class: 'table-scroll', hidden: true });
    const toggle = el('button', { type: 'button', class: 'chart-table-toggle', 'aria-expanded': 'false', text: 'View as table' });
    toggle.addEventListener('click', () => {
      tableWrap.hidden = !tableWrap.hidden;
      toggle.setAttribute('aria-expanded', String(!tableWrap.hidden));
      toggle.textContent = tableWrap.hidden ? 'View as table' : 'Hide table';
    });
    card.append(el('div', { class: 'chart-legend' }, [
      el('span', { class: 'legend-key', text: 'This period' }),
      previousTotal !== null ? el('span', { class: 'legend-key compare', text: 'Previous period' }) : null,
      el('span', { class: 'legend-key partial', text: 'Today (so far)' }),
      toggle,
    ]));
    tableWrap.append(el('table', { class: 'table' }, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'Day (UTC)' }), el('th', { class: 'num', text: 'This period' }), previous ? el('th', { class: 'num', text: 'Previous period' }) : null])]),
      el('tbody', {}, days.map((day, i) => el('tr', {}, [
        el('td', { text: formatDay(day, 'long') }),
        el('td', { class: 'num', text: values[i] === null ? 'Not tracked' : numberFormat.format(values[i]) }),
        previous ? el('td', { class: 'num', text: previous[i] === null ? '—' : numberFormat.format(previous[i]) }) : null,
      ])).reverse()),
    ]));
    card.append(tableWrap);

    let active = null;
    const draw = () => {
      plot.replaceChildren();
      const width = Math.max(plot.getBoundingClientRect().width || 320, 220);
      const height = Math.max(plot.getBoundingClientRect().height || 190, 150);
      const pad = { top: 8, right: 36, bottom: 22, left: 4 };
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;
      plot.setAttribute('viewBox', `0 0 ${width} ${height}`);
      const all = [...values, ...(previous ?? [])].filter((v) => v !== null);
      const max = niceMax(Math.max(0, ...all));
      const x = (i) => pad.left + (days.length === 1 ? plotW / 2 : (i / (days.length - 1)) * plotW);
      const y = (v) => pad.top + plotH - (v / max) * plotH;
      const id = `area${chartSeq += 1}`;
      const defs = svg('defs');
      gradient(defs, id, 0.22);
      plot.append(defs);

      for (const tick of [max, max / 2]) {
        plot.append(svg('line', { class: 'chart-grid', x1: pad.left, x2: pad.left + plotW, y1: y(tick), y2: y(tick) }));
        const label = svg('text', { class: 'chart-tick', x: width - 2, y: y(tick) + 4, 'text-anchor': 'end' });
        label.textContent = formatNumber(tick);
        plot.append(label);
      }
      plot.append(svg('line', { class: 'chart-baseline', x1: pad.left, x2: pad.left + plotW, y1: y(0), y2: y(0) }));
      const zero = svg('text', { class: 'chart-tick', x: width - 2, y: y(0) + 4, 'text-anchor': 'end' });
      zero.textContent = '0';
      plot.append(zero);

      // Untracked stretch before collection began.
      const firstTracked = values.findIndex((v) => v !== null);
      if (firstTracked > 0) {
        plot.append(svg('rect', { class: 'chart-untracked', x: pad.left, y: pad.top, width: x(firstTracked) - pad.left, height: plotH, rx: 4 }));
      }

      // Evenly spaced date labels, at least ~72px apart, always ending on the last day.
      const maxLabels = Math.max(2, Math.min(6, Math.floor(plotW / 72)));
      const stride = Math.max(1, Math.ceil((days.length - 1) / (maxLabels - 1)));
      const labelIdx = [];
      for (let i = days.length - 1; i >= 0; i -= stride) labelIdx.unshift(i);
      for (const i of labelIdx) {
        const label = svg('text', { class: 'chart-tick', x: x(i), y: height - 4, 'text-anchor': i === days.length - 1 ? 'end' : i === labelIdx[0] && x(i) - pad.left < 24 ? 'start' : 'middle' });
        label.textContent = formatDay(days[i]);
        plot.append(label);
      }

      if (previous) {
        const prevPoints = previous.map((v, i) => ({ x: x(i), y: v === null ? 0 : y(v), value: v }));
        for (const run of runs(prevPoints)) if (run.length > 1) plot.append(svg('path', { class: 'chart-compare', d: linePath(run) }));
      }
      const points = values.map((v, i) => ({ x: x(i), y: v === null ? 0 : y(v), value: v }));
      const lastIndex = points.length - 1;
      for (const run of runs(points)) {
        const complete = run.at(-1) === points[lastIndex] && run.length > 1 ? run.slice(0, -1) : run;
        if (run.length > 1) plot.append(svg('path', { class: 'chart-area', fill: `url(#${id})`, d: `${linePath(run)} L${run.at(-1).x},${y(0)} L${run[0].x},${y(0)} Z` }));
        if (complete.length > 1) plot.append(svg('path', { class: 'chart-line', d: linePath(complete) }));
        if (complete !== run) plot.append(svg('path', { class: 'chart-line partial', d: linePath(run.slice(-2)) }));
        if (run.length === 1) plot.append(svg('circle', { class: 'chart-dot', cx: run[0].x, cy: run[0].y, r: 3 }));
      }

      const cursor = svg('line', { class: 'chart-cursor', y1: pad.top, y2: pad.top + plotH, visibility: 'hidden' });
      const dot = svg('circle', { class: 'chart-dot', r: 4, visibility: 'hidden' });
      plot.append(cursor, dot);
      const overlay = svg('rect', { x: pad.left, y: 0, width: plotW, height, fill: 'transparent' });
      plot.append(overlay);

      const show = (i) => {
        active = i;
        cursor.setAttribute('x1', x(i));
        cursor.setAttribute('x2', x(i));
        cursor.setAttribute('visibility', 'visible');
        if (values[i] !== null) {
          dot.setAttribute('cx', x(i));
          dot.setAttribute('cy', y(values[i]));
          dot.setAttribute('visibility', 'visible');
        } else dot.setAttribute('visibility', 'hidden');
        const isToday = i === lastIndex;
        tooltip.replaceChildren(
          el('div', { class: 'tooltip-date', text: `${formatDay(days[i], 'long')}${isToday ? ' · so far' : ''}` }),
          el('div', { class: 'tooltip-row' }, [el('span', { class: 'key' }), el('span', { class: 'label', text: 'This period' }), el('span', { class: 'value', text: values[i] === null ? 'Not tracked yet' : numberFormat.format(values[i]) })]),
          previous ? el('div', { class: 'tooltip-row' }, [el('span', { class: 'key compare' }), el('span', { class: 'label', text: 'Previous' }), el('span', { class: 'value', text: previous[i] === null ? '—' : numberFormat.format(previous[i]) })]) : null,
        );
        tooltip.hidden = false;
        const box = plot.getBoundingClientRect();
        const bodyBox = body.getBoundingClientRect();
        const scale = box.width / width;
        const px = box.left - bodyBox.left + x(i) * scale;
        const tw = tooltip.offsetWidth;
        const left = px + 12 + tw > bodyBox.width ? px - 12 - tw : px + 12;
        tooltip.style.left = `${Math.max(0, left)}px`;
        tooltip.style.top = `${box.top - bodyBox.top + 4}px`;
      };
      const hide = () => {
        active = null;
        cursor.setAttribute('visibility', 'hidden');
        dot.setAttribute('visibility', 'hidden');
        tooltip.hidden = true;
      };
      const indexAt = (clientX) => {
        const box = plot.getBoundingClientRect();
        const local = ((clientX - box.left) / box.width) * width;
        return Math.min(days.length - 1, Math.max(0, Math.round(((local - pad.left) / plotW) * (days.length - 1))));
      };
      overlay.addEventListener('pointermove', (event) => show(indexAt(event.clientX)));
      overlay.addEventListener('pointerdown', (event) => show(indexAt(event.clientX)));
      overlay.addEventListener('pointerleave', hide);
      plot.onkeydown = (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const next = active === null ? lastIndex : Math.min(lastIndex, Math.max(0, active + (event.key === 'ArrowRight' ? 1 : -1)));
        show(next);
      };
      plot.onblur = hide;
      // Keyboard reading always starts from the latest day.
      plot.onfocus = () => { active = null; };
    };
    card.redraw = draw;
    return card;
  }

  // ------------------------------------------------------------ Page chrome

  function pageHeader(title, subtitle, actions = []) {
    const refresh = el('button', { type: 'button', class: 'button desktop-refresh', dataset: { refresh: '' }, text: 'Refresh' });
    refresh.addEventListener('click', () => void render());
    return el('div', { class: 'page-header' }, [
      el('div', { class: 'page-heading' }, [
        el('span', { class: 'page-eyebrow' }, [
          el('span', { class: 'page-eyebrow-dot', 'aria-hidden': 'true' }),
          el('span', { text: 'Operations hub' }),
        ]),
        el('h1', { class: 'page-title', tabindex: '-1', text: title }),
        subtitle ? el('p', { class: 'page-subtitle', text: subtitle }) : null,
      ]),
      el('div', { class: 'actions' }, [...actions, refresh]),
    ]);
  }

  function segmented(options, value, onChange, label) {
    const group = el('div', { class: 'segmented', role: 'group', 'aria-label': label });
    for (const [id, text] of options) {
      const button = el('button', { type: 'button', 'aria-pressed': String(id === value), text });
      button.addEventListener('click', () => { if (id !== value) onChange(id); });
      group.append(button);
    }
    return el('div', { class: 'scroll-row' }, [group]);
  }

  function emptyState(iconName, title, text) {
    return el('div', { class: 'empty' }, [icon(iconName), el('p', { class: 'empty-title', text: title }), text ? el('p', { class: 'empty-text', text }) : null]);
  }

  function skeletonOverview() {
    const kpi = () => el('div', { class: 'card kpi' }, [el('div', { class: 'skeleton sk-label' }), el('div', { class: 'skeleton sk-value' }), el('div', { class: 'skeleton sk-foot' })]);
    return [
      pageHeader('Overview', 'Loading…'),
      el('div', { class: 'kpis' }, Array.from({ length: 8 }, kpi)),
      el('h2', { class: 'section-title', text: 'Trends' }),
      el('div', { class: 'charts' }, Array.from({ length: 2 }, () => el('div', { class: 'card' }, [el('div', { class: 'skeleton sk-chart' })]))),
    ];
  }

  function skeletonList() {
    return [el('div', { class: 'card' }, Array.from({ length: 5 }, () => el('div', { class: 'list-row' }, [
      el('div', { class: 'skeleton avatar' }), el('div', {}, [el('div', { class: 'skeleton sk-label' }), el('div', { class: 'skeleton sk-foot' })]),
    ])))];
  }

  // ------------------------------------------------------------ Overview

  function kpiCard({ label, value, delta, foot, spark }) {
    return el('div', { class: 'card kpi' }, [
      el('div', { class: 'kpi-top' }, [el('span', { class: 'kpi-label', text: label })]),
      el('div', { class: 'kpi-value-row' }, [el('div', { class: 'kpi-value', text: value }), delta]),
      el('div', { class: 'kpi-foot' }, [].concat(foot ?? '')),
      spark ?? el('div', { class: 'kpi-spacer' }),
    ]);
  }

  /** Signed up → verified → first ride → came back, for one sign-up cohort. */
  function funnelCard(funnel) {
    const steps = [
      ['Signed up', funnel.signedUp],
      ['Verified email', funnel.verified],
      ['First ride or Nearby', funnel.firstRide],
      ['Came back after a week', funnel.returned],
    ];
    const cohort = `Riders who signed up ${formatDay(new Date(funnel.cohortStart).toISOString().slice(0, 10))} – ${formatDay(new Date(funnel.cohortEnd).toISOString().slice(0, 10))}`;
    const header = el('div', { class: 'card-header' }, [el('div', {}, [
      el('h3', { class: 'card-title', text: 'Activation' }),
      el('p', { class: 'card-description', text: cohort }),
    ])]);
    if (funnel.signedUp === 0) {
      return el('section', { class: 'card funnel' }, [header, el('p', { class: 'funnel-empty', text: 'No sign-ups in this window yet.' })]);
    }
    const rows = steps.map(([name, value], i) => {
      const share = percent(value, funnel.signedUp) ?? 0;
      const fill = el('span', { class: 'funnel-fill' });
      // CSSOM rather than a style attribute: the page's CSP forbids inline styles.
      fill.style.width = `${Math.max(share, value > 0 ? 1 : 0)}%`;
      const step = i === 0 ? null : percent(value, steps[i - 1][1]);
      return el('li', { class: 'funnel-step' }, [
        el('div', { class: 'funnel-label' }, [
          el('span', { class: 'stat-name', text: name }),
          el('span', { class: 'stat-value', text: `${formatNumber(value)} · ${share}%` }),
        ]),
        el('div', { class: 'funnel-track', role: 'presentation' }, [fill]),
        step === null ? null : el('span', { class: 'funnel-step-rate', text: `${step}% of the step before` }),
      ]);
    });
    const undercount = funnel.rideTrackingSince && funnel.rideTrackingSince > funnel.cohortStart
      ? el('p', { class: 'funnel-note', text: `First rides are counted from ${formatDay(new Date(funnel.rideTrackingSince).toISOString().slice(0, 10))}, so earlier sign-ups may show too few.` })
      : null;
    return el('section', { class: 'card funnel' }, [header, el('ol', { class: 'funnel-steps' }, rows), undercount]);
  }


  /** Operational shortcuts are grounded in /admin/overview, not mock inbox data. */
  function operationsSummary({ riders, activity, safety }) {
    const card = ({ label, value, description, destination, action, attention = false }) => {
      const children = [
        el('div', { class: 'operation-label', text: label }),
        el('strong', { class: 'operation-value', text: String(value) }),
        el('p', { class: 'operation-description', text: description }),
      ];
      if (destination && allowed(VIEW_PERMISSIONS[destination])) {
        const button = el('button', { type: 'button', class: 'button', text: action });
        button.addEventListener('click', () => selectView(destination));
        children.push(button);
      }
      return el('div', { class: 'operation-card', dataset: { attention: String(attention) } }, children);
    };
    return el('section', { class: 'operations-summary', 'aria-label': 'Operations at a glance' }, [
      el('h2', { class: 'section-title', text: 'Operations at a glance' }),
      el('p', { class: 'operations-lead', text: 'Current activity and next steps, based on the latest dashboard snapshot.' }),
      el('div', { class: 'operations-grid' }, [
        card({ label: 'Reports awaiting review', value: formatNumber(safety.openReports),
          description: 'Open rider reports requiring a moderation decision.', destination: 'moderation', action: 'Review reports', attention: safety.openReports > 0 }),
        card({ label: 'New riders today', value: formatNumber(riders.newToday),
          description: 'New sign-ups recorded today.', destination: 'riders', action: 'Find riders' }),
        card({ label: 'Rides in progress', value: formatNumber(activity.activeRides),
          description: 'Active group rides. No private locations are displayed.' }),
        card({ label: 'Platform diagnostics', value: 'System',
          description: 'Inspect backend health, integrations and request metrics.', destination: 'system', action: 'View system' }),
      ]),
    ]);
  }

  function renderOverview(data) {
    const days = period;
    const { riders, activity, social, content, safety, series, previous } = data;
    const slice = (values) => values.slice(-days);
    const prior = (values) => values.slice(-2 * days, -days);
    const newRiders = days === 7 ? riders.new7d : riders.new30d;
    const newPrev = days === 7 ? previous.new7d : previous.new30d;
    const messages = days === 7 ? social.messages7d : social.messages30d;
    const messagesPrev = days === 7 ? previous.messages7d : previous.messages30d;
    const active = days === 7 ? activity.active7d : activity.active30d;
    const ridesSeries = slice(series.ridesStarted);
    const ridesTracked = ridesSeries.some((v) => v !== null);
    const verifiedPct = percent(riders.verified, riders.total);
    const stickiness = percent(activity.active24h, activity.active30d);
    const periodText = `vs previous ${days} days`;

    const reportsLink = safety.openReports > 0 && allowed('moderate') ? el('a', { href: '#moderation', text: 'Review queue' }) : null;
    const kpis = el('div', { class: 'kpis' }, [
      kpiCard({ label: 'New riders', value: formatNumber(newRiders), delta: deltaBadge(newRiders, newPrev), foot: periodText, spark: sparkline(slice(series.signups)) }),
      kpiCard({ label: 'Active riders', value: formatNumber(active), foot: `${percent(active, riders.total) ?? 0}% of all riders`, spark: sparkline(slice(series.activeRiders)) }),
      kpiCard({ label: 'Messages sent', value: formatNumber(messages), delta: deltaBadge(messages, messagesPrev), foot: periodText, spark: sparkline(slice(series.messages)) }),
      kpiCard({ label: 'Rides started', value: ridesTracked ? formatNumber(sum(ridesSeries)) : '—', foot: ridesTracked ? `Last ${days} days` : 'Tracking starts with the next ride', spark: sparkline(ridesSeries) }),
      kpiCard({ label: 'Total riders', value: formatNumber(riders.total), foot: `${verifiedPct ?? 0}% verified · ${formatNumber(riders.suspended)} suspended` }),
      kpiCard({ label: 'Live now', value: formatNumber(activity.liveNearbyNow), foot: `On Nearby · ${formatNumber(activity.activeRides)} rides in progress` }),
      kpiCard({ label: 'Stickiness', value: stickiness === null ? '—' : `${stickiness}%`, foot: 'Daily ÷ monthly active riders' }),
      kpiCard({
        label: 'Open reports',
        value: formatNumber(safety.openReports),
        delta: days === 7 ? deltaBadge(safety.reports7d, previous.reports7d, { lowerIsBetter: true }) : null,
        foot: reportsLink ? [reportsLink, ` · ${formatNumber(safety.reports7d)} filed this week`] : `${formatNumber(safety.reports7d)} filed this week`,
      }),
    ]);

    const charts = [
      areaChart({ title: 'New riders', days: slice(series.days), values: slice(series.signups), previous: prior(series.signups), unit: 'Sign-ups' }),
      areaChart({ title: 'Active riders', days: slice(series.days), values: slice(series.activeRiders), previous: prior(series.activeRiders), unit: 'Riders active', aggregate: 'average', emptyNote: 'Not tracked yet. Daily counts start from the next snapshot.' }),
      areaChart({ title: 'Messages', days: slice(series.days), values: slice(series.messages), previous: prior(series.messages), unit: 'Direct messages' }),
      areaChart({ title: 'Rides started', days: slice(series.days), values: ridesSeries, previous: prior(series.ridesStarted), unit: 'Group rides', emptyNote: 'Not tracked yet. Counting starts with the next ride.' }),
    ];

    const statList = (title, description, rows) => el('section', { class: 'card' }, [
      el('div', { class: 'card-header' }, [el('div', {}, [el('h3', { class: 'card-title', text: title }), el('p', { class: 'card-description', text: description })])]),
      el('ul', { class: 'stat-list' }, rows.map(([name, value]) => el('li', {}, [el('span', { class: 'stat-name', text: name }), el('span', { class: 'stat-value', text: value })]))),
    ]);

    const periodControl = segmented([[7, '7 days'], [30, '30 days']], days, (next) => {
      period = next;
      savePeriod(next);
      renderOverview(overviewCache);
      pageEl.querySelector('[aria-label="Period"] [aria-pressed="true"]')?.focus({ preventScroll: true });
    }, 'Period');
    pageEl.replaceChildren(
      pageHeader('Overview', `Updated ${new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · days in UTC`, [periodControl]),
      operationsSummary({ riders, activity, safety }),
      kpis,
      el('h2', { class: 'section-title', text: 'Trends' }),
      el('div', { class: 'charts' }, charts),
      el('h2', { class: 'section-title', text: 'Growth' }),
      funnelCard(data.funnel),
      el('h2', { class: 'section-title', text: 'Community and safety' }),
      el('div', { class: 'panels' }, [
        statList('Community', 'Totals across all riders', [
          ['Friendships', formatNumber(social.friendships)],
          ['Pending friend requests', formatNumber(social.pendingFriendRequests)],
          ['Messages today', formatNumber(social.messages24h)],
          ['Location sharing on', formatNumber(activity.sharingLocation)],
          ['Riders in a ride now', formatNumber(activity.ridersInRides)],
        ]),
        statList('Safety and content', 'Moderation workload and shared places', [
          ['Open reports', formatNumber(safety.openReports)],
          ['Moderation decisions this week', formatNumber(safety.moderationActions7d)],
          ['Blocked by the content filter this week', formatNumber(safety.filterRejections7d ?? 0)],
          ['Active hazard reports', formatNumber(content.activeHazards)],
          ['Scenic routes', formatNumber(content.scenicRoutes)],
          ['Hideouts', formatNumber(content.hideouts)],
        ]),
      ]),
    );
    requestAnimationFrame(() => { for (const chart of charts) chart.redraw(); });
  }

  // ------------------------------------------------------------ Riders

  function riderBadges(rider) {
    return el('div', { class: 'badges' }, [
      rider.suspended ? badge('Suspended', 'danger') : null,
      rider.staffRole ? badge(ROLE_LABELS[rider.staffRole] || rider.staffRole, ROLE_TONES[rider.staffRole]) : rider.isAdmin ? badge('Admin', 'accent') : null,
      rider.emailVerified ? null : badge('Unverified', 'warning'),
      !rider.suspended && rider.emailVerified ? badge('Active', 'success') : null,
    ]);
  }

  // Until account emails can be delivered (Resend needs a verified domain),
  // staff can verify riders they know. The note goes in the audit log.
  function verifyEmailButton(rider) {
    if (rider.emailVerified || !allowed('verify_email')) return null;
    const button = el('button', { type: 'button', class: 'button button-small', dataset: { action: 'verify-email' }, text: 'Verify email', 'aria-label': `Mark ${rider.username}'s email verified` });
    button.addEventListener('click', async () => {
      const choice = await actionDialog({
        title: `Mark ${rider.username}’s email verified?`,
        description: 'Only verify an email address after confirming the rider’s identity.',
        confirmLabel: 'Mark verified',
        templates: ['Known rider; verification email not delivered.'],
      });
      if (!choice) return;
      button.disabled = true;
      try {
        await api('POST', `/moderation/riders/${encodeURIComponent(rider.riderId)}/verify-email`, { note: choice.note });
        await render();
        flash('Email verified.');
      } catch (error) {
        button.disabled = false;
        flash(error instanceof ApiError && error.code === 'already_verified' ? 'This rider is already verified.' : actionErrorMessage(error), 'danger');
      }
    });
    return button;
  }

  // Answering a data access request: admins download everything held about
  // a rider. Needs a reason, which goes in the audit log.
  function exportButton(rider) {
    if (!allowed('manage_staff')) return null;
    const button = el('button', { type: 'button', class: 'button button-small', dataset: { action: 'export-data' }, text: 'Export data', 'aria-label': `Export ${rider.username}'s data` });
    button.addEventListener('click', async () => {
      const choice = await actionDialog({
        title: `Export ${rider.username}’s account data?`,
        description: 'For a verified access request only. This download contains personal data; store and share it securely.',
        confirmLabel: 'Export',
      });
      if (!choice) return;
      button.disabled = true;
      try {
        const data = await api('POST', `/admin/riders/${encodeURIComponent(rider.riderId)}/export`, { note: choice.note });
        downloadJson(data, `rider-comms-data-${rider.riderId}-${new Date().toISOString().slice(0, 10)}.json`);
        flash('Data export downloaded.');
      } catch (error) {
        flash(actionErrorMessage(error), 'danger');
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  /** Keep keyboard focus with the control that triggered a rerender, unless superseded. */
  function renderAndFocus(selector) {
    const completion = render();
    const generation = renderGeneration;
    void completion.then(() => {
      if (isCurrentRender(generation)) pageEl.querySelector(selector)?.focus({ preventScroll: true });
    });
  }

  function renderRiders(riders) {
    const form = el('form', { class: 'toolbar', role: 'search' });
    const input = el('input', { class: 'input', type: 'search', name: 'q', placeholder: 'Search name, username, email or ID', 'aria-label': 'Search riders', maxlength: 100, autocomplete: 'off' });
    input.value = riderQuery;
    form.append(el('div', { class: 'search' }, [icon('search'), input]), el('button', { type: 'submit', class: 'button', text: 'Search' }));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      riderQuery = input.value.trim();
      renderAndFocus('input[aria-label="Search riders"]');
    });

    const displayName = (rider) => rider.displayName || rider.username;
    const content = riders.length === 0
      ? el('div', { class: 'card' }, [emptyState('users', 'No riders found', riderQuery ? `Nothing matches “${riderQuery}”. Try a username, email or rider ID.` : 'Riders appear here once they sign up.')])
      : [
        el('div', { class: 'card only-mobile' }, [el('ul', { class: 'list' }, riders.map((rider) => el('li', { class: 'list-row', dataset: { riderId: rider.riderId } }, [
          person(displayName(rider), [rider.handle, rider.email].filter(Boolean).join(' · '), rider.riderId),
          el('div', { class: 'trail' }, [riderBadges(rider), verifyEmailButton(rider), exportButton(rider), el('div', {}, [timeEl(rider.lastSeenAt, 'Inactive')])]),
        ])))]),
        el('div', { class: 'card table-card only-desktop' }, [el('div', { class: 'table-scroll' }, [el('table', { class: 'table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'Rider' }), el('th', { text: 'Email' }), el('th', { text: 'Status' }),
            el('th', { text: 'Joined' }), el('th', { text: 'Last active' }), el('th', { class: 'num', text: 'Friends' }), el('th', { class: 'num', text: 'Reports' }),
          ])]),
          el('tbody', {}, riders.map((rider) => el('tr', { dataset: { riderId: rider.riderId } }, [
            el('td', {}, [person(displayName(rider), [rider.handle, rider.riderId].filter(Boolean).join(' · '), rider.riderId)]),
            el('td', { class: 'muted', text: rider.email || '—' }),
            el('td', {}, [riderBadges(rider), verifyEmailButton(rider), exportButton(rider)]),
            el('td', { class: 'muted' }, [timeEl(rider.createdAt)]),
            el('td', { class: 'muted' }, [timeEl(rider.lastSeenAt, 'Over 30 days')]),
            el('td', { class: 'num', text: numberFormat.format(rider.friends) }),
            el('td', { class: 'num', text: numberFormat.format(rider.reportsAgainst) }),
          ]))),
        ])])]),
      ];
    pageEl.replaceChildren(
      pageHeader('Riders', riderQuery ? `${riders.length} ${riders.length === 1 ? 'match' : 'matches'} for “${riderQuery}”` : `Newest ${riders.length} riders`),
      form,
      ...[].concat(content),
    );
  }

  // ------------------------------------------------------------ Moderation

  function riderLabel(riderId) {
    if (riderId && riderId === session.riderId) return { name: 'You', sub: riderId };
    const profile = names.get(riderId);
    return profile ? { name: profile.displayName || 'Rider', sub: `${profile.handle ?? ''} · ${riderId}` } : { name: riderId, sub: null };
  }

  async function loadNames(riderIds) {
    const missing = [...new Set(riderIds)].filter((id) => id && id !== session.riderId && !names.has(id));
    for (let i = 0; i < missing.length; i += 50) {
      try {
        const { profiles } = await api('POST', '/profiles/batch', { riderIds: missing.slice(i, i + 50) });
        for (const [id, profile] of Object.entries(profiles || {})) names.set(id, profile);
      } catch { /* Fall back to showing rider IDs. */ }
    }
  }

  function actionErrorMessage(error) {
    if (!(error instanceof ApiError)) return 'Could not reach the server. Try again.';
    if (error.code === 'already_resolved') return 'Someone already resolved this report. Refresh to see the latest queue.';
    if (error.code === 'assigned_to_other') return 'This case has another owner. Ask an administrator to transfer it.';
    if (error.code === 'invalid_assignee') return 'Only active moderators or administrators can own a case.';
    if (error.code === 'unchanged') return 'Ownership is already up to date. Refresh to see the current case.';
    if (error.code === 'forbidden_target') return 'You cannot suspend yourself or another admin.';
    if (error.code === 'not_suspended') return 'This rider is not suspended.';
    if (error.code === 'already_suspended') return 'This rider is already suspended.';
    if (error.code === 'not_found') return 'That rider no longer exists.';
    if (error.code === 'reauth_cancelled') return 'Not changed: your password is needed for staff changes.';
    if (error.status === 403) return 'Your account is no longer staff.';
    return `Failed: ${error.code || error.message}`;
  }

  /** Accessible confirmation for destructive actions without a browser prompt. */
  function confirmAction({ title, description, confirmLabel, danger = false }) {
    return new Promise((resolve) => {
      const dialog = el('dialog', { class: 'dialog', 'aria-labelledby': 'confirmActionTitle' });
      const cancel = el('button', { type: 'button', class: 'button', text: 'Cancel' });
      const accept = el('button', { type: 'button', class: danger ? 'button button-danger' : 'button button-primary', text: confirmLabel });
      dialog.append(el('div', { class: 'dialog-body' }, [
        el('h2', { id: 'confirmActionTitle', class: 'card-title', text: title }),
        el('p', { class: 'card-description', text: description }),
        el('div', { class: 'actions' }, [cancel, accept]),
      ]));
      let confirmed = false;
      cancel.addEventListener('click', () => dialog.close());
      accept.addEventListener('click', () => { confirmed = true; dialog.close(); });
      dialog.addEventListener('close', () => { dialog.remove(); resolve(confirmed); });
      document.body.append(dialog);
      dialog.showModal();
      cancel.focus();
    });
  }

  function wireAction(card, button, note, run) {
    button.addEventListener('click', async () => {
      const text = note.value.trim();
      const errorEl = card.querySelector('.error-text');
      if (!text) {
        errorEl.textContent = 'Write a note first. Every decision is recorded with its reason.';
        note.focus();
        return;
      }
      if (button.dataset.action === 'suspend' && !(await confirmAction({
        title: 'Suspend this rider?',
        description: 'They are signed out everywhere and cannot sign in until the suspension ends or staff unsuspend them.',
        confirmLabel: 'Suspend rider',
        danger: true,
      }))) return;
      if (button.dataset.action === 'remove' && !(await confirmAction({
        title: 'Remove this Social post?',
        description: 'The post and its media will be removed for everyone. This cannot be undone.',
        confirmLabel: 'Remove post',
        danger: true,
      }))) return;
      for (const other of card.querySelectorAll('button')) other.disabled = true;
      errorEl.textContent = '';
      try {
        await run(text);
        await render();
      } catch (error) {
        errorEl.textContent = actionErrorMessage(error);
        for (const other of card.querySelectorAll('button')) other.disabled = false;
      }
    });
  }

  function personBlock(role, riderId) {
    const { name, sub } = riderLabel(riderId);
    return el('div', {}, [el('div', { class: 'role', text: role }), person(name, sub, riderId)]);
  }

  /** Apps prefix report details with "Reported from <where>"; show that as a badge. */
  function splitReportSource(details) {
    const match = /^Reported from ([^.\n]{1,80})\.?\s*/.exec(details || '');
    if (!match) return { source: null, details: details || '' };
    return { source: match[1], details: details.slice(match[0].length) };
  }

  /** How long an open report has waited; amber after 4 hours, red after a day. */
  function waitingBadge(createdAt) {
    const hours = (Date.now() - createdAt) / 3_600_000;
    const text = hours < 1 ? 'Waiting under an hour' : hours < 48 ? `Waiting ${Math.floor(hours)}h` : `Waiting ${Math.floor(hours / 24)} days`;
    return badge(text, hours >= 24 ? 'danger' : hours >= 4 ? 'warning' : null, hours < 4);
  }

  /** Take a report so other moderators see it's being handled, or let it go. */
  function claimControl(report) {
    const mine = report.claimedBy === session.riderId;
    if (report.claimedBy && !mine) return badge(`Being handled by ${riderLabel(report.claimedBy).name}`, 'accent');
    const button = el('button', { type: 'button', class: 'button button-small claim', dataset: { action: mine ? 'release' : 'claim' }, text: mine ? 'You’re handling this · Let go' : 'Take this report' });
    button.addEventListener('click', async () => {
      button.disabled = true;
      let failure = null;
      try {
        await api('POST', `/moderation/reports/${encodeURIComponent(report.id)}/claim`, mine ? { release: true } : {});
      } catch (error) {
        failure = error;
      }
      await render();
      if (failure) flash(failure instanceof ApiError && failure.code === 'claimed_by_other'
        ? 'Another moderator is handling this report. The queue has been refreshed.'
        : actionErrorMessage(failure), 'warning');
    });
    return button;
  }

  function reportCard(report) {
    const { source, details } = splitReportSource(report.details);
    const card = el('article', { class: 'card report', dataset: { reportId: report.id } }, [
      el('div', { class: 'report-head' }, [
        el('div', { class: 'badges' }, [
          badge(REASON_LABELS[report.reason] || report.reason, report.status === 'open' ? 'warning' : null),
          source ? badge(`From ${source}`, null, true) : null,
          report.reportsAgainstRider > 1 ? badge(`${report.reportsAgainstRider} reports against this rider`, null, true) : null,
          report.reportedRiderSuspended ? badge(report.reportedRiderSuspendedUntil ? `Suspended until ${formatUntil(report.reportedRiderSuspendedUntil)}` : 'Suspended', 'danger') : null,
          report.status === 'open' ? waitingBadge(report.createdAt) : null,
          report.assignedTo
            ? badge(`Case owner: ${riderLabel(report.assignedTo).name}`, 'accent')
            : (report.status === 'open' ? badge('No permanent owner', null, true) : null),
        ]),
        el('span', { class: 'report-time' }, [timeEl(report.createdAt)]),
      ]),
      el('div', { class: 'report-people' }, [personBlock('Reported rider', report.reportedRiderId), personBlock('Reported by', report.reporterId)]),
      el('p', { class: details ? 'report-details' : 'report-details empty', text: details || 'No details given.' }),
      report.status !== 'open'
        ? el('p', { class: 'report-meta' }, [`${report.status === 'dismissed' ? 'Dismissed' : 'Actioned'} `, timeEl(report.resolvedAt), ` by ${riderLabel(report.resolvedBy).name}`])
        : null,
    ]);
    if (report.status === 'open') card.querySelector('.report-head .badges').append(claimControl(report));
    if (report.status === 'open' || report.reportedRiderSuspended) {
      const note = el('textarea', { class: 'note', maxlength: MAX_NOTE_LENGTH, 'aria-label': `Note for report ${report.id}`, placeholder: 'Note for the audit log (required)' });
      const actions = el('div', { class: 'actions' });
      if (report.status === 'open') {
        const dismiss = el('button', { type: 'button', class: 'button', dataset: { action: 'dismiss' }, text: 'Dismiss' });
        const suspend = el('button', { type: 'button', class: 'button button-danger', dataset: { action: 'suspend' }, text: 'Suspend rider' });
        const length = el('select', { class: 'input select', 'aria-label': `Suspension length for report ${report.id}` }, SUSPENSION_LENGTHS.map(([value, label]) => el('option', { value, text: label, selected: value === '7' })));
        actions.append(dismiss, length, suspend);
        wireAction(card, dismiss, note, (text) => api('POST', `/moderation/reports/${encodeURIComponent(report.id)}/resolve`, { resolution: 'dismiss', note: text }));
        wireAction(card, suspend, note, (text) => api('POST', `/moderation/reports/${encodeURIComponent(report.id)}/resolve`, { resolution: 'suspend', note: text, ...(length.value ? { days: Number(length.value) } : {}) }));
        card.append(el('div', { class: 'chips', role: 'group', 'aria-label': 'Start the note from a reason' }, [...NOTE_TEMPLATES.dismiss, ...NOTE_TEMPLATES.suspend].map((text) => {
          const chip = el('button', { type: 'button', class: 'chip', text });
          chip.addEventListener('click', () => { note.value = text; note.focus(); });
          return chip;
        })));
      }

      if (report.status === 'open') {
        // A persistent owner is different from the expiring 30-minute claim.
        // Transfers performed by admins use the same audited assignment API.
        const mine = report.assignedTo === session.riderId;
        const assignable = !report.assignedTo || mine || allowed('manage_staff');
        if (assignable) {
          const assign = el('button', {
            type: 'button', class: 'button button-small',
            dataset: { action: mine ? 'release-owner' : 'assign-owner' },
            text: mine ? 'Release permanent ownership'
              : report.assignedTo ? 'Take ownership (admin)' : 'Assign permanently to me',
          });
          actions.prepend(assign);
          wireAction(card, assign, note, (text) => api('POST',
            `/moderation/reports/${encodeURIComponent(report.id)}/assign`,
            { assigneeId: mine ? null : session.riderId, note: text }));
        }
      }
      if (report.status === 'open' && allowed('manage_staff')) {
        // Only admins can list staff and transfer cases to a different owner.
        // The backend rechecks both permissions and eligibility at submission.
        const transfer = el('button', { type: 'button', class: 'button button-small',
          'aria-expanded': 'false', dataset: { action: 'handover-owner' }, text: 'Assign to team member' });
        actions.prepend(transfer);
        transfer.addEventListener('click', async () => {
          const existing = card.querySelector('[data-handover-panel]');
          if (existing) {
            existing.remove();
            transfer.setAttribute('aria-expanded', 'false');
            transfer.focus();
            return;
          }
          transfer.disabled = true;
          const errorEl = card.querySelector('.error-text');
          try {
            const response = await api('GET', '/admin/staff');
            // A delayed staff response must never resurrect a panel after navigation.
            if (!card.isConnected) return;
            const eligible = (Array.isArray(response.staff) ? response.staff : [])
              .filter((member) => (member.role === 'admin' || member.role === 'moderator')
                && typeof member.riderId === 'string' && member.riderId !== report.assignedTo);
            const selector = el('select', { class: 'input select',
              'aria-label': `Team member for report ${report.id}` }, [
              el('option', { value: '', text: 'Choose a team member', selected: true }),
              ...eligible.map((member) => el('option', { value: member.riderId,
                text: `${member.displayName || member.handle || member.riderId} · ${ROLE_LABELS[member.role]}` })),
            ]);
            const assign = el('button', { type: 'button', class: 'button button-primary',
              dataset: { action: 'assign-selected-owner' }, text: 'Assign selected member', disabled: true });
            selector.addEventListener('change', () => { assign.disabled = !selector.value; });
            wireAction(card, assign, note, (text) => api('POST',
              `/moderation/reports/${encodeURIComponent(report.id)}/assign`,
              { assigneeId: selector.value, note: text }));
            const cancel = el('button', { type: 'button', class: 'button', text: 'Cancel handover' });
            const panel = el('div', { class: 'case-handover-panel', role: 'group',
              'aria-label': `Staff handover for report ${report.id}`, dataset: { handoverPanel: '' } }, [
              el('strong', { class: 'case-handover-title', text: 'Assign this report to a team member' }),
              el('p', { class: 'case-handover-help',
                text: 'Only moderators and administrators can own reports. Add an audit reason in the note field above. Eligibility is checked again when you save.' }),
              ...(eligible.length
                ? [el('div', { class: 'case-handover-controls' }, [selector, assign, cancel])]
                : [el('p', { class: 'case-handover-help', text: 'No other eligible staff members were returned.' }), cancel]),
            ]);
            actions.before(panel);
            transfer.setAttribute('aria-expanded', 'true');
            cancel.addEventListener('click', () => {
              panel.remove();
              transfer.setAttribute('aria-expanded', 'false');
              transfer.focus();
            });
            if (eligible.length) selector.focus();
            else cancel.focus();
            errorEl.textContent = '';
          } catch (error) {
            if (card.isConnected) errorEl.textContent = `Could not load the team. ${actionErrorMessage(error)}`;
          } finally {
            if (card.isConnected) transfer.disabled = false;
          }
        });
      }
      if (report.reportedRiderSuspended) {
        const unsuspend = el('button', { type: 'button', class: 'button', dataset: { action: 'unsuspend' }, text: 'Unsuspend rider' });
        actions.append(unsuspend);
        wireAction(card, unsuspend, note, (text) => api('POST', `/moderation/riders/${encodeURIComponent(report.reportedRiderId)}/unsuspend`, { note: text }));
      }
      card.append(note, actions);
    }

    // History belongs to a specific report, not the bounded queue sample.
    const historyButton = el('button', { type: 'button', class: 'button button-small case-history-toggle',
      'aria-expanded': 'false', text: 'View ownership history' });
    historyButton.addEventListener('click', async () => {
      historyButton.disabled = true;
      let region = card.querySelector('[data-assignment-history]');
      if (region) {
        region.remove();
        historyButton.disabled = false;
        historyButton.textContent = 'View ownership history';
        historyButton.setAttribute('aria-expanded', 'false');
        return;
      }
      try {
        const { events } = await api('GET',
          `/moderation/reports/${encodeURIComponent(report.id)}/assignment-history?limit=50`);
        await loadNames(events.flatMap((event) => [event.actorId, event.previousAssignee, event.assigneeId]));
        region = el('div', { class: 'case-history-panel', role: 'region',
          'aria-label': `Ownership history for report ${report.id}`, dataset: { assignmentHistory: '' } },
        events.length ? [
          el('strong', { class: 'case-history-heading', text: 'Ownership activity · latest 50 changes' }),
          el('ol', { class: 'case-history-list' }, events.map((event) => el('li', { class: 'case-history-row' }, [
            el('div', { class: 'case-history-body' }, [
              el('span', { class: 'case-history-line',
                text: `${riderLabel(event.actorId).name} · ${event.event}: ${event.previousAssignee ? riderLabel(event.previousAssignee).name : 'unassigned'} → ${event.assigneeId ? riderLabel(event.assigneeId).name : 'unassigned'}` }),
              el('span', { class: 'case-history-note', text: event.note }),
            ]),
            el('span', { class: 'case-history-time' }, [timeEl(event.createdAt)]),
          ]))),
        ] : [el('p', { class: 'case-history-empty', text: 'No ownership changes recorded for this report.' })]);
        card.append(region);
        historyButton.textContent = 'Hide ownership history';
        historyButton.setAttribute('aria-expanded', 'true');
      } catch (error) {
        flash(actionErrorMessage(error), 'warning');
      } finally {
        historyButton.disabled = false;
      }
    });
    card.append(historyButton);
    card.append(el('p', { class: 'error-text', role: 'alert' }));
    return card;
  }

  function actionCard(action) {
    const { name } = riderLabel(action.targetRiderId);
    return el('li', { class: 'list-row' }, [
      person(`${ACTION_LABELS[action.action] || action.action}: ${name}`, `By ${riderLabel(action.moderatorId).name} · “${action.note}”`, action.targetRiderId),
      el('span', { class: 'trail' }, [timeEl(action.createdAt)]),
    ]);
  }

  /**
   * A Rider Social post hidden after reports. The photos and video come
   * through the same short-lived signed links the app uses; restoring or
   * removing it needs a note and is written to the audit log.
   */
  function socialPostCard(entry) {
    const { post } = entry;
    const { name, sub } = riderLabel(post.authorId);
    const media = el('div', { class: 'social-media' }, post.media.map((item, index) => item.kind === 'video'
      ? el('video', { src: `${API_BASE_URL}${item.url}`, poster: item.posterUrl ? `${API_BASE_URL}${item.posterUrl}` : null, controls: true, preload: 'metadata', 'aria-label': 'Reel' })
      : el('img', { src: `${API_BASE_URL}${item.url}`, alt: `Photo ${index + 1} of ${post.media.length}`, loading: 'lazy' })));
    const card = el('article', { class: 'card report', dataset: { postId: post.id } }, [
      el('div', { class: 'report-head' }, [
        el('div', { class: 'badges' }, [
          badge(`${entry.reports} reports`, 'warning'),
          ...entry.reasons.map((reason) => badge(REASON_LABELS[reason] || reason, null, true)),
          badge(post.kind === 'reel' ? 'Reel' : 'Photo post', null, true),
        ]),
        el('span', { class: 'report-time' }, [timeEl(post.createdAt)]),
      ]),
      el('div', { class: 'report-people' }, [el('div', {}, [el('div', { class: 'role', text: 'Posted by' }), person(name, sub, post.authorId)])]),
      media,
      el('p', { class: post.caption ? 'report-details' : 'report-details empty', text: post.caption || 'No caption.' }),
    ]);
    const note = el('textarea', { class: 'note', maxlength: MAX_NOTE_LENGTH, 'aria-label': `Note for post ${post.id}`, placeholder: 'Note for the audit log (required)' });
    const restore = el('button', { type: 'button', class: 'button', dataset: { action: 'restore' }, text: 'Restore post' });
    const remove = el('button', { type: 'button', class: 'button button-danger', dataset: { action: 'remove' }, text: 'Remove post' });
    wireAction(card, restore, note, (text) => api('POST', `/moderation/social-posts/${encodeURIComponent(post.id)}/restore`, { note: text }));
    wireAction(card, remove, note, (text) => api('POST', `/moderation/social-posts/${encodeURIComponent(post.id)}/remove`, { note: text }));
    card.append(note, el('div', { class: 'actions' }, [restore, remove]), el('p', { class: 'error-text', role: 'alert' }));
    return card;
  }

  // An operational reading view: decisions still happen on the existing
  // moderation screens, so their notes, claims and reauthentication remain.
  async function renderInbox(generation) {
    const filter = inboxFilter;
    const response = await api('GET', `/admin/action-inbox?type=${filter}&limit=50`);
    if (!isCurrentRender(generation)) return;
    const items = Array.isArray(response.items) ? response.items : [];
    await loadNames(items.flatMap((item) => [item.riderId, item.claimedBy, item.assignedTo]));
    if (!isCurrentRender(generation)) return;

    const tabs = segmented([
      ['all', 'All work'], ['rider_report', 'Rider reports'], ['social_post', 'Social posts'],
    ], filter, (next) => {
      inboxFilter = next;
      if (next === 'social_post') inboxOwnerFilter = 'all';
      renderAndFocus('[aria-label="Action inbox sources"] [aria-pressed="true"]');
    }, 'Action inbox sources');

    // Source filtering is server-side; owner filtering is explicitly local to
    // this bounded response. Social posts have no durable owner model yet.
    const validItems = items.filter((item) =>
      (item.type === 'rider_report' && typeof item.reportId === 'string') ||
      (item.type === 'social_post' && typeof item.postId === 'string'));
    const visibleItems = validItems.filter((item) => inboxOwnerFilter === 'all' ||
      (item.type === 'rider_report' && (inboxOwnerFilter === 'mine'
        ? item.assignedTo === session.riderId : item.assignedTo == null)));
    const ownershipTabs = filter === 'social_post' ? null : segmented([
      ['all', 'All owners'], ['mine', 'Assigned to me'], ['unassigned', 'Unassigned'],
    ], inboxOwnerFilter, (next) => {
      inboxOwnerFilter = next;
      renderAndFocus('[aria-label="Action inbox ownership"] [aria-pressed="true"]');
    }, 'Action inbox ownership');

    const itemCard = (item) => {
      const isReport = item.type === 'rider_report';
      const title = isReport ? `Rider report · ${REASON_LABELS[item.reason] || item.reason}`
        : `Rider Social · ${item.kind === 'reel' ? 'Reel' : 'Photo post'}`;
      const status = isReport
        ? (item.assignedTo ? `Case owner: ${item.assignedTo === session.riderId ? 'you' : riderLabel(item.assignedTo).name}` : 'No permanent owner')
        : `${formatNumber(item.reportCount)} reports`;
      const description = isReport
        ? `${formatNumber(item.reportsAgainstRider)} reports against this rider`
        : (item.reasons?.length ? item.reasons.map((reason) => REASON_LABELS[reason] || reason).join(', ') : 'Reported content');
      const quickClaim = isReport && item.claimedBy
        ? `Quick claim: ${riderLabel(item.claimedBy).name}` : null;
      const button = el('button', { type: 'button', class: 'button', text: isReport ? 'Review rider report' : 'Review Social post' });
      button.addEventListener('click', () => {
        inboxFocusTarget = {
          type: item.type,
          id: isReport ? item.reportId : item.postId,
        };
        moderationView = isReport ? 'open' : 'social';
        selectView('moderation');
      });
      return el('article', { class: 'card inbox-item', dataset: { inboxId: item.id } }, [
        el('div', { class: 'inbox-item-main' }, [
          el('div', { class: 'inbox-item-top' }, [
            el('h2', { class: 'inbox-item-title', text: title }),
            waitingBadge(item.eventAt),
          ]),
          person(riderLabel(item.riderId).name, riderLabel(item.riderId).sub, item.riderId),
          el('div', { class: 'inbox-item-meta' }, [
            // Permanent assignment is a neutral coordination state, never an urgency signal.
            badge(status, isReport && item.assignedTo ? 'accent' : null,
              isReport && !item.assignedTo),
            el('span', { class: 'inbox-item-detail', text: description }),
            quickClaim ? el('span', { class: 'inbox-quick-claim', text: quickClaim }) : null,
            el('span', { class: 'inbox-item-time' }, [timeEl(item.eventAt)]),
          ]),
        ]),
        el('div', { class: 'inbox-item-actions' }, [button]),
      ]);
    };

    const content = visibleItems.length
      ? el('div', { class: 'inbox-items' }, visibleItems.map(itemCard))
      : el('div', { class: 'card' }, [emptyState('inbox', validItems.length
        ? 'No matching work in this sample' : 'Nothing waiting in this view',
        validItems.length
          ? 'Try All owners or another source. Ownership filters only apply to the items returned in this snapshot.'
          : 'No open reports or reported Social posts were returned for this source. Refresh to check again.')]);

    const note = response.mayHaveMore
      ? el('p', { class: 'inbox-limit-note', role: 'status',
        text: 'Showing up to 50 items from a bounded sample. More work may be waiting in Moderation.' })
      : el('p', { class: 'inbox-limit-note',
        text: 'Bounded queue snapshot, not a complete count or global priority order · refresh to check for new work.' });

    pageEl.replaceChildren(
      pageHeader('Action inbox', 'One place to review incoming rider and Rider Social safety work.', [tabs]),
      el('div', { class: 'inbox-intro', role: 'note' }, [
        el('strong', { text: 'Review and assign work in Moderation' }),
        el('span', { text: 'This inbox shows summary details only. Open an item to claim it, review evidence and record an audited decision.' }),
      ]),
      el('div', { class: 'inbox-triage-toolbar' }, [
        ownershipTabs,
        el('span', { class: 'inbox-sample-count', role: 'status',
          text: `Showing ${visibleItems.length} of ${validItems.length} returned items` }),
      ]),
      content,
      note,
    );
  }

  async function renderModeration(generation) {
    const tabs = segmented([['open', 'Open'], ['social', 'Social posts'], ['dismissed', 'Dismissed'], ['actioned', 'Actioned']], moderationView, (next) => {
      moderationView = next;
      inboxFocusTarget = null;
      renderAndFocus('[aria-label="Moderation queues"] [aria-pressed="true"]');
    }, 'Moderation queues');
    const header = pageHeader('Moderation', 'Every decision needs a note and is recorded in the audit log.', [tabs]);
    // Exact-ID lookups bypass list sampling and sorting. A case could have
    // been claimed, resolved or removed since the Action Inbox snapshot.
    const selected = inboxFocusTarget &&
      ((inboxFocusTarget.type === 'rider_report' && moderationView === 'open') ||
       (inboxFocusTarget.type === 'social_post' && moderationView === 'social'))
      ? inboxFocusTarget : null;
    if (selected) {
      const back = el('button', { type: 'button', class: 'button', text: 'Back to queue' });
      back.addEventListener('click', () => {
        inboxFocusTarget = null;
        renderAndFocus('[aria-label="Moderation queues"] [aria-pressed="true"]');
      });
      let item;
      try {
        const url = selected.type === 'rider_report'
          ? `/moderation/reports/${encodeURIComponent(selected.id)}`
          : `/moderation/social-posts/${encodeURIComponent(selected.id)}`;
        const response = await api('GET', url);
        item = selected.type === 'rider_report' ? response.report : response.entry;
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        if (!isCurrentRender(generation)) return;
        const unavailable = el('div', { class: 'card', dataset: { selectedUnavailable: '' }, tabindex: '-1' }, [
          emptyState('inbox', 'Selected item is no longer available',
            'It may have been removed or changed since your inbox snapshot. No resolution is assumed.'),
          back,
        ]);
        pageEl.replaceChildren(header, unavailable);
        return;
      }
      if (!isCurrentRender(generation)) return;
      const riderIds = selected.type === 'rider_report'
        ? [item.reporterId, item.reportedRiderId, item.resolvedBy, item.claimedBy, item.assignedTo]
        : [item.post.authorId];
      await loadNames(riderIds);
      if (!isCurrentRender(generation)) return;
      const changed = selected.type === 'rider_report' && item.status !== 'open';
      pageEl.replaceChildren(
        header,
        el('div', { class: 'inbox-intro', role: 'note' }, [
          el('strong', { text: changed ? `Report currently ${item.status}` : 'Showing the selected case' }),
          el('span', { text: changed
            ? 'This report changed after the Action Inbox snapshot. Its current status is displayed; no new decision can be made on this closed report.'
            : 'Loaded directly by its identifier, independent of queue size and order.' }),
          back,
        ]),
        el('div', { class: 'reports' }, [
          selected.type === 'rider_report' ? reportCard(item) : socialPostCard(item),
        ]),
      );
      return;
    }
    if (moderationView === 'social') {
      let posts = [];
      try {
        ({ posts } = await api('GET', '/moderation/social-posts?limit=100'));
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
      }
      if (!isCurrentRender(generation)) return;
      await loadNames(posts.map((entry) => entry.post.authorId));
      if (!isCurrentRender(generation)) return;
      pageEl.replaceChildren(header, el('div', { class: 'reports' }, posts.length
        ? posts.map(socialPostCard)
        : [el('div', { class: 'card' }, [emptyState('inbox', 'No hidden posts', 'Posts reported by three riders are hidden here until you restore or remove them.')])]));
      return;
    }
    const { reports } = await api('GET', `/moderation/reports?status=${moderationView}&limit=100`);
    if (!isCurrentRender(generation)) return;
    await loadNames(reports.flatMap((report) => [report.reporterId, report.reportedRiderId, report.resolvedBy, report.claimedBy, report.assignedTo]));
    if (!isCurrentRender(generation)) return;
    if (moderationView === 'open') updateReportCount(reports.length);
    pageEl.replaceChildren(header, el('div', { class: 'reports' }, reports.length
      ? reports.map(reportCard)
      : [el('div', { class: 'card' }, [emptyState('inbox', moderationView === 'open' ? 'No open reports' : 'Nothing here yet', moderationView === 'open' ? 'You’re all caught up.' : null)])]));
  }

  function updateReportCount(count) {
    reportCountEl.hidden = !count;
    reportCountEl.textContent = count > 99 ? '99+' : String(count);
  }

  // ------------------------------------------------------------ Staff actions

  /**
   * A confirmation dialog for a staff change: what it does, a required
   * reason (with ready-made starts), and for suspensions how long. Resolves
   * { note, days } or null when cancelled.
   */
  function actionDialog({ title, description, confirmLabel, danger = false, templates = [], withLength = false }) {
    return new Promise((resolve) => {
      const note = el('textarea', { class: 'note', id: 'actionNote', maxlength: MAX_NOTE_LENGTH, 'aria-label': 'Reason for the audit log', placeholder: 'Reason for the audit log (required)' });
      const length = withLength ? el('select', { class: 'input select', 'aria-label': 'How long' }, SUSPENSION_LENGTHS.map(([value, label]) => el('option', { value, text: label, selected: value === '7' }))) : null;
      const chips = templates.length ? el('div', { class: 'chips', role: 'group', 'aria-label': 'Start from a reason' }, templates.map((text) => {
        const chip = el('button', { type: 'button', class: 'chip', text });
        chip.addEventListener('click', () => { note.value = text; note.focus(); });
        return chip;
      })) : null;
      const error = el('p', { class: 'error-text', role: 'alert' });
      const confirm = el('button', { type: 'submit', class: danger ? 'button button-danger' : 'button button-primary', text: confirmLabel });
      const cancel = el('button', { type: 'button', class: 'button', text: 'Cancel' });
      const form = el('form', { class: 'dialog-body', novalidate: true }, [
        el('h2', { class: 'card-title', id: 'actionTitle', text: title }),
        description ? el('p', { class: 'card-description', text: description }) : null,
        length ? el('label', { class: 'field-label' }, ['How long', length]) : null,
        chips,
        note,
        error,
        el('div', { class: 'actions' }, [cancel, confirm]),
      ]);
      const dialog = el('dialog', { class: 'dialog', 'aria-labelledby': 'actionTitle' }, [form]);
      let result = null;
      cancel.addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => { dialog.remove(); resolve(result); });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!note.value.trim()) {
          error.textContent = 'Write a reason first. Every staff change is recorded with it.';
          note.focus();
          return;
        }
        result = { note: note.value.trim(), days: length && length.value ? Number(length.value) : null };
        dialog.close();
      });
      document.body.append(dialog);
      dialog.showModal();
      (chips ? chips.querySelector('button') : note).focus();
    });
  }

  function formatUntil(ms) {
    return new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  // ------------------------------------------------------------ Rider

  async function renderRiderDetail(riderId, generation) {
    const detail = await api('GET', `/admin/riders/${encodeURIComponent(riderId)}`).catch((error) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    });
    if (!isCurrentRender(generation)) return;
    if (!detail) {
      pageEl.replaceChildren(pageHeader('Rider', null), el('div', { class: 'card' }, [emptyState('users', 'No such rider', 'They may have deleted their account.')]));
      return;
    }
    const { rider } = detail;
    await loadNames([
      ...(detail.reportsAgainst ?? []).flatMap((report) => [report.reporterId, report.resolvedBy]),
      ...(detail.reportsFiled ?? []).map((report) => report.reportedRiderId),
      ...(detail.actions ?? []).map((action) => action.moderatorId),
    ].filter((id) => id && id !== 'system'));
    if (!isCurrentRender(generation)) return;
    const name = rider.displayName || rider.username;
    document.title = `${name} · Rider Comms staff`;

    const run = async (button, dialogOptions, request, done) => {
      const choice = await actionDialog(dialogOptions);
      if (!choice) return;
      button.disabled = true;
      try {
        const result = await request(choice);
        await render();
        if (done) done(result);
      } catch (error) {
        button.disabled = false;
        flash(actionErrorMessage(error), 'danger');
      }
    };
    const action = (label, { danger = false, show = true } = {}) => (show ? el('button', { type: 'button', class: danger ? 'button button-danger' : 'button', dataset: { action: label.toLowerCase().replace(/\s+/g, '-') }, text: label }) : null);
    const isSelf = rider.riderId === session.riderId;
    const suspend = action('Suspend', { danger: true, show: allowed('moderate') && !rider.suspended && !rider.isAdmin && !isSelf });
    const unsuspend = action('Unsuspend', { show: allowed('moderate') && rider.suspended });
    const verify = action('Verify email', { show: allowed('verify_email') && !rider.emailVerified });
    const reset = action('Send password reset', { show: allowed('account_help') && Boolean(rider.email) });
    const signOut = action('Sign out everywhere', { show: allowed('account_help') });
    const exportData = action('Export data', { show: allowed('manage_staff') });
    const path = (end) => `/moderation/riders/${encodeURIComponent(rider.riderId)}/${end}`;
    suspend?.addEventListener('click', () => run(suspend, { title: `Suspend ${name}?`, description: 'They are signed out everywhere and can’t sign in until it ends or someone unsuspends them. Open reports against them close as actioned.', confirmLabel: 'Suspend', danger: true, templates: NOTE_TEMPLATES.suspend, withLength: true },
      ({ note, days }) => api('POST', path('suspend'), days ? { note, days } : { note })));
    unsuspend?.addEventListener('click', () => run(unsuspend, { title: `Unsuspend ${name}?`, description: 'They can sign in again straight away.', confirmLabel: 'Unsuspend', templates: ['Appeal accepted.', 'Suspended by mistake.'] },
      ({ note }) => api('POST', path('unsuspend'), { note })));
    verify?.addEventListener('click', () => run(verify, { title: `Mark ${name}’s email verified?`, description: 'Only for riders you have confirmed yourself, for example while verification emails can’t be delivered.', confirmLabel: 'Mark verified', templates: ['Known rider; verification email not delivered.'] },
      ({ note }) => api('POST', path('verify-email'), { note })));
    reset?.addEventListener('click', () => run(reset, { title: `Email ${name} a password reset link?`, description: `The link goes to ${rider.email} and works for one hour. Confirm who you’re talking to first.`, confirmLabel: 'Send link', templates: ['Forgot password; identity confirmed.'] },
      ({ note }) => api('POST', path('password-reset'), { note }),
      (result) => flash(result.emailDelivery?.configured === false ? 'Recorded, but email isn’t set up on the backend, so nothing was sent.' : 'Password reset link sent.', result.emailDelivery?.configured === false ? 'warning' : 'success')));
    signOut?.addEventListener('click', () => run(signOut, { title: `Sign ${name} out on every device?`, description: 'Every app and browser they’re signed in on has to sign in again. Use it for a lost phone or a shared password.', confirmLabel: 'Sign out everywhere', danger: true, templates: ['Lost phone.', 'Password shared with someone else.'] },
      ({ note }) => api('POST', path('sign-out'), { note }),
      (result) => flash(`Signed out of ${result.sessions} ${result.sessions === 1 ? 'device' : 'devices'}.`, 'success')));
    exportData?.addEventListener('click', () => run(exportData, { title: `Export everything held about ${name}?`, description: 'For a data access request. The file downloads to this computer; keep it safe.', confirmLabel: 'Export' },
      ({ note }) => api('POST', `/admin/riders/${encodeURIComponent(rider.riderId)}/export`, { note }),
      (data) => downloadJson(data, `rider-comms-data-${rider.riderId}-${new Date().toISOString().slice(0, 10)}.json`)));

    const facts = [
      ['Username', rider.username],
      ['Email', rider.email ? `${rider.email}${rider.emailVerified ? '' : ' (not verified)'}` : '—'],
      ['Rider ID', rider.riderId],
      ['Joined', new Date(rider.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })],
      ['Last active', formatRelative(rider.lastSeenAt) ?? 'Over 30 days ago'],
      ['Friends', numberFormat.format(rider.friends)],
      ['Reports against them', numberFormat.format(rider.reportsAgainst)],
      ['Reports they filed', numberFormat.format(rider.reportsFiled)],
      ...(rider.suspended ? [['Suspended', rider.suspendedUntil ? `Until ${formatUntil(rider.suspendedUntil)}` : 'No end date']] : []),
    ];
    const reportRow = (report, who) => el('li', { class: 'list-row', dataset: { reportId: report.id } }, [
      person(`${REASON_LABELS[report.reason] || report.reason}`, [who, report.details].filter(Boolean).join(' · '), who === null ? null : report.reporterId, { link: false }),
      el('span', { class: 'trail' }, [badge(report.status === 'open' ? 'Open' : report.status === 'actioned' ? 'Actioned' : 'Dismissed', report.status === 'open' ? 'warning' : report.status === 'actioned' ? 'danger' : null), el('div', {}, [timeEl(report.createdAt)])]),
    ]);
    const sectionId = (title) => 'rider-section-' + title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '');
    const section = (title, items, empty) => items === null ? [] : [
      el('h2', { class: 'section-title rider-section-heading', id: sectionId(title), tabindex: '-1', text: title }),
      el('div', { class: 'card reports' }, items.length ? [el('ul', { class: 'list' }, items)] : [emptyState('inbox', empty, null)]),
    ];
    const availableSections = [
      ['Account details', true],
      ['Reports about them', detail.reportsAgainst !== null],
      ['Reports they filed', detail.reportsFiled !== null],
      ['Staff history', detail.actions !== null],
      ['Signed-in devices', detail.devices !== null],
      ['Sign-in history', detail.securityEvents !== null],
    ].filter(([, show]) => show);
    const recordNavigation = el('nav', { class: 'rider-section-nav', 'aria-label': 'Rider record sections' },
      availableSections.map(([title]) => {
        const button = el('button', { type: 'button', text: title });
        button.addEventListener('click', () => {
          const heading = document.getElementById(sectionId(title));
          heading?.scrollIntoView({ block: 'start', behavior: 'auto' });
          heading?.focus({ preventScroll: true });
        });
        return button;
      }));

    pageEl.replaceChildren(
      el('a', { class: 'back-link', href: '#riders', text: '← Riders' }),
      el('div', { class: 'page-header rider-header' }, [
        el('div', { class: 'person' }, [
          avatar(name, rider.riderId),
          el('div', { class: 'person-text' }, [
            el('h1', { class: 'page-title', tabindex: '-1', text: name }),
            el('p', { class: 'page-subtitle', text: [rider.handle, rider.email].filter(Boolean).join(' · ') }),
          ]),
        ]),
        el('div', { class: 'actions' }, [riderBadges(rider)]),
      ]),
      el('div', { class: 'rider-actions' }, [suspend, unsuspend, verify, reset, signOut, exportData].filter(Boolean)),
      recordNavigation,
      el('h2', { class: 'section-title rider-section-heading', id: 'rider-section-account-details', tabindex: '-1', text: 'Account details' }),
      el('section', { class: 'card' }, [el('dl', { class: 'facts' }, facts.map(([label, value]) => el('div', { class: 'fact' }, [el('dt', { text: label }), el('dd', { text: value })])))]),
      ...section('Reports about them', detail.reportsAgainst && detail.reportsAgainst.map((report) => reportRow(report, `From ${riderLabel(report.reporterId).name}`)), 'No reports about this rider.'),
      ...section('Reports they filed', detail.reportsFiled && detail.reportsFiled.map((report) => reportRow(report, `About ${riderLabel(report.reportedRiderId).name}`)), 'They haven’t reported anyone.'),
      ...section('Staff history', detail.actions && detail.actions.map(actionCard), 'No staff decisions about this rider.'),
      ...section('Signed-in devices', detail.devices && detail.devices.map((device) => el('li', { class: 'list-row' }, [
        person(device.deviceName || 'Unknown device', `Signed in ${new Date(device.createdAt).toLocaleDateString()}`, device.id, { link: false }),
        el('span', { class: 'trail' }, [timeEl(Date.parse(device.lastSeenAt))]),
      ])), 'Not signed in anywhere.'),
      ...section('Sign-in history', detail.securityEvents && detail.securityEvents.map((event) => el('li', { class: 'list-row' }, [
        person(SECURITY_EVENT_LABELS[event.event] || event.event, event.device, event.id, { link: false }),
        el('span', { class: 'trail' }, [SECURITY_EVENT_TONES[event.event] ? badge(event.event === 'password_reset' ? 'Reset' : 'Failed', SECURITY_EVENT_TONES[event.event]) : null, el('div', {}, [timeEl(event.createdAt)])]),
      ])), 'No sign-ins recorded yet.'),
    );
  }

  function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = el('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  /** A short message at the top of the page after an action. */
  function flash(text, tone = 'success') {
    document.querySelector('.flash')?.remove();
    const node = el('div', { class: 'flash', role: 'status', dataset: { tone }, text });
    pageEl.prepend(node);
    setTimeout(() => node.remove(), 6000);
  }

  // ------------------------------------------------------------ Audit log

  function csvCell(value) {
    const text = String(value ?? '');
    // Leading = + - @ would run as a formula in spreadsheet apps.
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  }

  function downloadAuditCsv(actions) {
    const rows = [['When (UTC)', 'Action', 'Staff member', 'Staff rider ID', 'Rider', 'Rider ID', 'Report ID', 'Note']];
    for (const action of actions) {
      rows.push([
        new Date(action.createdAt).toISOString(), ACTION_LABELS[action.action] || action.action,
        riderLabel(action.moderatorId).name, action.moderatorId, riderLabel(action.targetRiderId).name, action.targetRiderId,
        action.reportId ?? '', action.note,
      ]);
    }
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = el('a', { href: URL.createObjectURL(blob), download: `rider-comms-audit-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function renderAudit(generation) {
    const query = auditRider ? `&riderId=${encodeURIComponent(auditRider)}` : '';
    const { actions } = await api('GET', `/moderation/actions?limit=200${query}`);
    if (!isCurrentRender(generation)) return;
    await loadNames(actions.flatMap((action) => [action.targetRiderId, action.moderatorId]));
    if (!isCurrentRender(generation)) return;
    const group = ACTION_GROUPS.find(([id]) => id === auditGroup) ?? ACTION_GROUPS[0];
    const shown = group[2] ? actions.filter((action) => group[2].includes(action.action)) : actions;

    const filters = segmented(ACTION_GROUPS.map(([id, label]) => [id, label]), auditGroup, (next) => {
      auditGroup = next;
      renderAndFocus('[aria-label="Filter the audit log"] [aria-pressed="true"]');
    }, 'Filter the audit log');
    const form = el('form', { class: 'toolbar', role: 'search' });
    const input = el('input', { class: 'input', type: 'search', placeholder: 'Rider ID, e.g. rider_ab12cd34', 'aria-label': 'Show actions for one rider', maxlength: 100, autocomplete: 'off' });
    input.value = auditRider;
    form.append(el('div', { class: 'search' }, [icon('search'), input]), el('button', { type: 'submit', class: 'button', text: 'Filter' }));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      auditRider = input.value.trim();
      renderAndFocus('input[aria-label="Show actions for one rider"]');
    });
    const exportButton = el('button', { type: 'button', class: 'button', dataset: { action: 'export' }, text: 'Export CSV', disabled: shown.length === 0 });
    exportButton.addEventListener('click', () => downloadAuditCsv(shown));

    const subtitle = `${shown.length} ${shown.length === 1 ? 'decision' : 'decisions'}${auditRider ? ` for ${auditRider}` : ''}, newest first. Notes are kept for good.`;
    pageEl.replaceChildren(
      pageHeader('Audit log', subtitle, [exportButton]),
      el('div', { class: 'audit-filters' }, [filters]),
      form,
      el('div', { class: 'card reports' }, shown.length
        ? [el('ul', { class: 'list' }, shown.map(actionCard))]
        : [emptyState('inbox', 'Nothing recorded', auditRider || group[2] ? 'No decisions match these filters.' : 'Every staff decision will be listed here with its note.')]),
    );
  }

  // ------------------------------------------------------------ Staff

  function roleBadge(role) {
    return badge(ROLE_LABELS[role] || role, ROLE_TONES[role]);
  }

  function staffErrorMessage(error) {
    if (!(error instanceof ApiError)) return 'Could not reach the server. Try again.';
    return {
      not_found: 'No rider has that handle or rider ID.',
      is_admin: 'Admins are set with ADMIN_RIDER_IDS on the backend, not here.',
      unchanged: 'They already have that role.',
      suspended: 'This rider is suspended. Unsuspend them first.',
      not_staff: 'This rider is not staff.',
    }[error.code] || actionErrorMessage(error);
  }

  function roleSelect(value, label) {
    const select = el('select', { class: 'input select', 'aria-label': label });
    for (const role of ['moderator', 'support', 'analyst']) select.append(el('option', { value: role, text: ROLE_LABELS[role], selected: role === value }));
    return select;
  }

  function addStaffForm() {
    const rider = el('input', { class: 'input', name: 'rider', placeholder: 'Handle or rider ID', 'aria-label': 'Handle or rider ID', maxlength: 100, autocomplete: 'off', required: true });
    const role = roleSelect('moderator', 'Role');
    const note = el('input', { class: 'input', name: 'note', placeholder: 'Reason (goes in the audit log)', 'aria-label': 'Reason for the audit log', maxlength: MAX_NOTE_LENGTH, autocomplete: 'off', required: true });
    const submit = el('button', { type: 'submit', class: 'button button-primary', text: 'Add to staff' });
    const error = el('p', { class: 'error-text', role: 'alert' });
    const form = el('form', { class: 'card staff-form', id: 'addStaffForm', novalidate: true }, [
      el('div', { class: 'card-header' }, [el('div', {}, [el('h2', { class: 'card-title', text: 'Add a staff member' }), el('p', { class: 'card-description', text: 'They see the pages their role allows the next time they open this dashboard.' })])]),
      el('div', { class: 'staff-form-fields' }, [rider, role, note, submit]),
      error,
    ]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!rider.value.trim() || !note.value.trim()) {
        error.textContent = 'Enter their handle or rider ID and a reason.';
        return;
      }
      submit.disabled = true;
      error.textContent = '';
      try {
        await api('POST', '/admin/staff', { rider: rider.value.trim(), role: role.value, note: note.value.trim() });
        await render();
      } catch (failure) {
        submit.disabled = false;
        error.textContent = staffErrorMessage(failure);
      }
    });
    return form;
  }

  function staffActions(member) {
    if (member.role === 'admin') return el('span', { class: 'muted', text: 'Set on the backend' });
    const select = roleSelect(member.role, `Role for ${member.displayName || member.riderId}`);
    const remove = el('button', { type: 'button', class: 'button button-small', dataset: { action: 'remove-staff' }, text: 'Remove' });
    select.addEventListener('change', async () => {
      const nextRole = select.value;
      const choice = await actionDialog({
        title: `Change ${member.displayName || member.riderId} to ${ROLE_LABELS[nextRole]}?`,
        description: 'Their dashboard permissions change immediately. A reason goes in the audit log.',
        confirmLabel: 'Change role',
      });
      if (!choice) {
        select.value = member.role;
        return;
      }
      select.disabled = true;
      remove.disabled = true;
      try {
        await api('POST', '/admin/staff', { rider: member.riderId, role: nextRole, note: choice.note });
        await render();
        flash('Staff role updated.');
      } catch (error) {
        select.value = member.role;
        flash(staffErrorMessage(error), 'danger');
      } finally {
        select.disabled = false;
        remove.disabled = false;
      }
    });
    remove.addEventListener('click', async () => {
      const choice = await actionDialog({
        title: `Remove ${member.displayName || member.riderId} from staff?`,
        description: 'Dashboard access ends immediately. Their rider account is not deleted.',
        confirmLabel: 'Remove staff',
        danger: true,
      });
      if (!choice) return;
      select.disabled = true;
      remove.disabled = true;
      try {
        await api('POST', `/admin/staff/${encodeURIComponent(member.riderId)}/remove`, { note: choice.note });
        await render();
        flash('Staff access removed.');
      } catch (error) {
        flash(staffErrorMessage(error), 'danger');
      } finally {
        select.disabled = false;
        remove.disabled = false;
      }
    });
    return el('div', { class: 'row-actions' }, [select, remove]);
  }

  function roleMatrix() {
    const roles = Object.keys(ROLE_MATRIX);
    return el('section', { class: 'card table-card' }, [
      el('div', { class: 'card-header' }, [el('div', {}, [el('h2', { class: 'card-title', text: 'What each role can do' }), el('p', { class: 'card-description', text: 'Least privilege: give people the smallest role that covers their work.' })])]),
      el('ul', { class: 'role-list' }, ROLE_SUMMARIES.map(([role, text]) => el('li', {}, [roleBadge(role), el('span', { text })]))),
      el('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': 'Permissions by role' }, [el('table', { class: 'table matrix' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: 'Permission' }), ...roles.map((role) => el('th', { class: 'center', text: ROLE_LABELS[role] }))])]),
        el('tbody', {}, PERMISSION_LABELS.map(([permission, label]) => el('tr', {}, [
          el('td', { text: label }),
          ...roles.map((role) => {
            const yes = ROLE_MATRIX[role].includes(permission);
            return el('td', { class: 'center', 'aria-label': `${ROLE_LABELS[role]}: ${yes ? 'yes' : 'no'}` }, [el('span', { class: yes ? 'check yes' : 'check', 'aria-hidden': 'true', text: yes ? '✓' : '–' })]);
          }),
        ]))),
      ])]),
    ]);
  }

  const SECURITY_EVENT_LABELS = {
    account_created: 'Created the account', login: 'Signed in', login_failed: 'Wrong password', signed_out: 'Signed out',
    session_revoked: 'Signed out a device', password_reset: 'Reset the password', reauthenticated: 'Confirmed password', reauth_failed: 'Wrong password when confirming',
  };
  const SECURITY_EVENT_TONES = { login_failed: 'warning', reauth_failed: 'warning', password_reset: 'accent' };

  function signInHistory(events) {
    if (!events) return [];
    return [
      el('h2', { class: 'section-title', text: 'Staff sign-ins' }),
      el('div', { class: 'card reports' }, events.length
        ? [el('ul', { class: 'list' }, events.map((event) => el('li', { class: 'list-row', dataset: { securityEvent: event.event } }, [
          person(riderLabel(event.riderId).name, [SECURITY_EVENT_LABELS[event.event] || event.event, event.device].filter(Boolean).join(' · '), event.riderId),
          el('span', { class: 'trail' }, [SECURITY_EVENT_TONES[event.event] ? badge(event.event === 'password_reset' ? 'Reset' : 'Failed', SECURITY_EVENT_TONES[event.event]) : null, el('div', {}, [timeEl(event.createdAt)])]),
        ])))]
        : [emptyState('lock', 'No sign-ins yet', 'Staff sign-ins, wrong passwords and resets will be listed here.')]),
    ];
  }

  async function renderStaff(generation) {
    const [{ staff }, events] = await Promise.all([
      api('GET', '/admin/staff'),
      api('GET', '/admin/security-events?staff=1&limit=20').then((body) => body.events).catch(() => null),
    ]);
    if (!isCurrentRender(generation)) return;
    await loadNames((events ?? []).map((event) => event.riderId));
    if (!isCurrentRender(generation)) return;
    const counts = staff.reduce((total, member) => ({ ...total, [member.role]: (total[member.role] ?? 0) + 1 }), {});
    const name = (member) => member.displayName || member.handle || member.riderId;
    const sub = (member) => [member.handle, member.email].filter(Boolean).join(' · ') || member.riderId;
    const granted = (member) => member.grantedAt ? el('span', {}, [timeEl(member.grantedAt), ` by ${riderLabel(member.grantedBy).name}`]) : el('span', { class: 'muted', text: 'ADMIN_RIDER_IDS' });
    await loadNames(staff.map((member) => member.grantedBy).filter(Boolean));
    if (!isCurrentRender(generation)) return;
    pageEl.replaceChildren(
      pageHeader('Staff and roles', `${staff.length} ${staff.length === 1 ? 'person has' : 'people have'} dashboard access · ${['admin', 'moderator', 'support', 'analyst'].filter((role) => counts[role]).map((role) => `${counts[role]} ${ROLE_LABELS[role].toLowerCase()}`).join(', ')}`),
      addStaffForm(),
      el('h2', { class: 'section-title', text: 'Team' }),
      el('div', { class: 'card only-mobile' }, [el('ul', { class: 'list' }, staff.map((member) => el('li', { class: 'list-row staff-row', dataset: { riderId: member.riderId } }, [
        person(name(member), sub(member), member.riderId),
        el('div', { class: 'trail' }, [roleBadge(member.role), staffActions(member)]),
      ])))]),
      el('div', { class: 'card table-card only-desktop' }, [el('div', { class: 'table-scroll' }, [el('table', { class: 'table' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: 'Member' }), el('th', { text: 'Role' }), el('th', { text: 'Added' }), el('th', { text: 'Last active' }), el('th', { text: 'Manage' })])]),
        el('tbody', {}, staff.map((member) => el('tr', { dataset: { riderId: member.riderId } }, [
          el('td', {}, [person(name(member), sub(member), member.riderId)]),
          el('td', {}, [roleBadge(member.role)]),
          el('td', { class: 'muted' }, [granted(member)]),
          el('td', { class: 'muted' }, [timeEl(member.lastSeenAt, 'Over 30 days')]),
          el('td', {}, [staffActions(member)]),
        ]))),
      ])])]),
      ...signInHistory(events),
      el('h2', { class: 'section-title', text: 'Roles' }),
      roleMatrix(),
    );
  }

  // ------------------------------------------------------------ System

  async function probe(path) {
    const started = performance.now();
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, { cache: 'no-store' });
      return { ok: response.ok, ms: Math.round(performance.now() - started) };
    } catch {
      return { ok: false, ms: null };
    }
  }

  // What the backend is set up to do. Email counts as restricted when Resend
  // refused the account (e.g. no verified domain) after the last success.
  function setupRows(system) {
    if (!system) return [];
    const email = system.email;
    const restricted = email.configured && email.lastRefusedAt !== null && (email.lastSentAt === null || email.lastRefusedAt > email.lastSentAt);
    const emailState = !email.configured ? 'down' : restricted ? 'warn' : 'ok';
    const emailLabel = !email.configured ? 'Not set up' : restricted ? 'Restricted' : 'Working';
    const emailDesc = !email.configured ? 'Set RESEND_API_KEY and RESEND_FROM_EMAIL on the backend'
      : restricted ? `Resend refused: ${email.lastRefusal.replace(/^[a-z_]+: /, '')}` : email.lastSentAt ? `Last sent ${new Date(email.lastSentAt).toLocaleString()}` : 'Verification and reset emails';
    const setting = (name, state, label, description) => el('li', { class: 'status-row' }, [
      el('div', {}, [el('div', { class: 'status-name', text: name }), el('div', { class: 'status-desc', text: description })]),
      el('span', { class: 'status-value' }, [statusBadge(state, label)]),
    ]);
    return [
      setting('Email delivery', emailState, emailLabel, emailDesc),
      setting('Social media storage', system.socialMediaStorage ? 'ok' : 'down', system.socialMediaStorage ? 'On' : 'Off', system.socialMediaStorage ? 'Photos and videos are stored privately' : 'Set the SOCIAL_MEDIA_S3_* variables on the backend'),
      setting('Social content check', system.socialMediaScanning ? 'ok' : 'down', system.socialMediaScanning ? 'On' : 'Off', system.socialMediaScanning ? contentCheckSummary(system.contentCheck) : 'Set a Google key with Cloud Vision API allowed'),
      setting('Social posting', system.socialPosting ? 'ok' : 'warn', system.socialPosting ? 'On' : 'Off', system.socialPosting ? 'Riders can post to Rider Social' : 'Posting is switched off'),
      ...PROVIDER_ROWS.map(([key, name, purpose]) => providerRow(setting, name, purpose, system.providers?.[key])),
    ];
  }

  // Outside services, as this server has seen them since it started: the
  // last refusal shows until a later call succeeds.
  const PROVIDER_ROWS = [
    ['google_places', 'Google place search', 'Search and stops on the way'],
    ['google_routes', 'Google routes', 'Turn-by-turn routes and traffic'],
    ['google_vision', 'Google Vision', 'The Social content check'],
    ['media_storage', 'Social photo storage', 'Saving and serving photos and Reels'],
  ];
  function providerRow(setting, name, purpose, status) {
    if (!status || (status.lastOkAt === null && status.lastErrorAt === null)) return setting(name, 'warn', 'Not used yet', `${purpose}. Not called since the server started.`);
    const failing = status.lastErrorAt !== null && (status.lastOkAt === null || status.lastErrorAt > status.lastOkAt);
    if (failing) return setting(name, 'down', 'Refusing', `${purpose}. Last refused ${new Date(status.lastErrorAt).toLocaleString()}: ${status.lastError}`);
    return setting(name, 'ok', 'Working', `${purpose}. Last answered ${new Date(status.lastOkAt).toLocaleString()}.`);
  }
  function contentCheckSummary(counts) {
    if (!counts) return 'Google SafeSearch checks every photo and Reel';
    const total = counts.allowed + counts.rejected + counts.unavailable;
    if (!total) return 'Google SafeSearch checks every photo and Reel. None checked since the server started.';
    return `Since the server started: ${counts.allowed} allowed, ${counts.rejected} refused as unsafe, ${counts.unavailable} not checked (Google unavailable)`;
  }

  const STATE_TONES = { ok: 'success', warn: 'warning', down: 'danger' };
  function statusBadge(state, label) {
    return el('span', { class: 'badge', dataset: { tone: STATE_TONES[state], state }, text: label });
  }

  function formatMs(ms) {
    return ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s` : `${ms} ms`;
  }
  function formatRate(rate) {
    if (!rate) return '0%';
    return rate < 0.001 ? '<0.1%' : `${(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}%`;
  }

  /** Requests, errors and response times over the last hour, from the replica that answered. */
  function trafficSection(metrics) {
    if (!metrics) return [];
    const { totals, database } = metrics;
    const routeTable = (title, routes) => el('section', { class: 'card table-card' }, [
      el('div', { class: 'card-header' }, [el('h3', { class: 'card-title', text: title })]),
      routes.length
        ? el('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': title }, [el('table', { class: 'table' }, [
          el('thead', {}, [el('tr', {}, [el('th', { text: 'Route' }), el('th', { class: 'num', text: 'Requests' }), el('th', { class: 'num', text: 'Errors' }), el('th', { class: 'num', text: 'Median' }), el('th', { class: 'num', text: 'p95' })])]),
          el('tbody', {}, routes.map((route) => el('tr', { dataset: { route: route.route } }, [
            el('td', {}, [el('code', { class: 'route', text: route.route })]),
            el('td', { class: 'num', text: numberFormat.format(route.count) }),
            el('td', { class: route.errorRate > 0.01 ? 'num danger-text' : 'num', text: formatRate(route.errorRate) }),
            el('td', { class: 'num', text: formatMs(route.p50Ms) }),
            el('td', { class: route.p95Ms > 1000 ? 'num warning-text' : 'num', text: formatMs(route.p95Ms) }),
          ]))),
        ])])
        : el('p', { class: 'card-description pad', text: 'Not enough requests yet.' }),
    ]);
    const uptimeHours = metrics.uptimeSeconds / 3600;
    const uptime = uptimeHours >= 24 ? `${Math.floor(uptimeHours / 24)}d ${Math.floor(uptimeHours % 24)}h` : uptimeHours >= 1 ? `${Math.floor(uptimeHours)}h ${Math.floor((metrics.uptimeSeconds % 3600) / 60)}m` : `${Math.max(1, Math.floor(metrics.uptimeSeconds / 60))}m`;
    return [
      el('h2', { class: 'section-title', text: `Traffic · last ${metrics.windowMinutes} minutes` }),
      el('div', { class: 'kpis traffic-kpis' }, [
        kpiCard({ label: 'Requests', value: formatNumber(totals.count), foot: `${formatNumber(Math.round(totals.count / Math.max(1, metrics.perMinute.length)))} a minute` }),
        kpiCard({ label: 'Server errors', value: formatRate(totals.errorRate), foot: `${formatRate(totals.unavailableRate ?? 0)} unavailable (Google, storage) · ${formatRate(totals.clientErrorRate)} refused (4xx)` }),
        kpiCard({ label: 'Response time p95', value: formatMs(totals.p95Ms), foot: `Median ${formatMs(totals.p50Ms)}` }),
        kpiCard({ label: 'Database connections', value: database ? `${database.total - database.idle} / ${database.max}` : '—', foot: database ? (database.waiting ? `${database.waiting} waiting` : 'In use / limit') : 'Not connected' }),
      ]),
      el('div', { class: 'panels' }, [routeTable('Busiest routes', metrics.routes.slice(0, 8)), routeTable('Slowest routes', metrics.slowest)]),
      el('p', { class: 'page-subtitle', text: `Server ${metrics.replica} · up ${uptime} · memory ${metrics.process.rssMb} MB${metrics.process.eventLoopDelayP99Ms !== null ? ` · event-loop delay p99 ${metrics.process.eventLoopDelayP99Ms} ms` : ''}. Each server counts its own requests.` }),
    ];
  }

  async function renderSystem(generation) {
    const detail = async (path) => {
      try { return await api('GET', path); }
      catch (error) {
        // A revoked session or staff role must not look like missing monitoring data.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
        return null;
      }
    };
    const [health, ready, system, metrics] = await Promise.all([probe('/health'), probe('/ready'), detail('/admin/system'), detail('/admin/metrics')]);
    if (!isCurrentRender(generation)) return;
    const row = (name, description, result) => el('li', { class: 'status-row' }, [
      el('div', {}, [el('div', { class: 'status-name', text: name }), el('div', { class: 'status-desc', text: description })]),
      el('span', { class: 'status-value' }, [
        el('span', { class: 'status-ms', text: result.ms === null ? 'No response' : `${result.ms} ms` }),
        statusBadge(result.ok ? 'ok' : 'down', result.ok ? 'Operational' : 'Down'),
      ]),
    ]);
    const setup = setupRows(system);
    const missing = [!system ? 'Service setup' : null, !metrics ? 'Traffic metrics' : null].filter(Boolean);
    const retry = el('button', { type: 'button', class: 'button', text: 'Retry details' });
    retry.addEventListener('click', () => void render());
    const runbook = (file, label) => el('li', {}, [el('a', { href: `https://github.com/alidd11/rider-comms/blob/main/${file}`, target: '_blank', rel: 'noopener noreferrer' }, [el('span', { text: label }), icon('external')])]);
    pageEl.replaceChildren(
      pageHeader('System', `Checked ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} from this browser`),
      ...(missing.length ? [el('section', { class: 'card system-warning', role: 'status' }, [
        el('div', {}, [el('div', { class: 'status-name', text: 'Some system details are unavailable' }),
          el('p', { class: 'card-description', text: `${missing.join(' and ')} could not be loaded. Other results below may still be current.` })]),
        retry,
      ])] : []),
      el('section', { class: 'card' }, [el('ul', { class: 'status-list' }, [
        row('API', 'Backend process is running', health),
        row('Database', 'Postgres reachable and migrations applied', ready),
      ])]),
      ...(setup.length ? [el('h2', { class: 'section-title', text: 'Setup' }), el('section', { class: 'card' }, [el('ul', { class: 'status-list' }, setup)])] : []),
      ...trafficSection(metrics),
      el('h2', { class: 'section-title', text: 'Runbooks' }),
      el('section', { class: 'card' }, [el('ul', { class: 'link-list' }, [
        runbook('MODERATION.md', 'Moderation and this dashboard'),
        runbook('BACKUP_RESTORE.md', 'Backups and restore'),
        runbook('RETENTION.md', 'Data retention'),
        runbook('SELF_HOSTED_VOICE.md', 'Self-hosted voice'),
        runbook('AUDIT.md', 'Engineering audit'),
      ])]),
      el('p', { class: 'page-subtitle', text: 'Errors and crashes are emailed to admins automatically, at most once every 15 minutes.' }),
    );
  }

  // ------------------------------------------------------------ Shell

  function notice(iconName, title, text) {
    navEl.hidden = true;
    pageEl.replaceChildren(el('div', { class: 'card notice' }, [emptyState(iconName, title, text)]));
  }

  async function render() {
    const generation = ++renderGeneration;
    const key = renderKey();
    const focusHeading = focusHeadingOnNextRender;
    focusHeadingOnNextRender = false;
    for (const button of navEl.querySelectorAll('[data-view]')) {
      if (button.dataset.view === (view === 'rider' ? 'riders' : view)) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    document.title = `${VIEW_TITLES[view]} · Rider Comms Operations Hub`;
    document.getElementById('brandSection').textContent = VIEW_TITLES[view === 'rider' ? 'riders' : view];
    document.getElementById('workspaceCurrentSection').textContent = VIEW_TITLES[view === 'rider' ? 'riders' : view];
    // Refresh the current section in place; skeletons are for navigation only.
    // Keep inbox filter controls available during a source refresh.
    const refreshing = key === displayedKey ||
      (view === 'inbox' && displayedKey?.startsWith('["inbox",'));
    if (!refreshing) {
      if (view === 'overview') pageEl.replaceChildren(...skeletonOverview());
      else pageEl.replaceChildren(pageHeader(VIEW_TITLES[view], 'Loading…'), ...skeletonList());
    }
    setBusy(true);
    try {
      if (view === 'overview') {
        const overview = await api('GET', '/admin/overview');
        if (!isCurrentRender(generation)) return;
        overviewCache = overview;
        updateReportCount(overviewCache.safety.openReports);
        renderOverview(overviewCache);
      } else if (view === 'inbox') {
        await renderInbox(generation);
      } else if (view === 'riders') {
        const { riders } = await api('GET', `/admin/riders?limit=50&q=${encodeURIComponent(riderQuery)}`);
        if (!isCurrentRender(generation)) return;
        renderRiders(riders);
      } else if (view === 'moderation') {
        await renderModeration(generation);
      } else if (view === 'audit') {
        await renderAudit(generation);
      } else if (view === 'staff') {
        await renderStaff(generation);
      } else if (view === 'rider') {
        await renderRiderDetail(detailRiderId, generation);
      } else {
        await renderSystem(generation);
      }
      if (isCurrentRender(generation)) {
        displayedKey = key;
        if (view === 'moderation' && inboxFocusTarget) {
          // Match data values as strings, not interpolated CSS selectors.
          const { type, id } = inboxFocusTarget;
          const attribute = type === 'rider_report' ? 'reportId' : 'postId';
          const target = [...pageEl.querySelectorAll(type === 'rider_report' ? '[data-report-id]' : '[data-post-id]')]
            .find((element) => element.dataset[attribute] === id);
          if (target) {
            target.setAttribute('tabindex', '-1');
            target.focus({ preventScroll: true });
            target.scrollIntoView({ block: 'start', behavior: 'auto' });
          } else {
            // A 404 has its own explicit unavailable state. Never infer a
            // resolved or moved case from a bounded queue's missing item.
            const unavailable = pageEl.querySelector('[data-selected-unavailable]');
            if (unavailable) unavailable.focus({ preventScroll: true });
          }
        }
        if (focusHeading && (document.activeElement === document.body || document.activeElement === menuToggle || document.activeElement?.closest('.nav') || document.activeElement?.closest('.sidebar-search-slot') || document.activeElement?.closest('.brand-actions'))) {
          pageEl.querySelector('.page-title')?.focus({ preventScroll: true });
        }
      }
    } catch (error) {
      if (!isCurrentRender(generation)) return;
      inboxFocusTarget = null;
      if (refreshing && !(error instanceof ApiError && (error.status === 401 || error.status === 403))) {
        flash('Couldn’t refresh this section. Showing the last loaded data; try refreshing again.', 'warning');
        return;
      }
      displayedKey = null;
      if (error instanceof ApiError && error.code === 'permission_required') {
        pageEl.replaceChildren(pageHeader(VIEW_TITLES[view], null), el('div', { class: 'card' }, [emptyState('lock', 'Your role doesn’t include this page', 'Ask an admin if you need it.')]));
      } else if (error instanceof ApiError && error.status === 403) {
        notice('lock', 'This account is not staff', 'Ask an admin to give your account a staff role, then reload.');
      } else if (error instanceof ApiError && error.status === 401) {
        notice('lock', 'Your session has expired', 'Sign in to the Rider Comms app in this browser, then reload this page.');
      } else {
        const retry = el('button', { type: 'button', class: 'button button-primary', text: 'Retry' });
        retry.addEventListener('click', () => void render());
        pageEl.replaceChildren(pageHeader(VIEW_TITLES[view], null), el('div', { class: 'card' }, [
          emptyState('wifiOff', 'Couldn’t load this section', 'Check your connection and try again.'),
          el('div', { class: 'retry-action' }, [retry]),
        ]));
      }
    } finally {
      if (isCurrentRender(generation)) setBusy(false);
    }
  }

  function selectView(hash) {
    const next = parseHash(hash);
    if ((next.view === 'overview' && hash !== 'overview' && hash !== '')
      || (me && !allowed(VIEW_PERMISSIONS[next.view]))) {
      const current = view === 'rider' ? `rider/${detailRiderId}` : view;
      history.replaceState(null, '', `#${current}`);
      return;
    }
    if (next.view === view && next.riderId === detailRiderId) return;
    if (next.view !== 'moderation') inboxFocusTarget = null;
    view = next.view;
    detailRiderId = next.riderId;
    focusHeadingOnNextRender = true;
    const target = view === 'rider' ? `rider/${detailRiderId}` : view;
    if (location.hash !== `#${target}`) history.pushState(null, '', `#${target}`);
    window.scrollTo(0, 0);
    void render();
  }

  // Phones: the sections are in a side menu. It closes on a choice, a tap
  // outside or Escape, and gives focus back to the menu button.
  const appEl = document.querySelector('.app');
  const menuToggle = document.getElementById('menuToggle');
  const menuBackdrop = document.getElementById('menuBackdrop');
  function setMenu(open) {
    appEl.classList.toggle('menu-open', open);
    document.body.classList.toggle('menu-visible', open);
    menuBackdrop.hidden = !open;
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (open) (navEl.querySelector('[aria-current="page"]') || navEl.querySelector('[data-view]:not([hidden])'))?.focus();
  }
  menuToggle.addEventListener('click', () => {
    const open = !appEl.classList.contains('menu-open');
    setMenu(open);
    if (!open) menuToggle.focus();
  });
  menuBackdrop.addEventListener('click', () => { setMenu(false); menuToggle.focus(); });
  document.addEventListener('keydown', (event) => {
    if (!appEl.classList.contains('menu-open')) return;
    if (event.key === 'Escape') { setMenu(false); menuToggle.focus(); return; }
    if (event.key !== 'Tab') return;
    const focusables = [...document.querySelectorAll('.sidebar button:not([disabled]):not([hidden])')]
      .filter((element) => element.getClientRects().length > 0);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && (document.activeElement === first || !focusables.includes(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !focusables.includes(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  });
  for (const button of navEl.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
    if (appEl.classList.contains('menu-open')) { setMenu(false); menuToggle.focus(); }
    selectView(button.dataset.view);
  });
  // Links to a rider (#rider/<id>) open their page.
  pageEl.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[data-rider-link]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    selectView(`rider/${link.dataset.riderLink}`);
  });
  window.addEventListener('hashchange', () => selectView(location.hash.slice(1)));
  window.addEventListener('popstate', () => selectView(location.hash.slice(1)));

  // Command search only offers authorised sections and the existing rider lookup API.
  // All rider data remains text-only, never interpolated into HTML.
  const searchDialog = document.getElementById('globalSearchDialog');
  const searchInput = document.getElementById('globalSearchInput');
  const searchSectionResults = document.getElementById('globalSearchSections');
  const searchRiderResults = document.getElementById('globalSearchRiders');
  const searchStatus = document.getElementById('globalSearchStatus');
  const desktopSearchTrigger = document.getElementById('globalSearchTrigger');
  const mobileSearchTrigger = document.getElementById('globalSearchMobile');
  const workspaceSearchTrigger = document.getElementById('workspaceSearchTrigger');
  let searchOpener = null;
  let searchTimer = null;
  let searchGeneration = 0;

  function searchOption(title, subtitle, type, navigate) {
    const option = el('button', { type: 'button', class: 'search-result' }, [
      el('span', { class: 'search-result-main' }, [
        el('span', { class: 'search-result-title', text: title }),
        subtitle ? el('span', { class: 'search-result-sub', text: subtitle }) : null,
      ]),
      el('span', { class: 'search-result-type', text: type }),
    ]);
    option.addEventListener('click', () => {
      searchDialog.close();
      navigate();
    });
    return option;
  }
  function searchGroup(label, results) {
    if (results.length === 0) return [];
    return [el('div', { class: 'search-result-group', text: label }), ...results];
  }
  function updateCommandSearch() {
    const generation = ++searchGeneration;
    clearTimeout(searchTimer);
    const term = searchInput.value.trim();
    const normalized = term.toLowerCase();
    const sections = [...navEl.querySelectorAll('[data-view]')]
      .filter((button) => !button.hidden && (!term || VIEW_TITLES[button.dataset.view].toLowerCase().includes(normalized)))
      .map((button) => searchOption(VIEW_TITLES[button.dataset.view], 'Open dashboard section', 'Page', () => selectView(button.dataset.view)));
    searchSectionResults.replaceChildren(...searchGroup('Pages', sections));
    searchRiderResults.replaceChildren();
    if (!allowed('view_riders')) {
      searchStatus.textContent = sections.length ? '' : 'No matching sections are available to your role.';
      return;
    }
    if (term.length < 2) {
      searchStatus.textContent = 'Enter at least two characters to search rider accounts.';
      return;
    }
    searchStatus.textContent = 'Searching rider accounts…';
    searchTimer = setTimeout(async () => {
      try {
        const response = await api('GET', '/admin/riders?limit=8&q=' + encodeURIComponent(term));
        if (!searchDialog.open || generation !== searchGeneration) return;
        const riders = Array.isArray(response.riders) ? response.riders : [];
        const options = riders.filter((rider) => typeof rider.riderId === 'string' && /^rider_[A-Za-z0-9_-]{1,58}$/.test(rider.riderId)).map((rider) =>
          searchOption(rider.displayName || rider.username || rider.handle || rider.riderId,
            [rider.handle, rider.riderId].filter(Boolean).join(' · '),
            'Rider', () => selectView('rider/' + rider.riderId)));
        searchRiderResults.replaceChildren(...searchGroup('Rider accounts', options));
        searchStatus.textContent = options.length ? '' : 'No matching riders found.';
      } catch (error) {
        if (!searchDialog.open || generation !== searchGeneration) return;
        searchStatus.textContent = error instanceof ApiError && (error.status === 401 || error.status === 403)
          ? 'Your staff access has changed. Refresh the dashboard to continue.'
          : 'Rider search is unavailable. You can still open a dashboard section.';
      }
    }, 220);
  }
  function openCommandSearch(trigger) {
    // Never cover a password confirmation or another sensitive staff action.
    if (!me || searchDialog.open || document.querySelector('dialog[open]')) return;
    searchOpener = appEl.classList.contains('menu-open') ? mobileSearchTrigger : trigger;
    if (appEl.classList.contains('menu-open')) setMenu(false);
    searchInput.value = '';
    searchDialog.showModal();
    updateCommandSearch();
    searchInput.focus();
  }
  desktopSearchTrigger.addEventListener('click', () => openCommandSearch(desktopSearchTrigger));
  mobileSearchTrigger.addEventListener('click', () => openCommandSearch(mobileSearchTrigger));
  workspaceSearchTrigger.addEventListener('click', () => openCommandSearch(workspaceSearchTrigger));
  document.getElementById('globalSearchClose').addEventListener('click', () => searchDialog.close());
  searchInput.addEventListener('input', updateCommandSearch);
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      const first = searchDialog.querySelector('.search-result');
      if (first) { event.preventDefault(); first.focus(); }
    } else if (event.key === 'Enter') {
      const first = searchDialog.querySelector('.search-result');
      if (first) { event.preventDefault(); first.click(); }
    }
  });
  searchDialog.addEventListener('close', () => {
    ++searchGeneration;
    clearTimeout(searchTimer);
    if (searchOpener?.isConnected && searchOpener.getClientRects().length) searchOpener.focus();
    searchOpener = null;
  });
  // Some mobile Chromium/tablet configurations do not automatically dismiss
  // a modal <dialog> on a simulated hardware Escape key. Handle it explicitly
  // before the sidebar's own Escape listener and leave other dialogs alone.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !searchDialog.open) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    searchDialog.close();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (searchDialog.open || !me || event.altKey) return;
    const editable = event.target?.closest?.('input, textarea, select, [contenteditable="true"]');
    if (((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')
      || (event.key === '/' && !event.metaKey && !event.ctrlKey && !editable)) {
      event.preventDefault();
      openCommandSearch(innerWidth < 900 ? mobileSearchTrigger : desktopSearchTrigger);
    }
  });

  refreshMobile.addEventListener('click', () => void render());
  let resizeTimer;
  window.addEventListener('resize', () => {
    if (innerWidth >= 900 && appEl.classList.contains('menu-open')) setMenu(false);
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (view === 'overview') for (const chart of pageEl.querySelectorAll('.chart-card')) chart.redraw?.();
    }, 150);
  });

  if (!session) {
    notice('lock', 'Sign in to continue', 'Sign in to the Rider Comms app in this browser (on this same site), then reload this page.');
    return;
  }
  footerEl.textContent = `Signed in as ${session.riderId}`;
  const footerRole = el('span', { class: 'footer-role' });
  api('GET', `/riders/${encodeURIComponent(session.riderId)}/profile`).then((profile) => {
    const name = profile?.displayName || profile?.handle;
    if (name) footerEl.replaceChildren(`Signed in as ${name}${profile.handle && profile.displayName ? ` · ${profile.handle}` : ''}`, footerRole);
  }).catch(() => {});

  // The role decides which pages appear; the backend enforces it either way.
  async function start() {
    try {
      me = await api('GET', '/admin/me');
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) notice('lock', 'This account is not staff', 'Ask an admin to give your account a staff role, then reload.');
      else if (error instanceof ApiError && error.status === 401) notice('lock', 'Your session has expired', 'Sign in to the Rider Comms app in this browser, then reload this page.');
      else {
        const retry = el('button', { type: 'button', class: 'button button-primary', text: 'Try again' });
        retry.addEventListener('click', () => void start());
        pageEl.replaceChildren(el('div', { class: 'card notice' }, [
          emptyState('wifiOff', 'Couldn’t reach the server', 'Check your connection and try again.'),
          el('div', { class: 'retry-action' }, [retry]),
        ]));
      }
      return;
    }
    for (const button of navEl.querySelectorAll('[data-view]')) button.hidden = !allowed(button.dataset.permission);
    for (const group of navEl.querySelectorAll('[data-nav-group]')) {
      group.hidden = ![...group.querySelectorAll('[data-view]')].some((button) => !button.hidden);
    }
    document.querySelector('.sidebar-search-slot').hidden = false;
    document.getElementById('globalSearchTrigger').hidden = false;
    document.getElementById('globalSearchMobile').hidden = false;
    workspaceSearchTrigger.hidden = false;
    footerRole.replaceChildren(roleBadge(me.role));
    if (!footerEl.contains(footerRole)) footerEl.append(footerRole);
    if (!allowed(VIEW_PERMISSIONS[view])) {
      view = VIEWS.find((candidate) => allowed(VIEW_PERMISSIONS[candidate])) ?? 'system';
      detailRiderId = null;
      history.replaceState(null, '', `#${view}`);
    }
    navEl.hidden = false;
    void render();
  }
  void start();
})();
