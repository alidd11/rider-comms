import assert from 'node:assert/strict';

await import('../docs/position-interpolation.js');

const pwa = globalThis.RiderPositionInterpolation;
assert.ok(pwa, 'PWA position-interpolation helper must expose RiderPositionInterpolation');

const start = { lat: 51.5, lon: -0.1 };
const target = { lat: 51.51, lon: -0.11 };

assert.deepEqual(pwa.lerpCoordinate(start, target, 0), start);
assert.deepEqual(pwa.lerpCoordinate(start, target, 1), target);
assert.deepEqual(pwa.lerpCoordinate(start, target, 5), target, 't must clamp above 1');
assert.deepEqual(pwa.lerpCoordinate(start, target, -5), start, 't must clamp below 0');

const animator = new pwa.PositionAnimator(start);
assert.deepEqual(animator.positionAt(0), start, 'holds at the initial position with no glide in progress');

animator.moveTo(target, 1000, 0);
assert.deepEqual(animator.positionAt(0), start);
assert.deepEqual(animator.positionAt(500), pwa.lerpCoordinate(start, target, 0.5));
assert.deepEqual(animator.positionAt(1000), target);
assert.deepEqual(animator.positionAt(5000), target, 'must not overshoot past the target once settled');
assert.equal(animator.isSettled(999), false);
assert.equal(animator.isSettled(1000), true);

// Retargeting mid-glide (before the previous one has settled) must continue
// from the current interpolated point, not snap back to the old target first.
const midGlide = new pwa.PositionAnimator(start);
midGlide.moveTo(target, 1000, 0);
const midway = midGlide.positionAt(500);
midGlide.moveTo({ lat: 51.52, lon: -0.12 }, 1000, 500);
assert.deepEqual(midGlide.positionAt(500), midway);
assert.deepEqual(midGlide.positionAt(1500), { lat: 51.52, lon: -0.12 });

animator.reset({ lat: 52, lon: -1 });
assert.deepEqual(animator.positionAt(1500), { lat: 52, lon: -1 }, 'reset must jump immediately with no glide');

console.log('Position-interpolation port valid');
