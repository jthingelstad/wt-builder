/**
 * Where you are, as a URL.
 *
 * The design models this as one app with view states (`view: "index" |
 * "editor"`, and Send as a full-screen layer *over* the editor rather than a
 * page beside it), so this is not a split into separate documents. It gives
 * those states addresses.
 *
 * Without them the app has no back button, no bookmarkable issue, no way to
 * open two issues in two tabs, and a reload always lands back on the index
 * having forgotten what you had open.
 */

export type Route =
  | { view: 'index' }
  | { view: 'issue'; id: string }
  | { view: 'send'; id: string };

/** The issue id is the path segment — `wt350` is both the id and the URL. */
export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { view: 'index' };

  const id = parts[0]!;
  // Anything unrecognised after the id is still that issue, not a 404: a
  // stale bookmark should land you on the issue rather than nowhere.
  if (parts[1] === 'send') return { view: 'send', id };
  return { view: 'issue', id };
}

export function routeHref(route: Route): string {
  if (route.view === 'index') return '/';
  const id = encodeURIComponent(route.id);
  return route.view === 'send' ? `/${id}/send` : `/${id}`;
}

export function sameRoute(a: Route, b: Route): boolean {
  return routeHref(a) === routeHref(b);
}
