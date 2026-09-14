// A tiny, dependency-free stand-in for the subset of vitest/jest's `expect`
// API these tests use, built on Node's built-in `node:assert`. This exists
// solely because this environment can't reach the npm registry to install
// vitest — swap this file (and the `expect` import in each test) for a real
// `vitest`/`jest` import once you have normal package-registry access; the
// test bodies themselves don't need to change.
import assert from 'node:assert/strict';

class Expectation<T> {
  private readonly actual: T;
  private readonly negate: boolean;

  constructor(actual: T, negate = false) {
    this.actual = actual;
    this.negate = negate;
  }

  private assertThat(pass: boolean, message: string): void {
    if (this.negate ? pass : !pass) {
      throw new assert.AssertionError({ message });
    }
  }

  get not(): Expectation<T> {
    return new Expectation(this.actual, !this.negate);
  }

  toBe(expected: T): void {
    this.assertThat(
      Object.is(this.actual, expected),
      `expected ${JSON.stringify(this.actual)} ${this.negate ? 'not ' : ''}to be ${JSON.stringify(expected)}`
    );
  }

  toEqual(expected: T): void {
    let deepEqual = true;
    try {
      assert.deepStrictEqual(this.actual, expected);
    } catch {
      deepEqual = false;
    }
    this.assertThat(
      deepEqual,
      `expected ${JSON.stringify(this.actual)} ${this.negate ? 'not ' : ''}to equal ${JSON.stringify(expected)}`
    );
  }

  toHaveLength(length: number): void {
    const actualLength = (this.actual as unknown as { length: number }).length;
    this.assertThat(
      actualLength === length,
      `expected length ${actualLength} ${this.negate ? 'not ' : ''}to be ${length}`
    );
  }

  toBeGreaterThan(expected: number): void {
    this.assertThat(
      (this.actual as unknown as number) > expected,
      `expected ${this.actual} ${this.negate ? 'not ' : ''}to be greater than ${expected}`
    );
  }

  toBeLessThan(expected: number): void {
    this.assertThat(
      (this.actual as unknown as number) < expected,
      `expected ${this.actual} ${this.negate ? 'not ' : ''}to be less than ${expected}`
    );
  }

  toBeCloseTo(expected: number, precision = 2): void {
    const tolerance = Math.pow(10, -precision) / 2;
    this.assertThat(
      Math.abs((this.actual as unknown as number) - expected) < tolerance,
      `expected ${this.actual} ${this.negate ? 'not ' : ''}to be close to ${expected}`
    );
  }

  toContain(expected: unknown): void {
    const actual = this.actual as unknown as string | unknown[];
    const contains = (actual as any).includes(expected);
    this.assertThat(
      contains,
      `expected ${JSON.stringify(this.actual)} ${this.negate ? 'not ' : ''}to contain ${JSON.stringify(expected)}`
    );
  }
}

export function expect<T>(actual: T): Expectation<T> {
  return new Expectation(actual);
}
