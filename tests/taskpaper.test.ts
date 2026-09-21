/** The issue's OmniFocus project: Jamie's template, with the builder's dates in it. */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IssueDoc } from '../src/shared/types.ts';
import { clockAt, omnifocusUrl, taskpaper } from '../src/shared/taskpaper.ts';

const doc = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/representative-issue.json', import.meta.url)), 'utf8'),
) as IssueDoc;

describe('clock times OmniFocus can parse', () => {
  it('midnight, and hours before or after it, on the calendar', () => {
    expect(clockAt('2026-09-26')).toBe('2026-09-26 12:00 AM');
    expect(clockAt('2026-09-26', -1)).toBe('2026-09-25 11:00 PM');
    expect(clockAt('2026-09-26', -90)).toBe('2026-09-22 6:00 AM');
    expect(clockAt('2026-09-26', 6)).toBe('2026-09-26 6:00 AM');
    expect(clockAt('2026-09-26', 18)).toBe('2026-09-26 6:00 PM');
  });
});

describe('the project', () => {
  // The fixture publishes Sat 2026-05-23 with a 7-day window: opens Fri 05-15, closes Fri 05-22.
  const out = taskpaper(doc, 'https://builder.test');

  it("keeps Jamie's offsets: Author due End−1h, Write defer End−90h, Publish Pub−30h/−1h, Share +6h/+18h, Prepare +6h/+22h", () => {
    expect(out).toContain('Send WT350: @parallel(false) @autodone(true) @defer(2026-05-15 12:00 AM)');
    expect(out).toContain('- Author WT350 @parallel(true) @autodone(true) @due(2026-05-21 11:00 PM) @time-zone(current)');
    expect(out).toContain('@planned(2026-05-20 10:00 PM)');
    expect(out).toContain('Reading List to Pinboard @tags(Computer) @defer(2026-05-21 3:00 PM) @due(2026-05-21 10:00 PM)');
    expect(out).toContain('- Write WT350 in the builder @tags(Writing) @defer(2026-05-18 6:00 AM)');
    expect(out).toContain('- Publish WT350 🛠️ @parallel(false) @autodone(true) @defer(2026-05-21 6:00 PM) @due(2026-05-22 11:00 PM)');
    expect(out).toContain('- Share WT350 🌎 @parallel(false) @autodone(true) @defer(2026-05-23 6:00 AM) @due(2026-05-23 6:00 PM)');
    expect(out).toContain('- Prepare for next Weekly Thing 📦 @parallel(false) @autodone(true) @defer(2026-05-23 6:00 AM) @due(2026-05-23 10:00 PM)');
    expect(out).toContain('Schedule for 2026-05-23 06:00 AM.');
  });

  it('points at the builder, the archive page, and the next issue', () => {
    expect(out).toContain('Builder: https://builder.test/wt350');
    expect(out).toContain('https://builder.test/wt350/send');
    expect(out).toContain('https://weekly.thingelstad.com/archive/350/');
    expect(out).toContain('Start WT351 in the builder');
  });

  it('carries nothing the builder does itself', () => {
    for (const gone of ['Import links', 'Preview links', 'Generate Subject', 'Generate Haiku', 'Generate Echoes', 'Set Issue', 'Create OmniFocus Project', 'draft.html', 'transcript-full']) {
      expect(out).not.toContain(gone);
    }
  });

  it('is indented with tabs, the way TaskPaper wants', () => {
    expect(out).not.toMatch(/^ {2,}/m);
    expect(omnifocusUrl(out).startsWith('omnifocus:///paste?target=projects&content=Send%20WT350')).toBe(true);
  });
});
