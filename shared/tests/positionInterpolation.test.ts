import { describe, it } from 'node:test';
import { expect } from './testUtils.ts';
import { lerpCoordinate, PositionAnimator } from '../src/positionInterpolation.ts';

describe('lerpCoordinate', () => {
  const from = { lat: 51.5, lon: -0.1 };
  const to = { lat: 51.6, lon: -0.2 };

  it('returns the start point at t=0', () => {
    expect(lerpCoordinate(from, to, 0)).toEqual(from);
  });

  it('returns the end point at t=1', () => {
    expect(lerpCoordinate(from, to, 1)).toEqual(to);
  });

  it('returns the midpoint at t=0.5', () => {
    expect(lerpCoordinate(from, to, 0.5)).toEqual({ lat: 51.55, lon: -0.15000000000000002 });
  });

  it('clamps t below 0', () => {
    expect(lerpCoordinate(from, to, -5)).toEqual(from);
  });

  it('clamps t above 1', () => {
    expect(lerpCoordinate(from, to, 5)).toEqual(to);
  });
});

describe('PositionAnimator', () => {
  const start = { lat: 51.5, lon: -0.1 };
  const target = { lat: 51.51, lon: -0.11 };

  it('holds at the initial position with no glide in progress', () => {
    const animator = new PositionAnimator(start);
    expect(animator.positionAt(0)).toEqual(start);
    expect(animator.positionAt(99_999)).toEqual(start);
  });

  it('glides linearly from the point it was at when moveTo was called', () => {
    const animator = new PositionAnimator(start);
    animator.moveTo(target, 1000, 0);
    expect(animator.positionAt(0)).toEqual(start);
    expect(animator.positionAt(500)).toEqual(lerpCoordinate(start, target, 0.5));
    expect(animator.positionAt(1000)).toEqual(target);
  });

  it('does not overshoot past the target once the duration has elapsed', () => {
    const animator = new PositionAnimator(start);
    animator.moveTo(target, 1000, 0);
    expect(animator.positionAt(5000)).toEqual(target);
  });

  it('retargeting mid-glide starts the next glide from the current interpolated point, not from the old target', () => {
    const animator = new PositionAnimator(start);
    animator.moveTo(target, 1000, 0);
    const midway = animator.positionAt(500);
    const secondTarget = { lat: 51.52, lon: -0.12 };
    animator.moveTo(secondTarget, 1000, 500);
    expect(animator.positionAt(500)).toEqual(midway);
    expect(animator.positionAt(1500)).toEqual(secondTarget);
  });

  it('reset jumps immediately with no glide', () => {
    const animator = new PositionAnimator(start);
    animator.moveTo(target, 1000, 0);
    const other = { lat: 52, lon: -1 };
    animator.reset(other);
    expect(animator.positionAt(500)).toEqual(other);
  });

  it('isSettled reflects whether the glide duration has elapsed', () => {
    const animator = new PositionAnimator(start);
    animator.moveTo(target, 1000, 0);
    expect(animator.isSettled(500)).toBe(false);
    expect(animator.isSettled(1000)).toBe(true);
    expect(animator.isSettled(2000)).toBe(true);
  });

  it('a zero-duration move settles immediately', () => {
    const animator = new PositionAnimator(start);
    animator.moveTo(target, 0, 0);
    expect(animator.isSettled(0)).toBe(true);
    expect(animator.positionAt(0)).toEqual(target);
  });
});
