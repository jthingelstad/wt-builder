/**
 * The browser's side of the service: what a failed call says. The error bar
 * shows this message, so it has to say something true even when the answer
 * is not the service's JSON (review 2026-09-27, §1.4).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '../src/client/api.ts';

afterEach(() => vi.unstubAllGlobals());

const answer = (body: string, status: number, statusText: string) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, statusText })));

describe('a failed call names what went wrong', () => {
  // A proxy or a restarting service answers with HTML or nothing parseable.
  // JSON.parse threw a SyntaxError, and the bar said "Unexpected token '<'".
  it('falls back to the status when the error body is not JSON', async () => {
    answer('<html><body>Bad Gateway</body></html>', 502, 'Bad Gateway');
    const err = await api.getIssue('wt352').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('502 Bad Gateway');
    expect((err as ApiError).status).toBe(502);
  });

  it("still uses the service's own message and code when there is one", async () => {
    answer(JSON.stringify({ error: 'Put to bed', code: 'asleep' }), 423, 'Locked');
    const err = await api.getIssue('wt352').catch((e: unknown) => e) as ApiError;
    expect(err.message).toBe('Put to bed');
    expect(err.code).toBe('asleep');
  });

  // JSON that is not an object — null, a number, a string — has no .error to read.
  it('an error body of JSON null or a bare value falls back to the status', async () => {
    for (const body of ['null', '42', '"oops"']) {
      answer(body, 500, 'Internal Server Error');
      const err = await api.getIssue('wt352').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toBe('500 Internal Server Error');
    }
  });

  it('a 200 whose body is not JSON is a failure, not a crash', async () => {
    answer('<html>', 200, 'OK');
    const err = await api.getIssue('wt352').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
  });
});
