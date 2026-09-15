import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuthStore } from '../src/authStore.ts';
describe('AuthStore', () => { it('issues unique readable IDs and authenticates the matching token', () => { const store = new AuthStore(); const a = store.createGuest(); const b = store.createGuest(); assert.match(a.riderId, /^rider_[a-z2-9]{8}$/); assert.notEqual(a.riderId, b.riderId); assert.equal(store.riderForToken(a.token), a.riderId); assert.equal(store.riderForToken(`${a.token}x`), undefined); }); });
