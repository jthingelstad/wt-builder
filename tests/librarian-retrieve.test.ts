/**
 * The Librarian client's manners (WT352): the stream Lambda behind
 * /retrieve has a reserved concurrency of 5, shared with Thingy and the MCP,
 * and Echoes' ten parallel asks drew 429s that failed the draft. At most
 * MAX_IN_FLIGHT go at once, and a 429 is waited out before it fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { credentials } from '../src/server/config.ts';
import { ArchiveError, MAX_IN_FLIGHT, RETRIES_ON_429, retrieve, setBackoff } from '../src/server/integrations/librarian.ts';

const ok = () => new Response(JSON.stringify({ passages: [{ text: 'p' }] }), { status: 200 });
const busy = () => new Response('{"Reason":"ReservedFunctionConcurrentInvocationLimitExceeded"}', { status: 429, statusText: 'Too Many Requests' });

beforeEach(() => {
  credentials.librarianSecret = 'test-secret';
  setBackoff(async () => {});
});
afterEach(() => {
  credentials.librarianSecret = undefined;
  vi.unstubAllGlobals();
});

describe('Librarian retrieve', () => {
  it('keeps at most MAX_IN_FLIGHT asks in flight, however many are made at once', async () => {
    let now = 0;
    let peak = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      now++;
      peak = Math.max(peak, now);
      await new Promise((r) => setTimeout(r, 5));
      now--;
      return ok();
    }));
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => retrieve(`anchor ${i}`)));
    expect(results).toHaveLength(10);
    expect(peak).toBe(MAX_IN_FLIGHT);
  });

  it('waits out a 429 and asks again', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy()).mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetch);
    await expect(retrieve('boat')).resolves.toEqual([{ text: 'p' }]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('still fails loud once the retries are spent, in a sentence and never the raw answer', async () => {
    const fetch = vi.fn(async () => busy());
    vi.stubGlobal('fetch', fetch);
    const heard: number[] = [];
    const err = await retrieve('boat', 12, {}, (attempt) => heard.push(attempt)).catch((e: unknown) => e) as ArchiveError;
    expect(err).toBeInstanceOf(ArchiveError);
    expect(err.message).toBe('The archive was too busy to answer. Try again in a minute.');
    expect(err.message).not.toMatch(/[{}]|Reserved|429/);
    // The raw answer is kept for the log, not the person.
    expect(err.detail).toContain('ReservedFunctionConcurrentInvocationLimitExceeded');
    expect(fetch).toHaveBeenCalledTimes(RETRIES_ON_429 + 1);
    // Every wait is heard, so the editor can say "trying again".
    expect(heard).toEqual([0, 1, 2]);
  });

  it('does not retry any other failure, and says it plainly', async () => {
    const fetch = vi.fn(async () => new Response('{"message":"Internal"}', { status: 502, statusText: 'Bad Gateway' }));
    vi.stubGlobal('fetch', fetch);
    await expect(retrieve('boat')).rejects.toThrow('The archive had a problem answering (502). Try again in a minute.');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a timeout and a dropped connection are sentences too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }));
    await expect(retrieve('boat')).rejects.toThrow('The archive took too long to answer. Try again.');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(retrieve('boat')).rejects.toThrow("WT Builder couldn't reach the archive. Try again in a minute.");
  });

  it('a refused key says what needs a look, and offers no retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"forbidden"}', { status: 403, statusText: 'Forbidden' })));
    const err = await retrieve('boat').catch((e: unknown) => e) as ArchiveError;
    expect(err.message).toBe("The archive turned WT Builder's key away (403); LIBRARIAN_RETRIEVE_SECRET needs a look.");
    expect(err.again).toBeNull();
  });
});
