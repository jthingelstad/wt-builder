/**
 * The publishing bus: the event each leg announces, built from the issue's
 * record; and the announcement never gating a send. Offline (every test),
 * the AWS SDK has no credentials (config.ts), so the real put fails before
 * it leaves the machine, and `announce` turns that into a recorded failure
 * and a null, as it would a bus outage on the Mac.
 */

import { describe, expect, it } from 'vitest';

import type { EpisodeDoc } from '../src/shared/podcast/types.ts';
import type { IssueDoc } from '../src/shared/types.ts';

const { OFFLINE, publishingBusFrom } = await import('../src/server/config.ts');
const { ANNOUNCE_TIMEOUT_MS, announce, episodePublished, issuePublished, putPublished } = await import('../src/server/integrations/publishing.ts');

const issue = (sends: IssueDoc['sends']): IssueDoc => ({
  issue: { number: 355, title: 'WT355 — The bus', publication_date: '2026-10-31' },
  sends,
} as unknown as IssueDoc);

describe('the published event for an issue leg', () => {
  it('names the leg that went, the page, and every leg sent so far', () => {
    const doc = issue({
      website: { status: 'sent', at: '2026-10-31T12:00:12.000Z', external_id: 'abc', url: 'https://github.com/jthingelstad/weekly.thingelstad.com/commit/abc' },
      buttondown: { status: 'sending', at: '2026-10-31T12:01:00.000Z', last_sent: { status: 'sent', at: '2026-10-31T11:58:00.000Z', external_id: 'em-1', url: 'https://buttondown.com/weeklything/archive/wt355/' } },
      archive: { status: 'failed', at: '2026-10-31T12:03:00.000Z', error: 'nope' },
    });
    const state = { status: 'sent' as const, at: '2026-10-31T12:08:05.000Z', url: 'https://weekly.thingelstad.com/uploads/2026/weekly-thing-355.mp3', audio: { audio_url: 'https://weekly.thingelstad.com/uploads/2026/weekly-thing-355.mp3' } };
    const e = issuePublished(doc, 'podcast', state);
    expect(e).toEqual({
      product: 'weekly-thing',
      kind: 'issue',
      id: '355',
      title: 'WT355 — The bus',
      url: 'https://weekly.thingelstad.com/archive/355/',
      leg: 'podcast',
      leg_url: 'https://weekly.thingelstad.com/uploads/2026/weekly-thing-355.mp3',
      at: '2026-10-31T12:08:05.000Z',
      legs: {
        website: { at: '2026-10-31T12:00:12.000Z', url: 'https://weekly.thingelstad.com/archive/355/' },
        buttondown: { at: '2026-10-31T11:58:00.000Z', url: 'https://buttondown.com/weeklything/archive/wt355/' },
        podcast: { at: '2026-10-31T12:08:05.000Z', url: 'https://weekly.thingelstad.com/uploads/2026/weekly-thing-355.mp3' },
      },
    });
    // A failed leg with no last good send is not a leg sent; the archive leg has no URL of its own.
    const a = issuePublished(doc, 'archive', { status: 'sent', at: '2026-10-31T12:09:40.000Z', external_id: 'issue-sent 355', url: 'https://github.com/x/actions' });
    expect(a.leg_url).toBeUndefined();
    expect(a.legs.archive).toEqual({ at: '2026-10-31T12:09:40.000Z' });
    expect(Object.keys(a.legs).sort()).toEqual(['archive', 'buttondown', 'website']);
  });

  it('the website leg carries the page, not the commit', () => {
    const e = issuePublished(issue({}), 'website', { status: 'sent', at: '2026-10-31T12:00:12.000Z', external_id: 'abc', url: 'https://github.com/jthingelstad/weekly.thingelstad.com/commit/abc' });
    expect(e.leg_url).toBe('https://weekly.thingelstad.com/archive/355/');
    expect(e.legs).toEqual({ website: { at: '2026-10-31T12:00:12.000Z', url: 'https://weekly.thingelstad.com/archive/355/' } });
  });

  it('an episode is one leg, its page', () => {
    const doc = { episode: { number: 8, title: 'Eight', slug: 'eight', date: '2026-11-02' } } as unknown as EpisodeDoc;
    const e = episodePublished(doc, { status: 'sent', at: '2026-11-02T15:00:00.000Z', external_id: 'sha' }, 'https://another.thingelstad.com/2026/11/02/eight.html');
    expect(e).toEqual({
      product: 'another-thing', kind: 'episode', id: '8', title: 'Eight',
      url: 'https://another.thingelstad.com/2026/11/02/eight.html', leg: 'another', leg_url: 'https://another.thingelstad.com/2026/11/02/eight.html',
      at: '2026-11-02T15:00:00.000Z', legs: { another: { at: '2026-11-02T15:00:00.000Z', url: 'https://another.thingelstad.com/2026/11/02/eight.html' } },
    });
  });
});

describe('the bus, offline', () => {
  it('is offline here', () => {
    expect(OFFLINE).toBe(true);
  });

  it('refuses a put for want of credentials, before anything leaves the machine', async () => {
    const e = issuePublished(issue({}), 'website', { status: 'sent', at: '2026-10-31T12:00:12.000Z' });
    await expect(putPublished(e)).rejects.toMatchObject({ name: 'CredentialsProviderError' });
  });

  it('announce never throws: the failure is handed back, and the send goes on', async () => {
    const e = issuePublished(issue({}), 'website', { status: 'sent', at: '2026-10-31T12:00:12.000Z' });
    const failures: string[] = [];
    const started = Date.now();
    await expect(announce(e, (m) => failures.push(m))).resolves.toBeNull();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/credential/i);
    expect(Date.now() - started).toBeLessThan(ANNOUNCE_TIMEOUT_MS);
  });
});

describe('the bus setting', () => {
  it('is the default bus when the variable is unset', () => {
    expect(publishingBusFrom(undefined)).toBe('thingelstad-publishing');
  });
  it('is off when the variable is set but empty', () => {
    expect(publishingBusFrom('')).toBe('');
    expect(publishingBusFrom('   ')).toBe('');
  });
  it('is the named bus otherwise', () => {
    expect(publishingBusFrom(' my-bus ')).toBe('my-bus');
  });
});
