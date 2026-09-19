import { readFile } from 'node:fs/promises';

const raw = await readFile(new URL('../client-parity.json', import.meta.url), 'utf8');
const manifest = JSON.parse(raw);

if (!manifest?.policy?.rule || !Array.isArray(manifest.capabilities)) {
  throw new Error('client-parity.json is missing its policy or capabilities list');
}

const ids = new Set();
for (const capability of manifest.capabilities) {
  if (!capability || typeof capability.id !== 'string' || capability.id.length === 0) {
    throw new Error('Every parity capability needs a non-empty id');
  }
  if (ids.has(capability.id)) throw new Error(`Duplicate parity capability: ${capability.id}`);
  ids.add(capability.id);

  if (typeof capability.pwa !== 'boolean' || typeof capability.native !== 'boolean') {
    throw new Error(`${capability.id}: pwa/native must be booleans`);
  }
  if (!['parity', 'gap', 'behavior-gap', 'content-gap'].includes(capability.status)) {
    throw new Error(`${capability.id}: unsupported status ${capability.status}`);
  }
  if (capability.status === 'parity' && (!capability.pwa || !capability.native)) {
    throw new Error(`${capability.id}: parity requires both clients`);
  }
  if (capability.status === 'gap' && capability.pwa === capability.native) {
    throw new Error(`${capability.id}: gap must identify exactly one missing client`);
  }
  if ((capability.status === 'behavior-gap' || capability.status === 'content-gap') && (!capability.pwa || !capability.native)) {
    throw new Error(`${capability.id}: behavior/content gaps require both clients to exist`);
  }
}

for (const required of ['auth', 'group-ride', 'ride-safe', 'place-search', 'friends', 'direct-messages', 'social-realtime', 'message-read-state']) {
  if (!ids.has(required)) throw new Error(`Missing required parity capability: ${required}`);
}

console.log(`Client parity manifest valid: ${manifest.capabilities.length} capabilities tracked`);
