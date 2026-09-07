/**
 * `now` is injected so the boundaries are asserted exactly rather than raced
 * against the wall clock.
 *
 * The >30-day branch is the one that cannot be a hardcoded string: the
 * implementation formats with `toLocaleDateString`, which renders in the
 * MACHINE's zone, so `'8/8/2026'` is right at UTC and wrong at UTC+12 — green
 * on CI and red for a developer in Auckland. It is asserted as "the absolute
 * date of that instant, and no longer a relative phrase" instead, which is the
 * property that actually matters and holds in every zone.
 */
import {describe, expect, it} from 'vitest';
import {relativeTime} from '@/lib/relative-time';

const NOW = Date.parse('2026-09-07T12:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('reads "just now" under a minute', () => {
    expect(relativeTime(iso(0), NOW)).toBe('just now');
    expect(relativeTime(iso(MINUTE - 1), NOW)).toBe('just now');
  });

  it('counts whole minutes up to an hour', () => {
    expect(relativeTime(iso(MINUTE), NOW)).toBe('1 min ago');
    expect(relativeTime(iso(59 * MINUTE), NOW)).toBe('59 min ago');
  });

  it('counts whole hours up to a day', () => {
    expect(relativeTime(iso(HOUR), NOW)).toBe('1h ago');
    expect(relativeTime(iso(23 * HOUR), NOW)).toBe('23h ago');
  });

  it('counts whole days up to thirty', () => {
    expect(relativeTime(iso(DAY), NOW)).toBe('1d ago');
    expect(relativeTime(iso(29 * DAY), NOW)).toBe('29d ago');
  });

  it('falls back to an absolute date past thirty days', () => {
    const result = relativeTime(iso(30 * DAY), NOW);

    // Zone-independent: whatever this machine calls that instant's date.
    expect(result).toBe(new Date(NOW - 30 * DAY).toLocaleDateString('en-US'));
    // …and not vacuous: the branch really switched away from a day count.
    expect(result).not.toMatch(/ago$/);
    expect(result).not.toBe(relativeTime(iso(29 * DAY), NOW));
  });

  it('clamps a future timestamp instead of rendering a negative count', () => {
    expect(relativeTime(new Date(NOW + HOUR).toISOString(), NOW)).toBe('just now');
  });

  it('returns an empty string for an unparseable value', () => {
    expect(relativeTime('not a date', NOW)).toBe('');
  });
});
