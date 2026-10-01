// Every date WT Builder derives from a send time is the Central day
// (Jamie's rule, 2026-09-30). The UTC slice put WT35, WT251 and WT299 a day
// late; these pin the helper the back catalogue, the importer and the Echoes
// context read through.
import { describe, expect, it } from 'vitest';

import { centralDay } from '../src/shared/dates.ts';

describe('centralDay', () => {
  it('reads an evening send as its Central day', () => {
    expect(centralDay('2018-01-07T01:28:21Z')).toBe('2018-01-06'); // WT35
    expect(centralDay('2023-04-24T01:14:21.760981Z')).toBe('2023-04-23'); // WT251
    expect(centralDay('2024-11-04T01:45:48.042998Z')).toBe('2024-11-03'); // WT299
  });

  it('keeps noon UTC, the send stamp, on its day', () => {
    expect(centralDay('2026-09-26T12:00:00Z')).toBe('2026-09-26');
  });

  it('reads a bare date as written, and refuses junk', () => {
    expect(centralDay('2024-05-01')).toBe('2024-05-01');
    expect(centralDay('')).toBeNull();
    expect(centralDay(undefined)).toBeNull();
    expect(centralDay('soon')).toBeNull();
  });
});
