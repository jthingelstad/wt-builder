/**
 * Where you are, as a URL.
 *
 * The design models this as one app with view states (`view: "index" |
 * "editor"`, and Send as a full-screen layer *over* the editor rather than a
 * page beside it; Share, once an issue is put to bed, and Stats are layers
 * the same way), so this is not a split into separate documents. It gives
 * those states addresses.
 *
 * Without them the app has no back button, no bookmarkable issue, no way to
 * open two issues in two tabs, and a reload always lands back on the index
 * having forgotten what you had open.
 */

export type Route =
  | { view: 'index' }
  | { view: 'issue'; id: string }
  | { view: 'send'; id: string }
  | { view: 'share'; id: string }
  | { view: 'stats'; id: string }
  // Another Thing, the podcast: its episodes, one episode, and its card.
  | { view: 'episodes' }
  | { view: 'episode'; id: string }
  | { view: 'record'; id: string };

/** The podcast's routes, which the issue's loading leaves alone. */
export function isPodcast(route: Route): route is Extract<Route, { view: 'episodes' | 'episode' | 'record' }> {
  return route.view === 'episodes' || route.view === 'episode' || route.view === 'record';
}

/** The issue id is the path segment — `wt350` is both the id and the URL. */
export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { view: 'index' };

  const id = parts[0]!;
  if (id === 'another') return { view: 'episodes' };
  // An episode is `at<N>`, as an issue is `wt<N>`.
  if (/^at\d+$/.test(id)) return parts[1] === 'record' ? { view: 'record', id } : { view: 'episode', id };
  // Anything unrecognised after the id is still that issue, not a 404: a
  // stale bookmark should land you on the issue rather than nowhere.
  if (parts[1] === 'send') return { view: 'send', id };
  if (parts[1] === 'share') return { view: 'share', id };
  if (parts[1] === 'stats') return { view: 'stats', id };
  return { view: 'issue', id };
}

export function routeHref(route: Route): string {
  if (route.view === 'index') return '/';
  if (route.view === 'episodes') return '/another';
  const id = encodeURIComponent(route.id);
  return route.view === 'issue' || route.view === 'episode' ? `/${id}` : `/${id}/${route.view}`;
}

export function sameRoute(a: Route, b: Route): boolean {
  return routeHref(a) === routeHref(b);
}
