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

  function acknowledge(current, localId, sent) {
    return dedupe([...current.filter((message) => String(message.id) !== String(localId)), sent]);
  }

  // The server stores a sent message under its own id, so a poll that lands
  // before the send resolves (or after a response lost on a weak signal)
  // returns the delivered copy while the local copy is still pending or
  // marked failed. Treat a server message with the same sender and text,
  // created shortly after the local one, as that local message delivered:
  // otherwise it shows twice, and retrying a "failed" one sends it twice.
  const DELIVERED_MATCH_WINDOW_MS = 2 * 60 * 1000;
  const timeOf = (message) => new Date(message.createdAt).getTime();

  function reconcile(current, fetched) {
    const serverIds = new Set(fetched.map((message) => String(message.id)));
    const claimed = new Set();
    const localOnly = current.filter((message) => {
      if (serverIds.has(String(message.id))) return false;
      if (message.status !== 'pending' && message.status !== 'failed') return false;
      if (typeof message.text !== 'string' || !message.text || !message.fromRiderId) return true;
      const sentAt = timeOf(message);
      const delivered = fetched.find((server) => !claimed.has(String(server.id))
        && server.fromRiderId === message.fromRiderId
        && server.text === message.text
        && timeOf(server) >= sentAt - 5000
        && timeOf(server) <= sentAt + DELIVERED_MATCH_WINDOW_MS);
      if (delivered) {
        claimed.add(String(delivered.id));
        return false;
      }
      return true;
    });
    return dedupe([...fetched, ...localOnly]);
  }

  globalThis.RiderMessageState = Object.freeze({ acknowledge, dedupe, reconcile });
})();
