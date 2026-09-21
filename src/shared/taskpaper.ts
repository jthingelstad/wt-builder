/**
 * The issue's OmniFocus project, as TaskPaper.
 *
 * Jamie ran every issue from an OmniFocus project pasted in from a Drafts
 * template by a shortcut. The builder knows the three dates the template
 * took — the window opens and closes, the issue publishes — so it writes
 * the project itself and hands it to OmniFocus through its paste URL
 * (2026-09-20). What is left in the project is what is genuinely outside
 * the builder: the Reading List filter, blog posts, the photo, writing,
 * Buttondown's test-and-schedule (kept manual by choice), confirming the
 * surfaces, sharing, and starting the next one. Everything the builder now
 * does — importing links, previewing, generating, sending — is gone from
 * the list, and every date offset that survived is Jamie's own.
 */

import type { IssueDoc } from './types.ts';
import { issueWindow } from './dates.ts';

/**
 * A wall-clock time OmniFocus parses: `2026-09-26 11:00 PM`. Hours are
 * added on the calendar, not across zones — the offsets are Jamie's
 * "90 hours before Friday midnight" and mean exactly that on his clock.
 */
export function clockAt(isoDate: string, hoursFromMidnight = 0): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d) + hoursFromMidnight * 3_600_000);
  const h24 = t.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  const date = t.toISOString().slice(0, 10);
  return `${date} ${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
}

export function taskpaper(doc: IssueDoc, origin = 'https://otto.tail09aaf9.ts.net:10001'): string {
  const n = doc.issue.number;
  const w = issueWindow(doc.issue.publication_date, doc.issue.window_days);
  const start = w.from;
  const end = w.to;
  const pub = doc.issue.publication_date;
  const tz = '@time-zone(current)';
  const issue = `${origin}/wt${n}`;

  return [
    `Send WT${n}: @parallel(false) @autodone(true) @defer(${clockAt(start)})`,
    `\tBuilder: ${issue}`,
    `\t▶️ Window opens ${start} · ⏸️ closes ${end} · ⏹️ publishes ${pub}`,
    '',
    `- Author WT${n} @parallel(true) @autodone(true) @due(${clockAt(end, -1)}) ${tz}`,
    `\t- Set Picture for WT${n} @tags(Today) @planned(${clockAt(end, -26)})`,
    `\t- Filter remaining Safari Reading List to Pinboard @tags(Computer) @defer(${clockAt(end, -9)}) @due(${clockAt(end, -2)}) ${tz}`,
    '\t\tOnly on macOS → shortcuts://run-shortcut?name=Reading%20List%20to%20Pinboard',
    `\t- Blog posts to create for WT${n}? @tags(Computer:Web) @defer(${clockAt(end, -9)}) ${tz}`,
    `\t- Write WT${n} in the builder @tags(Writing) @defer(${clockAt(end, -90)}) ${tz}`,
    `\t\t${issue}`,
    '\t\tCurrently, intro, outro, links, Membership, haiku, Echoes — the strip says what is left.',
    '',
    `- Publish WT${n} 🛠️ @parallel(false) @autodone(true) @defer(${clockAt(pub, -30)}) @due(${clockAt(pub, -1)}) ${tz}`,
    `\t- Send podcast, website, Buttondown, and the archive from the Send view @tags(Computer:Web)`,
    `\t\t${issue}/send`,
    '\t- Send test email, validate content @tags(Computer:Web)',
    `\t- Schedule WT${n} to send @tags(Computer:Web)`,
    `\t\tSchedule for ${pub} 06:00 AM.`,
    '\t\thttps://buttondown.email/emails',
    '\t- Confirm issue is on website @tags(Computer:Web)',
    `\t\thttps://weekly.thingelstad.com/archive/${n}/`,
    '\t- Confirm episode in Podcast feed @tags(Computer:Web)',
    '',
    `- Share WT${n} 🌎 @parallel(false) @autodone(true) @defer(${clockAt(pub, 6)}) @due(${clockAt(pub, 18)}) ${tz}`,
    '\tMicro.blog crossposts to Bluesky and Mastodon.',
    '\tEverything else is manually shared.',
    `\t- Share WT${n} to LinkedIn @tags(Computer:Web)`,
    '\t\tClipboard: shortcuts://run-shortcut?name=Share%20to%20LinkedIn',
    '\t\tPaste: https://www.linkedin.com/feed/',
    '\t\tConfirm: https://www.linkedin.com/in/jthingelstad/recent-activity/all/',
    `\t- Share WT${n} to r/WeeklyThing @tags(Computer:Web)`,
    '\t\tshortcuts://run-shortcut?name=Issue%20to%20r%2FWeeklyThing',
    '\t\thttps://www.reddit.com/r/weeklything/',
    `\t- Share WT${n} links to r/WeeklyThing @tags(Computer:Web)`,
    '\t\tshortcuts://run-shortcut?name=Links%20to%20r%2FWeeklyThing',
    '\t\thttps://www.reddit.com/r/weeklything/',
    '',
    `- Prepare for next Weekly Thing 📦 @parallel(false) @autodone(true) @defer(${clockAt(pub, 6)}) @due(${clockAt(pub, 22)}) ${tz}`,
    `\t- Start WT${n + 1} in the builder and create its OmniFocus project @tags(Computer:Web)`,
    `\t\t${origin}/`,
    '',
  ].join('\n');
}

/** OmniFocus takes TaskPaper straight into Projects through its paste URL. */
export function omnifocusUrl(text: string): string {
  return `omnifocus:///paste?target=projects&content=${encodeURIComponent(text)}`;
}
