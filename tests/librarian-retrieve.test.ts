/**
 * The Librarian client's manners (WT352): the stream Lambda behind
 * /retrieve has a reserved concurrency of 5, shared with Thingy and the MCP,
 * and Echoes' ten parallel asks drew 429s that failed the draft. At most
 * MAX_IN_FLIGHT go at once, and a 429 is waited out before it fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { credentials } from '../src/server/config.ts';
import { MAX_IN_FLIGHT, RETRIES_ON_429, retrieve, setBackoff } from '../src/server/integrations/librarian.ts';

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

  it('still fails loud once the retries are spent', async () => {
    const fetch = vi.fn(async () => busy());
    vi.stubGlobal('fetch', fetch);
    await expect(retrieve('boat')).rejects.toThrow('Librarian retrieve failed: 429');
    expect(fetch).toHaveBeenCalledTimes(RETRIES_ON_429 + 1);
  });

  it('does not retry any other failure', async () => {
    const fetch = vi.fn(async () => new Response('nope', { status: 500, statusText: 'Internal Server Error' }));
    vi.stubGlobal('fetch', fetch);
    await expect(retrieve('boat')).rejects.toThrow('Librarian retrieve failed: 500');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
