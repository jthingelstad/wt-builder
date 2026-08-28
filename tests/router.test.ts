/** URLs for the app's views. */

import { describe, expect, it } from 'vitest';
import { parseRoute, routeHref, sameRoute } from '../src/client/router.ts';

describe('reading a URL', () => {
  it('reads the root as the dashboard', () => {
    expect(parseRoute('/')).toEqual({ view: 'index' });
    expect(parseRoute('')).toEqual({ view: 'index' });
  });

  it('reads an issue', () => {
    expect(parseRoute('/wt350')).toEqual({ view: 'issue', id: 'wt350' });
    expect(parseRoute('/wt350/')).toEqual({ view: 'issue', id: 'wt350' });
  });

  it('reads the send layer', () => {
    expect(parseRoute('/wt350/send')).toEqual({ view: 'send', id: 'wt350' });
  });

  it('lands a stale link on the issue rather than nowhere', () => {
    expect(parseRoute('/wt350/whatever')).toEqual({ view: 'issue', id: 'wt350' });
  });
});

describe('writing a URL', () => {
  it('round-trips every view', () => {
    for (const route of [
      { view: 'index' } as const,
      { view: 'issue', id: 'wt350' } as const,
      { view: 'send', id: 'wt350' } as const,
    ]) {
      expect(parseRoute(routeHref(route))).toEqual(route);
    }
  });

  it('escapes an id that would otherwise change the path', () => {
    const route = { view: 'issue', id: 'wt/350' } as const;
    expect(routeHref(route)).toBe('/wt%2F350');
    expect(parseRoute(routeHref(route))).toEqual(route);
  });

  it('compares routes by where they point', () => {
    expect(sameRoute({ view: 'issue', id: 'wt350' }, { view: 'issue', id: 'wt350' })).toBe(true);
    expect(sameRoute({ view: 'issue', id: 'wt350' }, { view: 'send', id: 'wt350' })).toBe(false);
  });
});
