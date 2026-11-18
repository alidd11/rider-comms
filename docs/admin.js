// Rider Comms staff dashboard: business overview, riders, moderation, the
// audit log, staff roles and system health. Uses the PWA's own sign-in on
// this origin (same session storage key), so staff sign in to the app in this
// browser first. Each staff member has one role (admin, moderator, support or
// analyst; backend/src/staffRoles.ts). The backend re-checks the role on
// every /admin and /moderation request; this page only decides what to show.
//
// Rider-supplied text (names, report details, notes) is only ever inserted
// with textContent, never parsed as HTML.
(() => {
  const API_BASE_URL = 'https://backend-production-7fa0.up.railway.app';
  const SESSION_KEY = 'rider-comms-session-v1';
  const PERIOD_KEY = 'rider-comms-admin-period';
  const MAX_NOTE_LENGTH = 1000;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const VIEWS = ['overview', 'riders', 'moderation', 'audit', 'staff', 'system'];
  const VIEW_TITLES = { overview: 'Overview', riders: 'Riders', moderation: 'Moderation', audit: 'Audit log', staff: 'Staff and roles', system: 'System' };
  const VIEW_PERMISSIONS = { overview: 'view_overview', riders: 'view_riders', moderation: 'moderate', audit: 'view_audit', staff: 'manage_staff', system: 'view_system' };
  const ROLE_LABELS = { admin: 'Admin', moderator: 'Moderator', support: 'Support', analyst: 'Analyst' };
  const ROLE_TONES = { admin: 'accent', moderator: 'warning', support: 'success', analyst: null };
  // What each role can do, in words; mirrors backend/src/staffRoles.ts.
  const ROLE_SUMMARIES = [
    ['admin', 'Everything, including adding and removing staff. Set with ADMIN_RIDER_IDS on the backend.'],
    ['moderator', 'Reports, hidden Social posts and suspensions. Can look riders up and read the audit log.'],
    ['support', 'Account help: looks riders up and verifies email. Cannot suspend or see reports.'],
    ['analyst', 'Overview and system status only. No rider details, reports or notes.'],
  ];
  const PERMISSION_LABELS = [
    ['view_overview', 'Overview'], ['view_riders', 'Rider lookup'], ['moderate', 'Moderation'],
    ['verify_email', 'Verify email'], ['view_audit', 'Audit log'], ['manage_staff', 'Staff'], ['view_system', 'System'],
  ];
  const ROLE_MATRIX = {
    admin: ['view_overview', 'view_riders', 'moderate', 'verify_email', 'view_audit', 'manage_staff', 'view_system'],
    moderator: ['view_overview', 'view_riders', 'moderate', 'view_audit', 'view_system'],
    support: ['view_overview', 'view_riders', 'verify_email', 'view_audit', 'view_system'],
    analyst: ['view_overview', 'view_system'],
  };
  const REASON_LABELS = {
    harassment: 'Harassment',
    unsafe: 'Unsafe riding or behaviour',
    spam: 'Spam',
    sexual: 'Sexual content',
    other: 'Other',
  };
  const ACTION_LABELS = { dismiss: 'Dismissed a report', suspend: 'Suspended rider', unsuspend: 'Unsuspended rider', verify_email: 'Verified email', social_post_restore: 'Restored a Social post', social_post_remove: 'Removed a Social post', staff_grant: 'Gave a staff role', staff_revoke: 'Removed a staff role' };
  const ACTION_GROUPS = [
    ['all', 'All actions', null],
    ['reports', 'Reports', ['dismiss', 'suspend', 'unsuspend']],
    ['social', 'Social posts', ['social_post_restore', 'social_post_remove']],
    ['accounts', 'Accounts', ['verify_email']],
    ['staff', 'Staff', ['staff_grant', 'staff_revoke']],
  ];

  const pageEl = document.getElementById('page');
  const navEl = document.getElementById('nav');
  const footerEl = document.getElementById('sidebarFooter');
  const reportCountEl = document.getElementById('navReportCount');
  const refreshMobile = document.getElementById('refreshMobile');

  let view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  let period = readPeriod();
  let moderationView = 'open';
  let riderQuery = '';
  let auditGroup = 'all';
  let auditRider = '';
  let me = null;
  const allowed = (permission) => Boolean(me?.permissions?.includes(permission));
  let overviewCache = null;
  let chartSeq = 0;
  const names = new Map();

  // ------------------------------------------------------------ Utilities

  function readPeriod() {
    try { return localStorage.getItem(PERIOD_KEY) === '30' ? 30 : 7; } catch { return 7; }
  }
  function savePeriod(value) {
    try { localStorage.setItem(PERIOD_KEY, String(value)); } catch { /* Per-browser preference only. */ }
  }

  function readSession() {
    for (const storage of [localStorage, sessionStorage]) {
      try {
        const stored = JSON.parse(storage.getItem(SESSION_KEY) || 'null');
        if (stored?.token && stored?.riderId) return stored;
      } catch { /* Ignore unreadable storage. */ }
    }
    return null;
  }
  const session = readSession();

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
  function person(name, sub, key) {
    return el('div', { class: 'person' }, [
      avatar(name, key),
      el('div', { class: 'person-text' }, [
        el('div', { class: 'person-name', text: name }),
        sub ? el('div', { class: 'person-sub', text: sub }) : null,
      ]),
    ]);
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
      el('div', {}, [el('h1', { class: 'page-title', text: title }), subtitle ? el('p', { class: 'page-subtitle', text: subtitle }) : null]),
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

    const reportsLink = safety.openReports > 0 ? el('a', { href: '#moderation', text: 'Review queue' }) : null;
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
    }, 'Period');
    pageEl.replaceChildren(
      pageHeader('Overview', `Updated ${new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · days in UTC`, [periodControl]),
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
      const note = window.prompt(`Mark ${rider.username}'s email as verified? Only do this for riders you know. Note for the audit log:`, 'Known rider; verification email not delivered.');
      if (note === null) return;
      if (!note.trim()) {
        window.alert('A note is required. Every staff action is recorded with its reason.');
        return;
      }
      button.disabled = true;
      try {
        await api('POST', `/moderation/riders/${encodeURIComponent(rider.riderId)}/verify-email`, { note: note.trim() });
        await render();
      } catch (error) {
        button.disabled = false;
        window.alert(error instanceof ApiError && error.code === 'already_verified' ? 'This rider is already verified.' : actionErrorMessage(error));
      }
    });
    return button;
  }

  function renderRiders(riders) {
    const form = el('form', { class: 'toolbar', role: 'search' });
    const input = el('input', { class: 'input', type: 'search', name: 'q', placeholder: 'Search name, username, email or ID', 'aria-label': 'Search riders', maxlength: 100, autocomplete: 'off' });
    input.value = riderQuery;
    form.append(el('div', { class: 'search' }, [icon('search'), input]), el('button', { type: 'submit', class: 'button', text: 'Search' }));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      riderQuery = input.value.trim();
      void render();
    });

    const displayName = (rider) => rider.displayName || rider.username;
    const content = riders.length === 0
      ? el('div', { class: 'card' }, [emptyState('users', 'No riders found', riderQuery ? `Nothing matches “${riderQuery}”. Try a username, email or rider ID.` : 'Riders appear here once they sign up.')])
      : [
        el('div', { class: 'card only-mobile' }, [el('ul', { class: 'list' }, riders.map((rider) => el('li', { class: 'list-row', dataset: { riderId: rider.riderId } }, [
          person(displayName(rider), [rider.handle, rider.email].filter(Boolean).join(' · '), rider.riderId),
          el('div', { class: 'trail' }, [riderBadges(rider), verifyEmailButton(rider), el('div', {}, [timeEl(rider.lastSeenAt, 'Inactive')])]),
        ])))]),
        el('div', { class: 'card table-card only-desktop' }, [el('div', { class: 'table-scroll' }, [el('table', { class: 'table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'Rider' }), el('th', { text: 'Email' }), el('th', { text: 'Status' }),
            el('th', { text: 'Joined' }), el('th', { text: 'Last active' }), el('th', { class: 'num', text: 'Friends' }), el('th', { class: 'num', text: 'Reports' }),
          ])]),
          el('tbody', {}, riders.map((rider) => el('tr', { dataset: { riderId: rider.riderId } }, [
            el('td', {}, [person(displayName(rider), [rider.handle, rider.riderId].filter(Boolean).join(' · '), rider.riderId)]),
            el('td', { class: 'muted', text: rider.email || '—' }),
            el('td', {}, [riderBadges(rider), verifyEmailButton(rider)]),
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
    if (error.code === 'forbidden_target') return 'You cannot suspend yourself or another admin.';
    if (error.code === 'not_suspended') return 'This rider is not suspended.';
    if (error.code === 'reauth_cancelled') return 'Not changed: your password is needed for staff changes.';
    if (error.status === 403) return 'Your account is no longer staff.';
    return `Failed: ${error.code || error.message}`;
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
      if (button.dataset.action === 'suspend'
        && !window.confirm('Suspend this rider? They are signed out everywhere and cannot sign in until unsuspended.')) return;
      if (button.dataset.action === 'remove'
        && !window.confirm('Remove this post for everyone? Its photos or video are deleted. This can’t be undone.')) return;
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

  function reportCard(report) {
    const { source, details } = splitReportSource(report.details);
    const card = el('article', { class: 'card report', dataset: { reportId: report.id } }, [
      el('div', { class: 'report-head' }, [
        el('div', { class: 'badges' }, [
          badge(REASON_LABELS[report.reason] || report.reason, report.status === 'open' ? 'warning' : null),
          source ? badge(`From ${source}`, null, true) : null,
          report.reportsAgainstRider > 1 ? badge(`${report.reportsAgainstRider} reports against this rider`, null, true) : null,
          report.reportedRiderSuspended ? badge('Suspended', 'danger') : null,
        ]),
        el('span', { class: 'report-time' }, [timeEl(report.createdAt)]),
      ]),
      el('div', { class: 'report-people' }, [personBlock('Reported rider', report.reportedRiderId), personBlock('Reported by', report.reporterId)]),
      el('p', { class: details ? 'report-details' : 'report-details empty', text: details || 'No details given.' }),
      report.status !== 'open'
        ? el('p', { class: 'report-meta' }, [`${report.status === 'dismissed' ? 'Dismissed' : 'Actioned'} `, timeEl(report.resolvedAt), ` by ${riderLabel(report.resolvedBy).name}`])
        : null,
    ]);
    if (report.status === 'open' || report.reportedRiderSuspended) {
      const note = el('textarea', { class: 'note', maxlength: MAX_NOTE_LENGTH, 'aria-label': `Note for report ${report.id}`, placeholder: 'Note for the audit log (required)' });
      const actions = el('div', { class: 'actions' });
      if (report.status === 'open') {
        const dismiss = el('button', { type: 'button', class: 'button', dataset: { action: 'dismiss' }, text: 'Dismiss' });
        const suspend = el('button', { type: 'button', class: 'button button-danger', dataset: { action: 'suspend' }, text: 'Suspend rider' });
        actions.append(dismiss, suspend);
        wireAction(card, dismiss, note, (text) => api('POST', `/moderation/reports/${encodeURIComponent(report.id)}/resolve`, { resolution: 'dismiss', note: text }));
        wireAction(card, suspend, note, (text) => api('POST', `/moderation/reports/${encodeURIComponent(report.id)}/resolve`, { resolution: 'suspend', note: text }));
      }
      if (report.reportedRiderSuspended) {
        const unsuspend = el('button', { type: 'button', class: 'button', dataset: { action: 'unsuspend' }, text: 'Unsuspend rider' });
        actions.append(unsuspend);
        wireAction(card, unsuspend, note, (text) => api('POST', `/moderation/riders/${encodeURIComponent(report.reportedRiderId)}/unsuspend`, { note: text }));
      }
      card.append(note, actions);
    }
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

  async function renderModeration() {
    const tabs = segmented([['open', 'Open'], ['social', 'Social posts'], ['dismissed', 'Dismissed'], ['actioned', 'Actioned']], moderationView, (next) => {
      moderationView = next;
      void render();
    }, 'Moderation queues');
    const header = pageHeader('Moderation', 'Every decision needs a note and is recorded in the audit log.', [tabs]);
    if (moderationView === 'social') {
      let posts = [];
      try {
        ({ posts } = await api('GET', '/moderation/social-posts?limit=100'));
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
      }
      await loadNames(posts.map((entry) => entry.post.authorId));
      pageEl.replaceChildren(header, el('div', { class: 'reports' }, posts.length
        ? posts.map(socialPostCard)
        : [el('div', { class: 'card' }, [emptyState('inbox', 'No hidden posts', 'Posts reported by three riders are hidden here until you restore or remove them.')])]));
      return;
    }
    const { reports } = await api('GET', `/moderation/reports?status=${moderationView}&limit=100`);
    await loadNames(reports.flatMap((report) => [report.reporterId, report.reportedRiderId, report.resolvedBy]));
    if (moderationView === 'open') updateReportCount(reports.length);
    pageEl.replaceChildren(header, el('div', { class: 'reports' }, reports.length
      ? reports.map(reportCard)
      : [el('div', { class: 'card' }, [emptyState('inbox', moderationView === 'open' ? 'No open reports' : 'Nothing here yet', moderationView === 'open' ? 'You’re all caught up.' : null)])]));
  }

  function updateReportCount(count) {
    reportCountEl.hidden = !count;
    reportCountEl.textContent = count > 99 ? '99+' : String(count);
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

  async function renderAudit() {
    const query = auditRider ? `&riderId=${encodeURIComponent(auditRider)}` : '';
    const { actions } = await api('GET', `/moderation/actions?limit=200${query}`);
    await loadNames(actions.flatMap((action) => [action.targetRiderId, action.moderatorId]));
    const group = ACTION_GROUPS.find(([id]) => id === auditGroup) ?? ACTION_GROUPS[0];
    const shown = group[2] ? actions.filter((action) => group[2].includes(action.action)) : actions;

    const filters = segmented(ACTION_GROUPS.map(([id, label]) => [id, label]), auditGroup, (next) => {
      auditGroup = next;
      void render();
    }, 'Filter the audit log');
    const form = el('form', { class: 'toolbar', role: 'search' });
    const input = el('input', { class: 'input', type: 'search', placeholder: 'Rider ID, e.g. rider_ab12cd34', 'aria-label': 'Show actions for one rider', maxlength: 100, autocomplete: 'off' });
    input.value = auditRider;
    form.append(el('div', { class: 'search' }, [icon('search'), input]), el('button', { type: 'submit', class: 'button', text: 'Filter' }));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      auditRider = input.value.trim();
      void render();
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
    const ask = (question) => {
      const note = window.prompt(question);
      if (note === null) return null;
      if (!note.trim()) {
        window.alert('A reason is required. Every staff change is recorded.');
        return null;
      }
      return note.trim();
    };
    select.addEventListener('change', async () => {
      const note = ask(`Change ${member.displayName || member.riderId} to ${ROLE_LABELS[select.value]}? Reason for the audit log:`);
      if (note === null) {
        select.value = member.role;
        return;
      }
      try {
        await api('POST', '/admin/staff', { rider: member.riderId, role: select.value, note });
        await render();
      } catch (error) {
        select.value = member.role;
        window.alert(staffErrorMessage(error));
      }
    });
    remove.addEventListener('click', async () => {
      const note = ask(`Remove ${member.displayName || member.riderId} from staff? Reason for the audit log:`);
      if (note === null) return;
      try {
        await api('POST', `/admin/staff/${encodeURIComponent(member.riderId)}/remove`, { note });
        await render();
      } catch (error) {
        window.alert(staffErrorMessage(error));
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

  async function renderStaff() {
    const [{ staff }, events] = await Promise.all([
      api('GET', '/admin/staff'),
      api('GET', '/admin/security-events?staff=1&limit=20').then((body) => body.events).catch(() => null),
    ]);
    await loadNames((events ?? []).map((event) => event.riderId));
    const counts = staff.reduce((total, member) => ({ ...total, [member.role]: (total[member.role] ?? 0) + 1 }), {});
    const name = (member) => member.displayName || member.handle || member.riderId;
    const sub = (member) => [member.handle, member.email].filter(Boolean).join(' · ') || member.riderId;
    const granted = (member) => member.grantedAt ? el('span', {}, [timeEl(member.grantedAt), ` by ${riderLabel(member.grantedBy).name}`]) : el('span', { class: 'muted', text: 'ADMIN_RIDER_IDS' });
    await loadNames(staff.map((member) => member.grantedBy).filter(Boolean));
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
      setting('Social posting', system.socialPosting ? 'ok' : 'warn', system.socialPosting ? 'On' : 'Off', system.socialPosting ? 'Riders can post to Rider Social' : 'Posting is switched off'),
    ];
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
        kpiCard({ label: 'Server errors', value: formatRate(totals.errorRate), foot: `${formatRate(totals.clientErrorRate)} refused (4xx)` }),
        kpiCard({ label: 'Response time p95', value: formatMs(totals.p95Ms), foot: `Median ${formatMs(totals.p50Ms)}` }),
        kpiCard({ label: 'Database connections', value: database ? `${database.total - database.idle} / ${database.max}` : '—', foot: database ? (database.waiting ? `${database.waiting} waiting` : 'In use / limit') : 'Not connected' }),
      ]),
      el('div', { class: 'panels' }, [routeTable('Busiest routes', metrics.routes.slice(0, 8)), routeTable('Slowest routes', metrics.slowest)]),
      el('p', { class: 'page-subtitle', text: `Server ${metrics.replica} · up ${uptime} · memory ${metrics.process.rssMb} MB${metrics.process.eventLoopDelayP99Ms !== null ? ` · event-loop delay p99 ${metrics.process.eventLoopDelayP99Ms} ms` : ''}. Each server counts its own requests.` }),
    ];
  }

  async function renderSystem() {
    const [health, ready, system, metrics] = await Promise.all([probe('/health'), probe('/ready'), api('GET', '/admin/system').catch(() => null), api('GET', '/admin/metrics').catch(() => null)]);
    const row = (name, description, result) => el('li', { class: 'status-row' }, [
      el('div', {}, [el('div', { class: 'status-name', text: name }), el('div', { class: 'status-desc', text: description })]),
      el('span', { class: 'status-value' }, [
        el('span', { class: 'status-ms', text: result.ms === null ? 'No response' : `${result.ms} ms` }),
        statusBadge(result.ok ? 'ok' : 'down', result.ok ? 'Operational' : 'Down'),
      ]),
    ]);
    const setup = setupRows(system);
    const runbook = (file, label) => el('li', {}, [el('a', { href: `https://github.com/alidd11/rider-comms/blob/main/${file}`, target: '_blank', rel: 'noopener noreferrer' }, [el('span', { text: label }), icon('external')])]);
    pageEl.replaceChildren(
      pageHeader('System', `Checked ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} from this browser`),
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
    for (const button of navEl.querySelectorAll('[data-view]')) {
      if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    document.title = `${VIEW_TITLES[view]} · Rider Comms staff`;
    if (view === 'overview' && !overviewCache) pageEl.replaceChildren(...skeletonOverview());
    else if (view !== 'overview') pageEl.replaceChildren(pageHeader(VIEW_TITLES[view], 'Loading…'), ...skeletonList());
    setBusy(true);
    try {
      if (view === 'overview') {
        overviewCache = await api('GET', '/admin/overview');
        updateReportCount(overviewCache.safety.openReports);
        renderOverview(overviewCache);
      } else if (view === 'riders') {
        const { riders } = await api('GET', `/admin/riders?limit=50&q=${encodeURIComponent(riderQuery)}`);
        renderRiders(riders);
      } else if (view === 'moderation') {
        await renderModeration();
      } else if (view === 'audit') {
        await renderAudit();
      } else if (view === 'staff') {
        await renderStaff();
      } else {
        await renderSystem();
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'permission_required') {
        pageEl.replaceChildren(pageHeader(VIEW_TITLES[view], null), el('div', { class: 'card' }, [emptyState('lock', 'Your role doesn’t include this page', 'Ask an admin if you need it.')]));
      } else if (error instanceof ApiError && error.status === 403) {
        notice('lock', 'This account is not staff', 'Ask an admin to give your account a staff role, then reload.');
      } else if (error instanceof ApiError && error.status === 401) {
        notice('lock', 'Your session has expired', 'Sign in to the Rider Comms app in this browser, then reload this page.');
      } else {
        pageEl.replaceChildren(pageHeader(VIEW_TITLES[view], null), el('div', { class: 'card' }, [emptyState('wifiOff', 'Couldn’t load this section', 'Check your connection, then refresh.')]));
      }
    } finally {
      setBusy(false);
    }
  }

  function selectView(next) {
    if (!VIEWS.includes(next) || (me && !allowed(VIEW_PERMISSIONS[next]))) return;
    view = next;
    if (location.hash !== `#${next}`) history.replaceState(null, '', `#${next}`);
    window.scrollTo(0, 0);
    void render();
  }

  for (const button of navEl.querySelectorAll('[data-view]')) button.addEventListener('click', () => selectView(button.dataset.view));
  window.addEventListener('hashchange', () => selectView(location.hash.slice(1)));
  refreshMobile.addEventListener('click', () => void render());
  let resizeTimer;
  window.addEventListener('resize', () => {
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
      else pageEl.replaceChildren(el('div', { class: 'card notice' }, [emptyState('wifiOff', 'Couldn’t reach the server', 'Check your connection, then reload.')]));
      return;
    }
    for (const button of navEl.querySelectorAll('[data-view]')) button.hidden = !allowed(button.dataset.permission);
    footerRole.replaceChildren(roleBadge(me.role));
    if (!footerEl.contains(footerRole)) footerEl.append(footerRole);
    if (!allowed(VIEW_PERMISSIONS[view])) view = VIEWS.find((candidate) => allowed(VIEW_PERMISSIONS[candidate])) ?? 'system';
    navEl.hidden = false;
    void render();
  }
  void start();
})();
