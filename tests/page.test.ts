/**
 * The link wand's page read: public addresses only, redirects checked hop
 * by hop, and a byte cap. DNS and fetch are stubbed; nothing leaves the
 * machine.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup, default: { lookup } }));

const { fetchPublic, isPrivateAddress, readCapped } = await import('../src/server/integrations/page.ts');

beforeEach(() => {
  lookup.mockReset();
  lookup.mockImplementation(async (host: string) => [{ address: host === 'inside.example' ? '10.0.0.7' : '93.184.216.34', family: 4 }]);
});

afterEach(() => vi.unstubAllGlobals());

describe('which addresses are refused', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '100.101.102.103', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fd7a:115c:a1e0::1', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', 'not-an-ip',
  ])('refuses %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  // The hex spellings WHATWG URL writes an IPv4-mapped address in, and the
  // rest of ::/8 and every non-global-unicast v6 range (review 2026-09-27,
  // Batch 8 round 1, B1).
  it.each([
    '::ffff:7f00:1', '[::ffff:7f00:1]', '::FFFF:7F00:1', '::ffff:a00:1', '::ffff:c0a8:101', '::ffff:a9fe:a9fe',
    '::ffff:6440:1', '::ffff:6465:6667', '::ffff:100.100.1.1', '0:0:0:0:0:ffff:7f00:1', '::ffff:0:7f00:1',
    '::7f00:1', '::127.0.0.1', '::a00:1', '::6440:1', '::808:808', '1::1', 'ff::1',
    '64:ff9b::7f00:1', '64:ff9b::808:808', '2002:7f00:1::1', '2001:db8::1', '2001:0:4136:e378::1',
    '3fff::1', '4000::1', 'fe80::1%en0',
  ])('refuses %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['93.184.216.34', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8',
    '::ffff:808:808', '2a00:1450:4001::200e'])(
    'allows %s', (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('following redirects by hand', () => {
  it('follows a public redirect and checks each hop', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'https://www.example.com/post' } }))
      .mockResolvedValueOnce(new Response('<p>hi</p>', { status: 200, headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fetch);
    const res = await fetchPublic('https://example.com/p');
    expect(await res.text()).toBe('<p>hi</p>');
    expect(fetch.mock.calls.map((c) => String(c[0]))).toEqual(['https://example.com/p', 'https://www.example.com/post']);
    expect(fetch.mock.calls.every((c) => c[1].redirect === 'manual')).toBe(true);
    expect(lookup.mock.calls.map((c) => c[0])).toEqual(['example.com', 'www.example.com']);
  });

  it('refuses a redirect to loopback before fetching it', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:4317/api/issues' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchPublic('https://example.com/p')).rejects.toThrow('127.0.0.1 is not a public address');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a name that resolves inside, and a scheme that is not the web', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(fetchPublic('https://inside.example/')).rejects.toThrow('inside.example is not a public address');
    await expect(fetchPublic('http://[::1]/')).rejects.toThrow('::1 is not a public address');
    await expect(fetchPublic('file:///etc/passwd')).rejects.toThrow('file: is not a web page');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses loopback and the tailnet spelled as IPv4-mapped IPv6, as new URL writes them', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(new URL('http://[::ffff:127.0.0.1]/').hostname).toBe('[::ffff:7f00:1]');
    await expect(fetchPublic('http://[::ffff:127.0.0.1]:4317/')).rejects.toThrow('::ffff:7f00:1 is not a public address');
    await expect(fetchPublic('http://[::ffff:100.101.102.103]/')).rejects.toThrow('is not a public address');
    await expect(fetchPublic('http://[::127.0.0.1]/')).rejects.toThrow('is not a public address');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a redirect to the IPv4-mapped loopback before fetching it', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://[::ffff:127.0.0.1]:4317/api/issues' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchPublic('https://example.com/p')).rejects.toThrow('::ffff:7f00:1 is not a public address');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a name that resolves to a mapped private address', async () => {
    lookup.mockResolvedValueOnce([{ address: '::ffff:a00:7', family: 6 }]);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(fetchPublic('https://sneaky.example/')).rejects.toThrow('sneaky.example is not a public address');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('gives up after five redirects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: '/again' } })));
    await expect(fetchPublic('https://example.com/')).rejects.toThrow('more than 5 redirects');
  });
});

describe('reading at most so much', () => {
  it('stops at the cap, however much the server sends', async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new TextEncoder().encode('x'.repeat(1000)));
      },
    });
    const text = await readCapped(new Response(endless), 2500);
    expect(text).toHaveLength(2500);
    expect(pulled).toBeLessThan(10);
  });
});
