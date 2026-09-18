(() => {
  'use strict';

  const order = (left, right) => {
    const byTime = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return byTime || String(left.id).localeCompare(String(right.id));
  };

  const dedupe = (messages) => {
    const byId = new Map();
    messages.forEach((message) => byId.set(String(message.id), message));
    return [...byId.values()].sort(order);
  };

  function reconcile(current, fetched) {
    const serverIds = new Set(fetched.map((message) => String(message.id)));
    const localOnly = current.filter((message) =>
      !serverIds.has(String(message.id)) && (message.status === 'pending' || message.status === 'failed'));
    return dedupe([...fetched, ...localOnly]);
  }

  globalThis.RiderMessageState = Object.freeze({ dedupe, reconcile });
})();
