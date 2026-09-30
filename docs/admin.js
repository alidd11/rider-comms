// Staff dashboard: business overview, rider lookup, moderation and system
// health. Uses the Rider Comms PWA's own sign-in on this origin (the same
// session storage key), so staff sign in to the app in this browser first.
// The backend re-checks admin status on every /admin and /moderation
// request; this page only decides what to show.
//
// Rider-supplied text (report details, names, notes) is only ever inserted
// with textContent, never as HTML.
(() => {
  const API_BASE_URL = 'https://backend-production-7fa0.up.railway.app';
  const SESSION_KEY = 'rider-comms-session-v1';
  const MAX_NOTE_LENGTH = 1000;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const REASON_LABELS = {
    harassment: 'Harassment',
    unsafe: 'Unsafe riding or behaviour',
    spam: 'Spam',
    sexual: 'Sexual content',
    other: 'Other',
  };
  const ACTION_LABELS = { dismiss: 'Dismissed report', suspend: 'Suspended rider', unsuspend: 'Unsuspended rider' };
  const VIEWS = ['overview', 'riders', 'moderation', 'system'];

  const statusEl = document.getElementById('modStatus');
  const tabsEl = document.getElementById('modTabs');
  const listEl = document.getElementById('modList');
  let view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
  let moderationView = 'open';
  let riderQuery = '';
  const names = new Map();

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

  async function api(method, path, body) {
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

  function setStatus(text, tone = '') {
    statusEl.textContent = text;
    statusEl.dataset.tone = tone;
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else node.setAttribute(key, value);
    }
    for (const child of children) if (child) node.append(child);
    return node;
  }

  function svg(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  }

  const numberFormat = new Intl.NumberFormat();
  const compactFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
  function formatNumber(value) {
    return Math.abs(value) >= 10_000 ? compactFormat.format(value) : numberFormat.format(value);
  }
  function formatPercent(part, whole) {
    return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';
  }
  function formatTime(ms) {
    return ms ? new Date(ms).toLocaleString() : '';
  }
  function formatDay(isoDay, style = 'short') {
    return new Date(`${isoDay}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: style, timeZone: 'UTC' });
  }
  function formatAgo(ms) {
    if (!ms) return 'Not in the last 30 days';
    const minutes = Math.round((Date.now() - ms) / 60_000);
    if (minutes < 2) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} h ago`;
    return `${Math.round(hours / 24)} days ago`;
  }

  function riderLabel(riderId) {
    const profile = names.get(riderId);
    if (!profile) return riderId;
    return `${profile.displayName || 'Rider'} ${profile.handle || ''} (${riderId})`.replace(/\s+/g, ' ');
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

  // ---------------------------------------------------------------- Overview

  function tile(label, value, sub, link) {
    return el('div', { class: 'dash-tile' }, [
      el('p', { class: 'dash-tile-label', text: label }),
      el('p', { class: 'dash-tile-value', text: typeof value === 'number' ? formatNumber(value) : value }),
      sub ? el('p', { class: 'dash-tile-sub', text: sub }) : null,
      link ? el('a', { href: link.href, text: link.text }) : null,
    ]);
  }

  function section(title, children) {
    return [el('h2', { class: 'dash-section-title', text: title }), el('div', { class: 'dash-tiles' }, children)];
  }

  /** Smallest round axis top (4 steps of 1, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 x 10^n) at or above max. */
  function niceMax(max) {
    if (max <= 4) return 4;
    const magnitude = 10 ** Math.floor(Math.log10(max / 4));
    const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * magnitude).find((candidate) => candidate * 4 >= max);
    return step * 4;
  }

  /** Single-series daily column chart with hover tooltips and a table view. */
  function dailyChart(title, days, values, { summary, missingLabel = 'Not tracked yet' } = {}) {
    const card = el('section', { class: 'dash-chart', 'aria-label': title }, [
      el('h3', { text: title }),
      el('p', { class: 'dash-chart-summary', text: summary }),
    ]);
    const tooltip = el('div', { class: 'dash-tooltip', role: 'status', hidden: '' });
    const plot = svg('svg', { role: 'img', 'aria-label': `${title}, last ${days.length} days. Values are in the table below.` });
    card.append(plot, tooltip);

    const draw = () => {
      plot.replaceChildren();
      const width = Math.max(plot.clientWidth || 300, 200);
      const height = 150;
      const left = 32;
      const bottom = 20;
      const top = 6;
      const plotWidth = width - left;
      const plotHeight = height - bottom - top;
      const max = niceMax(Math.max(0, ...values.filter((v) => v !== null)));
      const band = plotWidth / days.length;
      const barWidth = Math.max(2, Math.min(24, band - 2));
      plot.setAttribute('viewBox', `0 0 ${width} ${height}`);

      for (const tick of [0, max / 2, max]) {
        const y = top + plotHeight - (tick / max) * plotHeight;
        plot.append(svg('line', { class: 'grid', x1: left, x2: width, y1: y, y2: y }));
        const label = svg('text', { class: 'axis-label', x: left - 6, y: y + 4, 'text-anchor': 'end' });
        label.textContent = formatNumber(tick);
        plot.append(label);
      }
      for (const index of [0, Math.floor(days.length / 2), days.length - 1]) {
        const label = svg('text', {
          class: 'axis-label',
          x: left + band * index + band / 2,
          y: height - 4,
          'text-anchor': index === 0 ? 'start' : index === days.length - 1 ? 'end' : 'middle',
        });
        label.textContent = formatDay(days[index]);
        plot.append(label);
      }

      days.forEach((day, index) => {
        const value = values[index];
        const x = left + band * index + (band - barWidth) / 2;
        const hit = svg('rect', { class: 'hit', x: left + band * index, y: top, width: band, height: plotHeight });
        plot.append(hit);
        let bar = null;
        if (value !== null && value > 0) {
          const barHeight = Math.max(1, (value / max) * plotHeight);
          const y = top + plotHeight - barHeight;
          const r = Math.min(4, barWidth / 2, barHeight);
          // Rounded data end, square at the baseline.
          bar = svg('path', {
            class: 'bar',
            d: `M${x},${y + barHeight} V${y + r} Q${x},${y} ${x + r},${y} H${x + barWidth - r} Q${x + barWidth},${y} ${x + barWidth},${y + r} V${y + barHeight} Z`,
          });
          plot.append(bar);
        }
        const show = () => {
          tooltip.replaceChildren(
            el('strong', { text: value === null ? missingLabel : formatNumber(value) }),
            el('span', { text: formatDay(day, 'long') }),
          );
          tooltip.hidden = false;
          const cardBox = card.getBoundingClientRect();
          const plotBox = plot.getBoundingClientRect();
          const scale = plotBox.width / width;
          const centre = plotBox.left - cardBox.left + (left + band * index + band / 2) * scale;
          const tooltipWidth = tooltip.offsetWidth;
          tooltip.style.left = `${Math.min(Math.max(centre - tooltipWidth / 2, 4), cardBox.width - tooltipWidth - 4)}px`;
          // Sits just above the plot (translateY(-100%) in CSS), never over the bars.
          tooltip.style.top = `${plotBox.top - cardBox.top - 4}px`;
          bar?.classList.add('active');
        };
        const hide = () => {
          tooltip.hidden = true;
          bar?.classList.remove('active');
        };
        hit.addEventListener('pointerenter', show);
        hit.addEventListener('pointerleave', hide);
      });
    };

    const rows = days.map((day, index) => el('tr', {}, [
      el('td', { text: formatDay(day, 'long') }),
      el('td', { class: 'num', text: values[index] === null ? '–' : numberFormat.format(values[index]) }),
    ]));
    card.append(el('details', {}, [
      el('summary', { text: 'Show table' }),
      el('table', { class: 'dash-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: 'Day (UTC)' }), el('th', { class: 'num', text: title })])]),
        el('tbody', {}, rows.reverse()),
      ]),
    ]));
    requestAnimationFrame(draw);
    card.redraw = draw;
    return card;
  }

  function sum(values) {
    return values.reduce((total, value) => total + (value ?? 0), 0);
  }

  function renderOverview(data) {
    const { riders, activity, social, content, safety, series } = data;
    const latestActive = [...series.activeRiders].reverse().find((value) => value !== null);
    const charts = [
      dailyChart('New signups per day', series.days, series.signups, {
        summary: `${numberFormat.format(sum(series.signups))} in the last 30 days`,
      }),
      dailyChart('Active riders per day', series.days, series.activeRiders, {
        summary: latestActive === undefined ? 'Tracking starts today' : `${numberFormat.format(latestActive)} today so far`,
      }),
      dailyChart('Rides started per day', series.days, series.ridesStarted, {
        summary: series.ridesStarted.every((value) => value === null)
          ? 'Tracking starts with the next ride'
          : `${numberFormat.format(sum(series.ridesStarted))} since tracking started`,
      }),
      dailyChart('Messages per day', series.days, series.messages, {
        summary: `${numberFormat.format(sum(series.messages))} in the last 30 days`,
      }),
    ];
    listEl.replaceChildren(
      el('p', { class: 'dash-updated', text: `Updated ${new Date(data.generatedAt).toLocaleTimeString()}. Days are UTC.` }),
      ...section('Riders', [
        tile('Total riders', riders.total),
        tile('New today', riders.newToday),
        tile('New this week', riders.new7d, `${formatNumber(riders.new30d)} in 30 days`),
        tile('Email verified', formatPercent(riders.verified, riders.total), `${formatNumber(riders.verified)} riders`),
        tile('Suspended', riders.suspended),
      ]),
      ...section('Engagement', [
        tile('Active today', activity.active24h, 'Used the app in the last 24 h'),
        tile('Active this week', activity.active7d),
        tile('Active this month', activity.active30d),
        tile('Stickiness', formatPercent(activity.active24h, activity.active30d), 'Daily ÷ monthly active'),
      ]),
      ...section('Live right now', [
        tile('Live on Nearby', activity.liveNearbyNow),
        tile('Rides in progress', activity.activeRides, `${formatNumber(activity.ridersInRides)} riders in rides`),
        tile('Location sharing on', activity.sharingLocation),
      ]),
      ...section('Social', [
        tile('Friendships', social.friendships),
        tile('Messages today', social.messages24h, `${formatNumber(social.messages7d)} this week`),
        tile('Pending friend requests', social.pendingFriendRequests),
      ]),
      ...section('Safety and content', [
        tile('Open reports', safety.openReports, `${formatNumber(safety.reports7d)} filed this week`,
          safety.openReports > 0 ? { href: '#moderation', text: 'Review the queue' } : null),
        tile('Moderation decisions', safety.moderationActions7d, 'This week'),
        tile('Active hazards', content.activeHazards),
        tile('Scenic routes', content.scenicRoutes),
        tile('Hideouts', content.hideouts),
      ]),
      el('h2', { class: 'dash-section-title', text: 'Last 30 days' }),
      el('div', { class: 'dash-charts' }, charts),
    );
  }

  // ------------------------------------------------------------------ Riders

  function renderRiders(riders) {
    const form = el('form', { class: 'dash-search', role: 'search' }, [
      el('input', { type: 'search', name: 'q', placeholder: 'Search username, email, name, handle or rider ID', 'aria-label': 'Search riders', maxlength: '100' }),
      el('button', { type: 'submit', text: 'Search' }),
    ]);
    form.q.value = riderQuery;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      riderQuery = form.q.value.trim();
      void render();
    });
    const rows = riders.map((rider) => {
      const badges = [rider.isAdmin ? 'Admin' : '', rider.suspended ? 'Suspended' : '', rider.emailVerified ? '' : 'Unverified'].filter(Boolean);
      return el('tr', { dataset: { riderId: rider.riderId } }, [
        el('td', {}, [
          el('div', { text: `${rider.displayName || rider.username} ${rider.handle || ''}`.trim() }),
          el('div', { class: 'mod-meta', text: rider.riderId }),
          ...badges.map((badge) => el('span', { class: 'mod-badge', dataset: { kind: badge === 'Suspended' ? 'suspended' : 'count' }, text: badge })),
        ]),
        el('td', { text: rider.username }),
        el('td', { text: rider.email || '–' }),
        el('td', { text: new Date(rider.createdAt).toLocaleDateString() }),
        el('td', { text: formatAgo(rider.lastSeenAt) }),
        el('td', { class: 'num', text: numberFormat.format(rider.friends) }),
        el('td', { class: 'num', text: numberFormat.format(rider.reportsAgainst) }),
      ]);
    });
    listEl.replaceChildren(
      form,
      el('p', { class: 'dash-updated', text: riderQuery ? `${riders.length} matching riders` : `Newest ${riders.length} riders` }),
      riders.length
        ? el('div', { class: 'dash-scroll' }, [el('table', { class: 'dash-table' }, [
          el('thead', {}, [el('tr', {}, ['Rider', 'Username', 'Email', 'Joined', 'Last active', 'Friends', 'Reports against'].map((heading, i) =>
            el('th', { class: i >= 5 ? 'num' : '', text: heading })))]),
          el('tbody', {}, rows),
        ])])
        : el('p', { class: 'mod-empty', text: 'No riders match that search.' }),
    );
  }

  // -------------------------------------------------------------- Moderation

  function noteField(label) {
    return el('textarea', {
      class: 'mod-note',
      maxlength: String(MAX_NOTE_LENGTH),
      'aria-label': label,
      placeholder: 'Note for the audit log (required)',
    });
  }

  function actionErrorMessage(error) {
    if (!(error instanceof ApiError)) return 'Could not reach the server. Try again.';
    if (error.code === 'already_resolved') return 'Someone already resolved this report. Refresh to see the latest queue.';
    if (error.code === 'forbidden_target') return 'You cannot suspend yourself or another admin.';
    if (error.code === 'not_suspended') return 'This rider is not suspended.';
    if (error.status === 403) return 'Your account is no longer an admin.';
    return `Failed: ${error.code || error.message}`;
  }

  function wireAction(card, button, note, run) {
    button.addEventListener('click', async () => {
      const text = note.value.trim();
      const errorEl = card.querySelector('.mod-error');
      if (!text) {
        errorEl.textContent = 'Write a note first. Every decision is recorded with its reason.';
        note.focus();
        return;
      }
      if (button.dataset.action === 'suspend'
        && !window.confirm('Suspend this rider? They are signed out everywhere and cannot sign in until unsuspended.')) return;
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

  function reportCard(report) {
    const badges = [
      report.reportsAgainstRider > 1
        ? el('span', { class: 'mod-badge', dataset: { kind: 'count' }, text: `${report.reportsAgainstRider} reports against this rider` })
        : null,
      report.reportedRiderSuspended ? el('span', { class: 'mod-badge', dataset: { kind: 'suspended' }, text: 'Suspended' }) : null,
    ];
    const card = el('article', { class: 'mod-card', dataset: { reportId: report.id } }, [
      el('h2', { text: REASON_LABELS[report.reason] || report.reason }, badges),
      el('p', { class: 'mod-meta', text: `Reported rider: ${riderLabel(report.reportedRiderId)}` }),
      el('p', { class: 'mod-meta', text: `Reported by: ${riderLabel(report.reporterId)} · ${formatTime(report.createdAt)}` }),
      report.status !== 'open'
        ? el('p', { class: 'mod-meta', text: `Resolved ${formatTime(report.resolvedAt)} by ${riderLabel(report.resolvedBy)}` })
        : null,
      el('p', { class: 'mod-details', text: report.details || '(No details given.)' }),
    ]);
    if (report.status === 'open' || report.reportedRiderSuspended) {
      const note = noteField(`Note for report ${report.id}`);
      const actions = el('div', { class: 'mod-actions' });
      if (report.status === 'open') {
        const dismiss = el('button', { type: 'button', dataset: { action: 'dismiss' }, text: 'Dismiss' });
        const suspend = el('button', { type: 'button', dataset: { action: 'suspend' }, text: 'Suspend rider' });
        actions.append(dismiss, suspend);
        wireAction(card, dismiss, note, (text) => api('POST', `/moderation/reports/${encodeURIComponent(report.id)}/resolve`, { resolution: 'dismiss', note: text }));
        wireAction(card, suspend, note, (text) => api('POST', `/moderation/reports/${encodeURIComponent(report.id)}/resolve`, { resolution: 'suspend', note: text }));
      }
      if (report.reportedRiderSuspended) {
        const unsuspend = el('button', { type: 'button', dataset: { action: 'unsuspend' }, text: 'Unsuspend rider' });
        actions.append(unsuspend);
        wireAction(card, unsuspend, note, (text) => api('POST', `/moderation/riders/${encodeURIComponent(report.reportedRiderId)}/unsuspend`, { note: text }));
      }
      card.append(note, actions);
    }
    card.append(el('p', { class: 'mod-error', role: 'alert' }));
    return card;
  }

  function actionCard(action) {
    return el('article', { class: 'mod-card' }, [
      el('h2', { text: ACTION_LABELS[action.action] || action.action }),
      el('p', { class: 'mod-meta', text: `Rider: ${riderLabel(action.targetRiderId)}` }),
      el('p', { class: 'mod-meta', text: `By ${riderLabel(action.moderatorId)} · ${formatTime(action.createdAt)}` }),
      el('p', { class: 'mod-details', text: action.note }),
    ]);
  }

  function moderationTabs() {
    const tabs = el('div', { class: 'dash-subtabs', role: 'group', 'aria-label': 'Moderation queues' });
    for (const [id, label] of [['open', 'Open reports'], ['dismissed', 'Dismissed'], ['actioned', 'Actioned'], ['actions', 'Audit log']]) {
      const button = el('button', { type: 'button', 'aria-pressed': String(id === moderationView), text: label });
      button.addEventListener('click', () => {
        moderationView = id;
        void render();
      });
      tabs.append(button);
    }
    return tabs;
  }

  async function renderModeration() {
    if (moderationView === 'actions') {
      const { actions } = await api('GET', '/moderation/actions?limit=100');
      await loadNames(actions.flatMap((action) => [action.targetRiderId, action.moderatorId]));
      listEl.replaceChildren(moderationTabs(), ...(actions.length
        ? actions.map(actionCard)
        : [el('p', { class: 'mod-empty', text: 'No moderation decisions yet.' })]));
      return;
    }
    const { reports } = await api('GET', `/moderation/reports?status=${moderationView}&limit=100`);
    await loadNames(reports.flatMap((report) => [report.reporterId, report.reportedRiderId, report.resolvedBy]));
    listEl.replaceChildren(moderationTabs(), ...(reports.length
      ? reports.map(reportCard)
      : [el('p', { class: 'mod-empty', text: moderationView === 'open' ? 'No open reports.' : 'Nothing here.' })]));
  }

  // ------------------------------------------------------------------ System

  async function probe(path) {
    const started = performance.now();
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, { cache: 'no-store' });
      return { ok: response.ok, ms: Math.round(performance.now() - started), status: response.status };
    } catch {
      return { ok: false, ms: null, status: null };
    }
  }

  async function renderSystem() {
    const [health, ready] = await Promise.all([probe('/health'), probe('/ready')]);
    const row = (label, result, description) => el('div', { class: 'dash-health-row' }, [
      el('strong', { text: label }),
      el('span', { class: 'dash-status', dataset: { state: result.ok ? 'ok' : 'down' }, text: result.ok ? '✓ OK' : '✕ Down' }),
      el('span', { class: 'mod-meta', text: result.ms === null ? description : `${description} · ${result.ms} ms` }),
    ]);
    listEl.replaceChildren(
      el('p', { class: 'dash-updated', text: `Checked ${new Date().toLocaleTimeString()} from this browser.` }),
      el('div', { class: 'dash-health' }, [
        row('API', health, 'Backend process is running'),
        row('Database', ready, 'Postgres reachable and migrations applied'),
      ]),
      el('h2', { class: 'dash-section-title', text: 'Runbooks' }),
      el('ul', { class: 'dash-links' }, [
        ['MODERATION.md', 'Moderation'],
        ['BACKUP_RESTORE.md', 'Backups and restore'],
        ['RETENTION.md', 'Data retention'],
        ['SELF_HOSTED_VOICE.md', 'Self-hosted voice'],
        ['AUDIT.md', 'Engineering audit'],
      ].map(([file, label]) => el('li', {}, [
        el('a', { href: `https://github.com/alidd11/rider-comms/blob/main/${file}`, rel: 'noopener noreferrer', target: '_blank', text: label }),
      ]))),
      el('p', { class: 'mod-meta', text: 'Errors and crashes are emailed to admins automatically (at most one email per 15 minutes).' }),
    );
  }

  // ------------------------------------------------------------------ Shell

  async function render() {
    for (const button of tabsEl.querySelectorAll('button[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === view));
    listEl.replaceChildren(el('p', { class: 'mod-empty', text: 'Loading…' }));
    try {
      if (view === 'overview') {
        renderOverview(await api('GET', '/admin/overview'));
      } else if (view === 'riders') {
        const { riders } = await api('GET', `/admin/riders?limit=50&q=${encodeURIComponent(riderQuery)}`);
        renderRiders(riders);
      } else if (view === 'moderation') {
        await renderModeration();
      } else {
        await renderSystem();
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        tabsEl.hidden = true;
        listEl.replaceChildren();
        setStatus('This account is not staff. Ask an admin to add it to ADMIN_RIDER_IDS.', 'error');
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        tabsEl.hidden = true;
        listEl.replaceChildren();
        setStatus('Your session has expired. Sign in to the Rider Comms app in this browser, then reload this page.', 'error');
        return;
      }
      listEl.replaceChildren(el('p', { class: 'mod-error', text: 'Could not load this section. Check your connection and press Refresh.' }));
    }
  }

  function selectView(next) {
    if (!VIEWS.includes(next)) return;
    view = next;
    if (location.hash !== `#${next}`) history.replaceState(null, '', `#${next}`);
    void render();
  }

  for (const button of tabsEl.querySelectorAll('button[data-view]')) {
    button.addEventListener('click', () => selectView(button.dataset.view));
  }
  window.addEventListener('hashchange', () => selectView(location.hash.slice(1)));
  document.getElementById('modRefresh').addEventListener('click', () => void render());
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (view === 'overview') for (const chart of listEl.querySelectorAll('.dash-chart')) chart.redraw?.();
    }, 150);
  });

  if (!session) {
    setStatus('Sign in to the Rider Comms app in this browser first (on this same site), then reload this page.', 'error');
    return;
  }
  setStatus(`Signed in as ${session.riderId}. Staff only: every moderation decision needs a note and is recorded in the audit log.`);
  tabsEl.hidden = false;
  void render();
})();
