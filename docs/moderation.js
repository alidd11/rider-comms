// Staff moderation page. Uses the Rider Comms PWA's own sign-in on this
// origin (the same session storage key), so a moderator signs in to the
// app in this browser first. The backend re-checks admin status on every
// /moderation request; this page only decides what to show.
//
// All report text comes from riders, so it is only ever inserted with
// textContent, never as HTML.
(() => {
  const API_BASE_URL = 'https://backend-production-7fa0.up.railway.app';
  const SESSION_KEY = 'rider-comms-session-v1';
  const MAX_NOTE_LENGTH = 1000;
  const REASON_LABELS = {
    harassment: 'Harassment',
    unsafe: 'Unsafe riding or behaviour',
    spam: 'Spam',
    sexual: 'Sexual content',
    other: 'Other',
  };
  const ACTION_LABELS = { dismiss: 'Dismissed report', suspend: 'Suspended rider', unsuspend: 'Unsuspended rider' };

  const statusEl = document.getElementById('modStatus');
  const tabsEl = document.getElementById('modTabs');
  const listEl = document.getElementById('modList');
  let view = 'open';
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

  function formatTime(ms) {
    return ms ? new Date(ms).toLocaleString() : '';
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
    const canAct = report.status === 'open' || report.reportedRiderSuspended;
    if (canAct) {
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

  async function render() {
    listEl.replaceChildren(el('p', { class: 'mod-empty', text: 'Loading…' }));
    try {
      if (view === 'actions') {
        const { actions } = await api('GET', '/moderation/actions?limit=100');
        await loadNames(actions.flatMap((action) => [action.targetRiderId, action.moderatorId]));
        listEl.replaceChildren(...(actions.length
          ? actions.map(actionCard)
          : [el('p', { class: 'mod-empty', text: 'No moderation decisions yet.' })]));
        return;
      }
      const { reports } = await api('GET', `/moderation/reports?status=${view}&limit=100`);
      await loadNames(reports.flatMap((report) => [report.reporterId, report.reportedRiderId, report.resolvedBy]));
      listEl.replaceChildren(...(reports.length
        ? reports.map(reportCard)
        : [el('p', { class: 'mod-empty', text: view === 'open' ? 'No open reports.' : 'Nothing here.' })]));
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        tabsEl.hidden = true;
        listEl.replaceChildren();
        setStatus('This account is not a moderator. Ask an admin to add it to ADMIN_RIDER_IDS.', 'error');
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        tabsEl.hidden = true;
        listEl.replaceChildren();
        setStatus('Your session has expired. Sign in to the Rider Comms app in this browser, then reload this page.', 'error');
        return;
      }
      listEl.replaceChildren(el('p', { class: 'mod-error', text: 'Could not load this queue. Check your connection and press Refresh.' }));
    }
  }

  for (const button of tabsEl.querySelectorAll('button[data-view]')) {
    button.addEventListener('click', () => {
      view = button.dataset.view;
      for (const other of tabsEl.querySelectorAll('button[data-view]')) other.setAttribute('aria-pressed', String(other === button));
      void render();
    });
  }
  document.getElementById('modRefresh').addEventListener('click', () => void render());

  if (!session) {
    setStatus('Sign in to the Rider Comms app in this browser first (on this same site), then reload this page.', 'error');
    return;
  }
  setStatus(`Signed in as ${session.riderId}. Every decision needs a note and is recorded in the audit log.`);
  tabsEl.hidden = false;
  void render();
})();
