/**
 * Compact relative time for list metadata ("just now", "5 min ago", "3h ago",
 * "12d ago"), falling back to an absolute date past 30 days where a day count
 * stops being readable. Copy comes from the four existing `common.time*` keys.
 *
 * `now` is a parameter so callers' tests do not race the wall clock.
 */
import {t} from '@/lib/copy';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ABSOLUTE_AFTER = 30 * DAY;

export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  // Clock skew between the database and the browser can put a fresh
  // `updated_at` slightly in the future; clamp rather than render "-1 min ago".
  const delta = Math.max(0, now - then);

  if (delta < MINUTE) return t('common', 'timeJustNow');
  if (delta < HOUR) return t('common', 'timeAgoMin').replace('{{n}}', String(Math.floor(delta / MINUTE)));
  if (delta < DAY) return t('common', 'timeAgoH').replace('{{n}}', String(Math.floor(delta / HOUR)));
  if (delta < ABSOLUTE_AFTER) return t('common', 'timeAgoD').replace('{{n}}', String(Math.floor(delta / DAY)));
  return new Date(then).toLocaleDateString('en-US');
}
