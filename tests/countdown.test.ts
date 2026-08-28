/** The standing Saturday deadline, as the dashboard states it. */

import { describe, expect, it } from 'vitest';
import { countdown } from '../src/shared/dates.ts';

/** A fixed "now", so these do not drift with the wall clock. */
const at = (iso: string) => new Date(iso);

describe('counting down to publication', () => {
  it('reads quietly when the issue is a week out', () => {
    expect(countdown('2026-09-05', at('2026-08-29T12:00:00Z')))
      .toEqual({ label: 'IN 7 DAYS', tone: 'grey' });
  });

  it('turns amber inside three days', () => {
    expect(countdown('2026-09-05', at('2026-09-02T12:00:00Z')))
      .toEqual({ label: 'IN 3 DAYS', tone: 'amber' });
    expect(countdown('2026-09-05', at('2026-09-01T12:00:00Z')).tone).toBe('grey');
  });

  it('names tomorrow and today rather than making you subtract', () => {
    expect(countdown('2026-09-05', at('2026-09-04T12:00:00Z')))
      .toEqual({ label: 'TOMORROW', tone: 'amber' });
    expect(countdown('2026-09-05', at('2026-09-05T09:00:00Z')))
      .toEqual({ label: 'TODAY', tone: 'terracotta' });
  });

  it('says how late a missed issue is', () => {
    expect(countdown('2026-09-05', at('2026-09-06T12:00:00Z')))
      .toEqual({ label: '1 DAY LATE', tone: 'terracotta' });
    expect(countdown('2026-09-05', at('2026-09-09T12:00:00Z')))
      .toEqual({ label: '4 DAYS LATE', tone: 'terracotta' });
  });

  it('counts days on Jamie’s clock, not UTC’s', () => {
    // 2026-09-05T02:00Z is still Friday the 4th, 9 PM in Central.
    expect(countdown('2026-09-05', at('2026-09-05T02:00:00Z')).label).toBe('TOMORROW');
    // ...and an hour after Central midnight it is the day itself.
    expect(countdown('2026-09-05', at('2026-09-05T06:00:00Z')).label).toBe('TODAY');
  });
});
