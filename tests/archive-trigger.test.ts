import { describe, expect, it, vi } from 'vitest';
import { archiveTrigger, deliverArchiveTrigger } from '../src/server/archive-trigger.ts';

const repo = 'jthingelstad/librarian-thing';
const proof = `https://github.com/${repo}/actions/runs/123456`;
describe('the archive cutover stays on its proven nudge by default', () => {
  it('needs the explicit bus mode, a bus and an operator-verified run receipt', () => {
    expect(archiveTrigger(undefined, undefined, 'thingelstad-publishing', repo)).toBe('nudge');
    expect(archiveTrigger('bus', undefined, 'thingelstad-publishing', repo)).toBe('nudge');
    expect(archiveTrigger('bus', proof, '', repo)).toBe('nudge');
    for (const bad of [proof+'?token=canary', proof+'#x', proof.replace('github.com','github.example'), proof.replace(repo,'other/repo'), 'not a URL']) {
      expect(archiveTrigger('bus', bad, 'thingelstad-publishing', repo)).toBe('nudge');
    }
    expect(archiveTrigger('bus', proof, 'thingelstad-publishing', repo)).toBe('bus');
  });
  it('dispatches in legacy mode and never sends the command twice', async () => {
    const dispatch = vi.fn(async () => {}), publish = vi.fn(async () => 'event-id');
    expect(await deliverArchiveTrigger('nudge',355,{dispatch,publish})).toBe('issue-sent 355');
    expect(dispatch).toHaveBeenCalledTimes(1); expect(publish).not.toHaveBeenCalled();
    expect(await deliverArchiveTrigger('bus',355,{dispatch,publish})).toBe('publishing-bus event-id');
    expect(dispatch).toHaveBeenCalledTimes(1); expect(publish).toHaveBeenCalledTimes(1);
  });
  it('a refused bus command cannot become a successful archive leg', async () => {
    const dispatch = vi.fn(async () => {}), publish = vi.fn(async () => null);
    await expect(deliverArchiveTrigger('bus',355,{dispatch,publish})).rejects.toThrow('did not acknowledge');
    expect(dispatch).not.toHaveBeenCalled(); expect(publish).toHaveBeenCalledTimes(1);
  });
});
