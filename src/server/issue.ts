/**
 * Issue operations.
 *
 * The document is the unit of work: every operation takes a document and
 * returns a new one. There is no undo and no conflict model (docs/decisions.md) — a single
 * editor means the last write is simply the truth.
 */

import type {
  Candidate,
  Channel,
  EchoOption,
  IssueDoc,
  IssueNode,
  Item,
  ItemType,
} from '../shared/types.ts';
import { SCHEMA_VERSION, allChannels, emptyChannels } from '../shared/types.ts';
import { type Window, addDays, instantOf, issueWindow, issueSaturday } from '../shared/dates.ts';
import { bodyLines, orderedNodes, outOfWindow, windowOf } from '../shared/render/plan.ts';
import * as pinboard from './integrations/pinboard.ts';
import * as microblog from './integrations/microblog.ts';
import { reconcileItem, type RemoteFields } from './reconcile.ts';

/** Sections that print no heading — the content carries itself. */
const HEADLESS: ReadonlySet<string> = new Set([
  'intro', 'outro', 'photo', 'haiku', 'membership', 'mdblock',
]);

/** The familiar skeleton. Every node is removable, and missing ones are offered back. */
const SKELETON: { id: string; type: string; label: string }[] = [
  { id: 'intro', type: 'intro', label: 'Intro' },
  { id: 'currently', type: 'currently', label: 'Currently' },
  { id: 'photo', type: 'photo', label: 'Photo' },
  { id: 'notable', type: 'notable', label: 'Notable' },
  { id: 'journal', type: 'journal', label: 'Journal' },
  { id: 'briefly', type: 'briefly', label: 'Briefly' },
  { id: 'membership', type: 'membership', label: 'Membership' },
  { id: 'outro', type: 'outro', label: 'Outro' },
  { id: 'haiku', type: 'haiku', label: 'Haiku' },
  { id: 'echoes', type: 'echoes', label: 'Echoes' },
];

export function standardSections(): { id: string; type: string; label: string }[] {
  return SKELETON.map((s) => ({ ...s }));
}

function node(id: string, type: string, label: string, items: string[] = []): IssueNode {
  return {
    id,
    kind: 'section',
    type: type as IssueNode['type'],
    label,
    movable: type !== 'echoes',
    publishes_heading: !HEADLESS.has(type),
    ...(type === 'echoes' ? { fixed_position: 'last' as const, required: false } : {}),
    items,
  };
}

function seedItem(type: ItemType, extra: Partial<Item> = {}): Item {
  const thingy = type === 'membership' || type === 'echoes' || type === 'echo';
  const base: Item = {
    type,
    authorship: thingy ? 'Thingy' : 'Jamie',
    source: thingy ? 'Thingy' : type === 'haiku' ? 'generated' : 'direct',
    channels: allChannels(),
    body: '',
    ...extra,
  };
  if (thingy) {
    base.attribution = 'Thingy';
    base.status = 'draft';
  }
  if (type === 'photo') {
    base.channels = { website: true, email: true, audio: false };
    base.channel_locks = { audio: 'Photos are omitted from audio rather than narrated.' };
  }
  // Echoes is spoken since 2026-09-20: Thingy has a voice now.
  return base;
}

export function createIssue(opts: {
  number: number;
  publication_date: string;
  window_days?: number;
  title?: string;
  dek?: string;
}): IssueDoc {
  const publication_date = issueSaturday(opts.publication_date);
  const items: Record<string, Item> = {};
  const nodes: IssueNode[] = [];

  for (const s of SKELETON) {
    // Photo is seeded too: the section holds exactly one photo, and the empty
    // item *is* the drop zone. Without it the section renders nothing and the
    // "Photo placed" checklist item has no way to be satisfied.
    // Echoes is not seeded: it is a section of `echo` items, like Currently
    // is lines, and the wand on its heading appends them (2026-09-20).
    const seeded: ItemType[] = [
      'intro', 'currently', 'photo', 'membership', 'outro', 'haiku',
    ];
    if (seeded.includes(s.type as ItemType)) {
      const itemId = `${s.id}-1`;
      const extra = s.type === 'currently' ? { label: 'Building' } : {};
      items[itemId] = seedItem(s.type as ItemType, extra);
      nodes.push(node(s.id, s.type, s.label, [itemId]));
    } else {
      nodes.push(node(s.id, s.type, s.label, []));
    }
  }

  return {
    schema_version: SCHEMA_VERSION,
    issue: {
      id: `wt${opts.number}`,
      number: opts.number,
      title: opts.title ?? `The Weekly Thing ${opts.number}`,
      dek: opts.dek ?? '',
      status: 'draft',
      publication_date,
      window_days: opts.window_days ?? 7,
      output_order: nodes.map((n) => n.id),
    },
    nodes,
    items: items,
    orphans: [],
    sends: {},
  };
}

// ── sweep ─────────────────────────────────────────────────────────────────

export interface SweepReport {
  added: number;
  skipped: number;
  /** Items whose source-side edits were adopted into the issue. */
  refreshed: number;
  /** Items whose source record has been deleted; local copies are kept. */
  gone: number;
  /** Items edited both here and at the source; local copies are kept. */
  conflicts: number;
  window: { from: string; to: string };
  candidates: Candidate[];
  /** One line per thing that happened, for the issue's event log. */
  log: { kind: string; summary: string }[];
}

/** A short human handle for an item, for log lines and reports. */
export function itemName(item: Item): string {
  const text = (item.title ?? item.label ?? String(item.commentary ?? item.body ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
  return text ? (text.length > 60 ? `${text.slice(0, 59)}…` : text) : '(untitled)';
}

/**
 * Everything a sweep needs from the network, gathered before the document is
 * touched. A sweep talks to Pinboard once per link and takes many seconds;
 * the document it started from is stale by the time it is done. Splitting
 * the fetch from the apply is what lets the apply run on a fresh read
 * (see `sweep` and the route), so an edit saved mid-scan is never written
 * over by the scan's older copy — which is exactly how two Currently lines
 * lost their links on 2026-09-20.
 */
export interface SweepFetch {
  window: Window;
  links: Candidate[];
  posts: Candidate[];
  /** Pinboard's current record per source_url; absent when the fetch failed. */
  bookmarks: Map<string, RemoteFields | null>;
  /** Micro.blog's current index, or null when it could not be read. */
  microblog: Awaited<ReturnType<typeof microblog.remoteIndex>> | null;
  /** Capture times for Pinboard items that had none, by source_url. */
  captureTimes: Map<string, string>;
}

export async function fetchForSweep(doc: IssueDoc): Promise<SweepFetch> {
  const window = issueWindow(doc.issue.publication_date, doc.issue.window_days);
  const [links, posts] = await Promise.all([
    pinboard.sweepPinboard(window).catch((e) => {
      console.warn(`[sweep] Pinboard failed: ${(e as Error).message}`);
      return [] as Candidate[];
    }),
    microblog.sweepMicroblog(window).catch((e) => {
      console.warn(`[sweep] Micro.blog failed: ${(e as Error).message}`);
      return [] as Candidate[];
    }),
  ]);

  let mb: SweepFetch['microblog'] = null;
  try {
    mb = await microblog.remoteIndex();
  } catch (e) {
    console.warn(`[sweep] Micro.blog reconcile skipped: ${(e as Error).message}`);
  }

  // Only what the window will keep is worth a round trip — plus a fallen-out
  // item the prune keeps for an unwritten edit, which needs the read to ever
  // resolve (converge, conflict, or gone) and stop being kept.
  const w = window;
  const bookmarks = new Map<string, RemoteFields | null>();
  const captureTimes = new Map<string, string>();
  for (const item of Object.values(doc.items)) {
    if (item.source !== 'Pinboard' || !item.source_url) continue;
    if (outOfWindow(item, w) && !UNSYNCED.has(item.sync_state ?? '')) continue;
    try {
      bookmarks.set(item.source_url, await pinboard.fetchBookmark(item.source_url));
    } catch (e) {
      console.warn(`[sweep] Pinboard reconcile skipped for ${item.source_url}: ${(e as Error).message}`);
    }
    if (!item.published_at) {
      const time = await pinboard.captureTime(item.source_url);
      if (time) captureTimes.set(item.source_url, time);
    }
  }

  return { window, links, posts, bookmarks, microblog: mb, captureTimes };
}

/**
 * Apply a fetched sweep to a document. Synchronous and pure in the document:
 * given the freshest read, nothing can change under it before it is saved.
 * Items already present (by source_id) are left alone so a re-sweep is safe;
 * items the window no longer admits are dropped (pruneOutsideWindow).
 */
export function applySweep(doc: IssueDoc, fetched: SweepFetch): { doc: IssueDoc; report: SweepReport } {
  const { window, links, posts } = fetched;
  const next = structuredClone(doc);
  const known = new Map(
    Object.entries(next.items)
      .filter(([, i]) => i.source_id)
      .map(([id, i]) => [i.source_id as string, id]),
  );

  let added = 0;
  let skipped = 0;
  const justAdded = new Set<string>();
  const log: { kind: string; summary: string }[] = [];

  for (const c of links) {
    // Excluded at Pinboard: not in the issue, by Jamie's hand.
    if ((c.tags ?? []).some(pinboard.isExcludeTag) && !known.has(c.id)) { skipped++; continue; }
    const existing = known.get(c.id);
    if (existing) {
      // Items swept before the converter carried the capture time are
      // unjudgeable by the window. Backfill rather than leave them immune.
      const item = next.items[existing];
      if (item && !item.published_at && c.published_at) {
        item.published_at = c.published_at;
      }
      skipped++;
      continue;
    }
    const item = pinboard.candidateToItem(c);
    const id = idFor(next, c);
    next.items[id] = item;
    placeInto(next, id, item.section ?? pinboard.DEFAULT_LINK_SECTION);
    justAdded.add(id);
    log.push({ kind: 'swept-in', summary: `${itemName(item)} — Pinboard, into ${item.section ?? pinboard.DEFAULT_LINK_SECTION}` });
    added++;
  }

  for (const c of posts) {
    if (known.has(c.id)) { skipped++; continue; }
    const item = microblog.candidateToItem(c);
    const id = idFor(next, c);
    next.items[id] = item;
    placeInto(next, id, 'Journal');
    justAdded.add(id);
    log.push({ kind: 'swept-in', summary: `${itemName(item)} — Micro.blog, into Journal` });
    added++;
  }

  // ── the window is the membership ─────────────────────────────────────────
  log.push(...pruneOutsideWindow(next));

  // ── reconcile: the source side of the mirror ─────────────────────────────
  //
  // Pinboard and Micro.blog are the CMS; edits made there flow in here, with
  // `source_snapshot` as the merge base (src/server/reconcile.ts). A source
  // that was not fetched (API failure, or an item that arrived after the
  // fetch) is skipped — an unreachable API must never read as a deletion.
  const reconciled = { refreshed: 0, gone: 0, conflicts: 0 };
  const mb = fetched.microblog;

  for (const [id, item] of Object.entries(next.items)) {
    if (justAdded.has(id) || !item.source_url) continue;

    let remote: RemoteFields | null;
    if (item.source === 'Pinboard') {
      if (!fetched.bookmarks.has(item.source_url)) continue;
      remote = fetched.bookmarks.get(item.source_url)!;
    } else if (item.source === 'Micro.blog' && mb) {
      const found = mb.byUrl.get(item.source_url);
      if (found) {
        remote = found;
      } else {
        // Absent from the index is a deletion only when the fetch reached
        // back past this post's own date.
        const covered =
          mb.coveredFrom !== null &&
          item.published_at !== undefined &&
          Date.parse(mb.coveredFrom) <= Date.parse(item.published_at);
        if (!covered) continue;
        remote = null;
      }
    } else {
      continue;
    }

    const outcome = reconcileItem(item, remote);
    if (outcome === 'refreshed') {
      reconciled.refreshed++;
      log.push({ kind: 'refreshed', summary: `${itemName(item)} — adopted the ${item.source} edit` });
    } else if (outcome === 'gone') {
      reconciled.gone++;
    } else if (outcome === 'conflict') {
      reconciled.conflicts++;
      log.push({ kind: 'conflict', summary: `${itemName(item)} — edited both here and at ${item.source}` });
    }
  }

  // Deleted at the source is deleted here; the reconcile above marked them.
  log.push(...pruneGone(next));

  log.push(...followBookmarkTags(next, justAdded));

  // Heal Pinboard items that predate the converter carrying published_at.
  for (const item of Object.values(next.items)) {
    if (item.source !== 'Pinboard' || item.published_at || !item.source_url) continue;
    const time = fetched.captureTimes.get(item.source_url);
    if (time) item.published_at = time;
  }

  sortJournal(next);
  return { doc: next, report: { added, skipped, ...reconciled, window, candidates: [...links, ...posts], log } };
}

/**
 * Fetch and apply against one document. For tests and scripts; the route
 * fetches, then re-reads the issue and applies to that, so a long fetch
 * cannot write over an edit saved while it ran.
 */
export async function sweep(doc: IssueDoc): Promise<{ doc: IssueDoc; report: SweepReport }> {
  return applySweep(doc, await fetchForSweep(doc));
}

/** An edit here that the source has not received yet. Dropping the item would lose it. */
const UNSYNCED: ReadonlySet<string> = new Set(['local', 'syncing', 'failed', 'conflict']);

/**
 * Drop the syndicated items the window no longer admits.
 *
 * The window is the issue's membership: Jamie widened WT350 to three weeks,
 * narrowed it back to one, and rightly expected the two weeks he let go of to
 * be gone — not kept and marked OUTSIDE WINDOW in every count and lens
 * (2026-09-20). A dropped item's words live at the source and a re-scan
 * inside a wider window brings it straight back, so nothing is lost —
 * except an edit that has not written back yet, and that item is kept and
 * named in the log. Mutates `doc`; returns the log lines.
 */
export function pruneOutsideWindow(doc: IssueDoc): { kind: string; summary: string }[] {
  const w = issueWindow(doc.issue.publication_date, doc.issue.window_days);
  const log: { kind: string; summary: string }[] = [];
  const dropped = new Set<string>();

  for (const [id, item] of Object.entries(doc.items)) {
    if (!outOfWindow(item, w)) continue;
    if (UNSYNCED.has(item.sync_state ?? '')) {
      log.push({ kind: 'kept', summary: `${itemName(item)} — outside the window, kept: an edit here has not reached ${item.source}` });
      continue;
    }
    dropped.add(id);
    log.push({ kind: 'dropped', summary: `${itemName(item)} — outside the window` });
  }
  dropItems(doc, dropped);
  return log;
}

/** Take items out of the document entirely: items, nodes, held-out and held lists. */
function dropItems(doc: IssueDoc, dropped: Set<string>): void {
  if (!dropped.size) return;
  for (const id of dropped) delete doc.items[id];
  for (const n of doc.nodes) n.items = n.items.filter((id) => !dropped.has(id));
  for (const n of doc.held_nodes ?? []) n.items = n.items.filter((id) => !dropped.has(id));
  doc.orphans = (doc.orphans ?? []).filter((id) => !dropped.has(id));

  // A promoted post that went leaves an empty section behind; take it too.
  doc.nodes = doc.nodes.filter((n) => n.kind !== 'promoted_item' || n.items.length > 0);
  if (doc.issue.output_order) {
    const live = new Set(doc.nodes.map((n) => n.id));
    doc.issue.output_order = doc.issue.output_order.filter((id) => live.has(id));
  }
}

/**
 * Drop the items whose source record is gone.
 *
 * Deleting a bookmark at Pinboard IS the editorial act — Jamie files there
 * (2026-09-20: "it should have been removed from WT350 at the same time").
 * The earlier rule kept a `gone` copy and surfaced it; that left deleted links
 * sitting in the issue until removed a second time by hand. The words are
 * one row away in `revisions` if the deletion was a slip. Mutates `doc`.
 */
export function pruneGone(doc: IssueDoc): { kind: string; summary: string }[] {
  const log: { kind: string; summary: string }[] = [];
  const dropped = new Set<string>();
  for (const [id, item] of Object.entries(doc.items)) {
    if (item.sync_state !== 'gone') continue;
    dropped.add(id);
    log.push({ kind: 'dropped', summary: `${itemName(item)} — deleted at ${item.source}` });
  }
  dropItems(doc, dropped);
  return log;
}

/**
 * Placement follows the bookmark. Jamie files links in Pinboard — `_brief`
 * is Briefly, no description is Briefly, a described unmarked link is
 * Notable (pinboard.sectionForBookmark) — and the reconcile has just adopted
 * whatever the bookmark now says. A link whose tags and commentary match its
 * snapshot has no local edit in flight, so its section is re-derived and it
 * moves if the bookmark moved. A move made in the builder is a tag edit too
 * (moveLinkToSection), so it shows as a pending local edit and is left alone.
 *
 * The move here is placement only: an inferred Briefly must not write
 * `_brief` onto the bookmark, or the inference would outlive the description
 * that later contradicts it. Mutates `doc`; returns the log lines.
 */
export function followBookmarkTags(
  doc: IssueDoc,
  skip: Set<string> = new Set(),
): { kind: string; summary: string }[] {
  const log: { kind: string; summary: string }[] = [];
  const norm = (v: unknown) => (Array.isArray(v) ? [...v].sort().join(' ') : String(v ?? '')).trim();
  for (const [id, item] of Object.entries(doc.items)) {
    if (item.type !== 'pinboard_link' || item.source !== 'Pinboard' || skip.has(id)) continue;
    if (item.placement_query) continue; // Jamie has a question open on it
    // Only a link with a sweep record can be said to follow its bookmark.
    const snapshot = item.source_snapshot;
    if (!snapshot || !Array.isArray(snapshot.tags)) continue;
    const tags = item.tags ?? [];
    if (norm(tags) !== norm(snapshot.tags) || norm(item.commentary) !== norm(snapshot.commentary)) continue;
    const implied = pinboard.sectionForBookmark(tags, item.commentary);
    if (implied !== 'Notable' && implied !== 'Briefly') continue;
    const here = doc.nodes.find((n) => n.items.includes(id));
    const excludedAtSource = tags.some(pinboard.isExcludeTag);
    const heldOut = (doc.orphans ?? []).includes(id);

    // `_exclude` on the bookmark holds the link out; off again puts it back.
    if (excludedAtSource && here) {
      here.items = here.items.filter((i) => i !== id);
      if (!item.section) item.section = here.label;
      item.excluded = true;
      doc.orphans = [...(doc.orphans ?? []), id];
      log.push({ kind: 'held-out', summary: `${itemName(item)} — _exclude at Pinboard` });
      continue;
    }
    if (!excludedAtSource && heldOut && item.excluded) {
      const dest = doc.nodes.find((n) => n.kind === 'section' && n.label === implied);
      if (!dest) continue;
      doc.orphans = (doc.orphans ?? []).filter((i) => i !== id);
      delete item.excluded;
      dest.items.push(id);
      item.section = implied;
      log.push({ kind: 'put-back', summary: `${itemName(item)} — _exclude came off at Pinboard, into ${implied}` });
      continue;
    }

    if (!here || here.kind !== 'section') continue;
    const from = here.label;
    if ((from !== 'Notable' && from !== 'Briefly') || from === implied) continue;
    const dest = doc.nodes.find((n) => n.kind === 'section' && n.label === implied);
    if (!dest) continue;
    here.items = here.items.filter((i) => i !== id);
    dest.items.push(id);
    item.section = implied;
    log.push({ kind: 'moved', summary: `${itemName(item)} — ${from} → ${implied}, following the bookmark` });
  }
  return log;
}

function idFor(doc: IssueDoc, c: Candidate): string {
  const slug = String(c.url)
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase()
    .split('-')
    .filter(Boolean)
    .slice(-3)
    .join('-');
  const base = `${c.origin === 'Pinboard' ? 'link' : 'journal'}-${slug}`.slice(0, 60);
  let id = base;
  for (let n = 2; id in doc.items; n++) id = `${base}-${n}`;
  return id;
}

function placeInto(doc: IssueDoc, itemId: string, sectionLabel: string): void {
  const target = doc.nodes.find(
    (n) => n.kind === 'section' && n.label.toLowerCase() === sectionLabel.toLowerCase(),
  );
  if (target) {
    target.items.push(itemId);
    // Stamp where it actually landed. Without this, an item swept in untagged
    // is held out on section removal and never offered back, because
    // reclamation matches on the item's own section.
    const item = doc.items[itemId];
    if (item) item.section = target.label;
  } else {
    doc.orphans = [...(doc.orphans ?? []), itemId];
  }
}

/** Journal reads in publication order. */
function sortJournal(doc: IssueDoc): void {
  const journal = doc.nodes.find((n) => n.type === 'journal' && n.kind === 'section');
  if (!journal) return;
  // By instant, not by string: offsets differ between sources.
  journal.items.sort((a, b) => {
    const x = instantOf(doc.items[a]?.published_at) ?? 0;
    const y = instantOf(doc.items[b]?.published_at) ?? 0;
    return x - y;
  });
}

// ── mutations ─────────────────────────────────────────────────────────────

export function updateItem(doc: IssueDoc, itemId: string, patch: Partial<Item>): IssueDoc {
  const next = structuredClone(doc);
  const item = next.items[itemId];
  if (!item) return next;
  const bodyChanged =
    (patch.body !== undefined && patch.body !== item.body) ||
    (patch.member_thanks !== undefined && patch.member_thanks !== item.member_thanks);
  const describedNow =
    item.type === 'pinboard_link' &&
    patch.commentary !== undefined &&
    !String(item.commentary ?? '').trim() &&
    Boolean(String(patch.commentary).trim());
  Object.assign(item, patch);

  // First description, written in Briefly, on a link with no _brief mark:
  // the filing rule now says Notable, the act says Briefly. Ask.
  if (describedNow && !(item.tags ?? []).some(pinboard.isBriefTag)) {
    const here = next.nodes.find((n) => n.items.includes(itemId));
    if (here?.label.toLowerCase() === 'briefly') item.placement_query = true;
  }

  const sourceFieldChanged =
    (item.source === 'Pinboard' && ['title', 'commentary', 'tags'].some((key) => key in patch)) ||
    (item.source === 'Micro.blog' && ['title', 'body'].some((key) => key in patch));
  // A `gone` item has no source record to write to — editing it must not
  // queue a write-back that would silently recreate the deleted bookmark.
  if (sourceFieldChanged && item.sync_state !== 'gone') {
    item.sync_state = 'syncing';
    delete item.sync_error;
  }

  // Words landing in a Thingy item are Jamie's act — a pick from the wand or
  // his own edit — and that act is the review. There is no second gate
  // (Jamie, 2026-09-20: "I see the three options and put it in").
  if (item.authorship === 'Thingy' && bodyChanged) {
    item.reviewed = true;
    item.status = 'reviewed';
  }
  return next;
}

/** A locked channel cannot be set true; the reason is shown, never ignored. */
export function setChannel(
  doc: IssueDoc,
  itemId: string,
  channel: Channel,
  on: boolean,
): IssueDoc {
  const next = structuredClone(doc);
  const item = next.items[itemId];
  if (!item) return next;
  if (on && item.channel_locks?.[channel]) return next;
  item.channels = { ...item.channels, [channel]: on };
  return next;
}

/** Hiding an item means every channel false. There is no separate flag. */
export function hideItem(doc: IssueDoc, itemId: string): IssueDoc {
  const next = structuredClone(doc);
  const item = next.items[itemId];
  if (item) item.channels = emptyChannels();
  return next;
}

export function showItem(doc: IssueDoc, itemId: string): IssueDoc {
  const next = structuredClone(doc);
  const item = next.items[itemId];
  if (!item) return next;
  const channels = allChannels();
  for (const c of Object.keys(item.channel_locks ?? {}) as Channel[]) channels[c] = false;
  item.channels = channels;
  return next;
}

function moveWithin<T>(list: T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (index < 0 || to < 0 || to >= list.length) return list;
  const copy = [...list];
  const [moved] = copy.splice(index, 1);
  copy.splice(to, 0, moved!);
  return copy;
}

export function moveNode(doc: IssueDoc, nodeId: string, delta: number): IssueDoc {
  const next = structuredClone(doc);
  const order = orderedNodes(next).map((n) => n.id);
  const index = order.indexOf(nodeId);
  const target = next.nodes.find((n) => n.id === nodeId);
  if (index < 0 || !target?.movable) return next;

  const neighbourId = order[index + delta];
  const neighbour = next.nodes.find((n) => n.id === neighbourId);
  // Echoes is pinned last; nothing swaps past it.
  if (!neighbour || neighbour.fixed_position === 'last') return next;

  next.issue.output_order = moveWithin(order, index, delta);
  return next;
}

export function moveItem(doc: IssueDoc, nodeId: string, itemId: string, delta: number): IssueDoc {
  const next = structuredClone(doc);
  const target = next.nodes.find((n) => n.id === nodeId);
  if (!target) return next;
  target.items = moveWithin(target.items, target.items.indexOf(itemId), delta);
  return next;
}

/**
 * Put a section's items in the given order. `order` names the items being
 * arranged; anything in the node it does not name (held out, fallen out of
 * the window) keeps its relative place after them. Ids not in the node are
 * ignored, so a stale suggestion cannot pull an item in from elsewhere.
 */
export function setItemOrder(doc: IssueDoc, nodeId: string, order: string[]): IssueDoc {
  const next = structuredClone(doc);
  const target = next.nodes.find((n) => n.id === nodeId);
  if (!target) return next;
  const inNode = new Set(target.items);
  const named = order.filter((id, i) => inNode.has(id) && order.indexOf(id) === i);
  const rest = target.items.filter((id) => !named.includes(id));
  target.items = [...named, ...rest];
  return next;
}

/** Promotion changes placement and presentation, not provenance. */
export function promote(doc: IssueDoc, itemId: string): IssueDoc {
  const next = structuredClone(doc);
  const item = next.items[itemId];
  if (!item) return next;

  const source = next.nodes.find((n) => n.items.includes(itemId));
  if (!source) return next;
  source.items = source.items.filter((i) => i !== itemId);

  item.presentation = 'promoted';
  const promotedNode: IssueNode = {
    id: `promoted-${itemId}`,
    kind: 'promoted_item',
    type: 'journal_post',
    label: item.title ?? 'Promoted post',
    movable: true,
    publishes_heading: true,
    items: [itemId],
  };

  const at = next.nodes.indexOf(source);
  next.nodes.splice(at, 0, promotedNode);
  next.issue.output_order = insertBefore(next, promotedNode.id, source.id);
  return next;
}

/**
 * Move a link between the heading sections and Briefly. The editorial act is
 * one gesture, but it is also a source edit: Briefly is `_brief` on the
 * bookmark (Jamie's Pinboard convention), so the move adjusts the tag and
 * marks the item for write-back — the route pushes it, the same path any
 * other tag edit takes. A `gone` bookmark moves locally but is never
 * queued for a write that would recreate it.
 */
export function moveLinkToSection(
  doc: IssueDoc,
  itemId: string,
  target: 'Notable' | 'Briefly',
): IssueDoc {
  const next = structuredClone(doc);
  const item = next.items[itemId];
  if (!item || item.type !== 'pinboard_link') return next;

  const source = next.nodes.find((n) => n.items.includes(itemId));
  const dest = next.nodes.find(
    (n) => n.kind === 'section' && n.label.toLowerCase() === target.toLowerCase(),
  );
  if (!source || !dest) return next;
  // Choosing a section answers the open question, including "stay where it
  // is" — which still puts the mark on the bookmark so the rule agrees.
  delete item.placement_query;

  if (source !== dest) {
    source.items = source.items.filter((i) => i !== itemId);
    dest.items.push(itemId);
    item.section = dest.label;
  }

  const tags = item.tags ?? [];
  const hasBrief = tags.some(pinboard.isBriefTag);
  const tagChanges = target === 'Briefly' ? !hasBrief : hasBrief;
  if (tagChanges) {
    item.tags =
      target === 'Briefly'
        ? [...tags, pinboard.BRIEF_TAG]
        : tags.filter((t) => !pinboard.isBriefTag(t));
    // Only a real Pinboard bookmark queues a write; a link written directly
    // into the issue has no source record, and `gone` must not recreate one.
    if (item.source === 'Pinboard' && item.sync_state !== 'gone') {
      item.sync_state = 'syncing';
      delete item.sync_error;
    }
  }
  return next;
}

export function demote(doc: IssueDoc, nodeId: string): IssueDoc {
  const next = structuredClone(doc);
  const promoted = next.nodes.find((n) => n.id === nodeId && n.kind === 'promoted_item');
  const journal = next.nodes.find((n) => n.type === 'journal' && n.kind === 'section');
  if (!promoted || !journal) return next;

  for (const itemId of promoted.items) {
    const item = next.items[itemId];
    if (item) item.presentation = 'journal';
    journal.items.push(itemId);
  }
  next.nodes = next.nodes.filter((n) => n.id !== nodeId);
  next.issue.output_order = (next.issue.output_order ?? []).filter((id) => id !== nodeId);
  sortJournal(next);
  return next;
}

function insertBefore(doc: IssueDoc, id: string, beforeId: string): string[] {
  const order = doc.issue.output_order ?? doc.nodes.map((n) => n.id);
  const without = order.filter((x) => x !== id);
  const at = without.indexOf(beforeId);
  if (at < 0) return [...without, id];
  return [...without.slice(0, at), id, ...without.slice(at)];
}

/**
 * Remove one item from its section, with the same asymmetry as removing a
 * section: a **syndicated** item is held out — it is still sitting in the
 * window and the sweep would bring it straight back, so removal must be a
 * durable "no" — while a **locally-authored** item (a drafted Currently
 * entry, a written link) is simply deleted. It has no sweep to return from,
 * and there is no undo (docs/decisions.md).
 */
export function removeItem(doc: IssueDoc, nodeId: string, itemId: string): IssueDoc {
  const next = structuredClone(doc);
  const target = next.nodes.find((n) => n.id === nodeId);
  const item = next.items[itemId];
  if (!target || !item || !target.items.includes(itemId)) return next;

  target.items = target.items.filter((id) => id !== itemId);
  if (item.authorship === 'syndicated') {
    // Remember where it came from so Put back knows its natural section.
    if (!item.section) item.section = target.label;
    next.orphans = [...(next.orphans ?? []), itemId];
    // A Pinboard link records the exclusion on the bookmark, where Jamie
    // files: `_exclude` goes on and is written back by the route.
    if (item.source === 'Pinboard' && item.sync_state !== 'gone') {
      const tags = item.tags ?? [];
      if (!tags.some(pinboard.isExcludeTag)) item.tags = [...tags, pinboard.EXCLUDE_TAG];
      item.excluded = true;
      item.sync_state = 'syncing';
      delete item.sync_error;
    }
  } else {
    delete next.items[itemId];
  }
  return next;
}

/** Removing a section holds its syndicated items out rather than deleting them. */
/**
 * Remove a section: **delete** its locally-authored items, **hold out** its
 * syndicated ones.
 *
 * The asymmetry is the point. A syndicated item is still sitting in the window
 * and would be swept straight back in, so removing it needs a durable "no" —
 * that is what `orphans` is, and it renders in the Held out group with Put
 * back. A locally-authored item has no sweep to return from; it was written
 * into this section and goes with it.
 *
 * Deleted local items are stashed in `held_items` rather than dropped on the
 * floor, so restoring the section restores them too (docs/decisions.md). They are out of
 * `items`, so no edition and no lens can reach them in the meantime.
 */
export function removeSection(doc: IssueDoc, nodeId: string): IssueDoc {
  const next = structuredClone(doc);
  const target = next.nodes.find((n) => n.id === nodeId);
  if (!target) return next;

  const syndicated: string[] = [];
  const stash: Record<string, Item> = { ...(next.held_items ?? {}) };

  for (const itemId of target.items) {
    const item = next.items[itemId];
    if (!item) continue;
    if (item.authorship === 'syndicated') {
      // Remember where it came from so Put back knows its natural section.
      if (!item.section) item.section = target.label;
      syndicated.push(itemId);
    } else {
      stash[itemId] = item;
      delete next.items[itemId];
    }
  }

  next.held_items = stash;
  next.held_nodes = [
    ...(next.held_nodes ?? []).filter((n) => n.id !== target.id),
    structuredClone(target),
  ];
  next.orphans = [...(next.orphans ?? []), ...syndicated];
  next.nodes = next.nodes.filter((n) => n.id !== nodeId);
  next.issue.output_order = (next.issue.output_order ?? []).filter((id) => id !== nodeId);
  return next;
}

/** Missing standard sections are offered back, so removal is never one-way. */
export function addSection(
  doc: IssueDoc,
  spec: { type: string; label: string; id?: string; before?: string },
): IssueDoc {
  const next = structuredClone(doc);
  const id = spec.id ?? `${spec.type}-${Date.now().toString(36)}`;
  if (next.nodes.some((n) => n.id === id)) {
    // An existing id with a target is the outline's drag-reorder. Without a
    // target it is a no-op — never a duplicate.
    if (spec.before && next.nodes.some((n) => n.id === spec.before)) {
      next.issue.output_order = insertBefore(next, id, spec.before);
    }
    return next;
  }

  const heldIndex = (next.held_nodes ?? []).findIndex(
    (n) => n.id === id || (!spec.id && n.type === spec.type && n.label === spec.label),
  );
  const held = heldIndex >= 0 ? next.held_nodes![heldIndex] : undefined;
  if (held) next.held_nodes = next.held_nodes!.filter((_, i) => i !== heldIndex);

  const created = held ? structuredClone(held) : node(id, spec.type, spec.label);
  if (!held && spec.type === 'ad_hoc') {
    const itemId = `ad-${Date.now().toString(36)}`;
    created.kind = 'ad_hoc';
    created.items = [itemId];
    next.items[itemId] = seedItem('markdown');
  }

  // Put back the locally-authored items this section took with it.
  if (held && next.held_items) {
    for (const itemId of held.items) {
      const stashed = next.held_items[itemId];
      if (!stashed) continue;
      next.items[itemId] = stashed;
      delete next.held_items[itemId];
    }
  }

  // Reclaim any of this section's items that were held out.
  const reclaimed = held
    ? held.items
    : (next.orphans ?? []).filter((itemId) => {
        const item = next.items[itemId];
        return item?.section?.toLowerCase() === spec.label.toLowerCase();
      });
  if (!created.items.length) created.items = reclaimed;
  next.orphans = (next.orphans ?? []).filter((i) => !reclaimed.includes(i));

  next.nodes.push(created);
  if (spec.before && next.nodes.some((n) => n.id === spec.before)) {
    // An insert point names its neighbour; the section lands right there.
    next.issue.output_order = insertBefore(next, id, spec.before);
    return next;
  }
  const order = next.issue.output_order ?? next.nodes.map((n) => n.id);
  const echoesAt = order.findIndex((x) => {
    const n = next.nodes.find((m) => m.id === x);
    return n?.fixed_position === 'last';
  });
  next.issue.output_order =
    echoesAt < 0 ? [...order, id] : [...order.slice(0, echoesAt), id, ...order.slice(echoesAt)];
  return next;
}

/** A headless Markdown block belonging to no section. */
export function addMarkdownBlock(doc: IssueDoc, atNodeId?: string): IssueDoc {
  const stamp = Date.now().toString(36);
  const itemId = `md-${stamp}`;
  let next = structuredClone(doc);
  next.items[itemId] = {
    type: 'markdown',
    authorship: 'Jamie',
    source: 'direct',
    channels: allChannels(),
    body: '',
  };
  next = addSection(next, { id: `mdblock-${stamp}`, type: 'mdblock', label: 'Markdown block' });
  const created = next.nodes.find((n) => n.id === `mdblock-${stamp}`);
  if (created) {
    // Its own kind, not 'section': the outline and collapse badges key on it.
    created.kind = 'mdblock';
    created.items = [itemId];
  }
  if (atNodeId) next.issue.output_order = insertBefore(next, `mdblock-${stamp}`, atNodeId);
  return next;
}

/**
 * Add one item to an existing node — a Currently entry, or a link written by
 * hand. A written link is still a pinboard_link by type (the renderers and
 * readiness know that shape) but its source is direct: authored here, no
 * write-back, provenance honest.
 */
export function addItem(doc: IssueDoc, nodeId: string, type: ItemType): IssueDoc {
  const next = structuredClone(doc);
  const target = next.nodes.find((n) => n.id === nodeId);
  if (!target) return next;

  const itemId = `${type === 'pinboard_link' ? 'link' : type}-${Date.now().toString(36)}`;
  const item: Item = type === 'currently'
    ? { ...seedItem('currently'), label: 'Also' }
    : type === 'pinboard_link'
      ? {
          type: 'pinboard_link',
          authorship: 'Jamie',
          source: 'direct',
          channels: allChannels(),
          title: '',
          commentary: '',
          sync_state: 'local',
        }
      : seedItem(type);

  next.items[itemId] = item;
  target.items.push(itemId);
  return next;
}

/**
 * Append the echoes Jamie ticked to the Echoes section, each as its own
 * `echo` item — the thread, its citations, its question. Appending is the
 * point: the wand can run again and add to what is there, and each echo can
 * then be reordered, removed, or redrafted on its own. The pick is the
 * review, so the items arrive reviewed (docs/decisions.md, Picking is the
 * review). Returns the ids it created, in order.
 */
export function addEchoes(
  doc: IssueDoc, nodeId: string, echoes: EchoOption[],
): { doc: IssueDoc; ids: string[] } {
  const next = structuredClone(doc);
  const target = next.nodes.find((n) => n.id === nodeId);
  if (!target) return { doc: next, ids: [] };

  const stamp = Date.now().toString(36);
  const ids: string[] = [];
  // Two runs inside one millisecond share a stamp; the ordinal keeps counting.
  let n = 0;
  for (const echo of echoes) {
    const body = String(echo.text ?? '').trim();
    if (!body) continue;
    let itemId: string;
    do itemId = `echo-${stamp}-${++n}`; while (next.items[itemId]);
    const item = seedItem('echo', {
      body,
      ask: String(echo.ask ?? '').trim() || undefined,
      archive_references: (echo.archive_references ?? []).filter((r) => r && r.url),
    });
    item.status = 'reviewed';
    item.reviewed = true;
    next.items[itemId] = item;
    target.items.push(itemId);
    ids.push(itemId);
  }
  return { doc: next, ids };
}

export function renameSection(doc: IssueDoc, nodeId: string, label: string): IssueDoc {
  const next = structuredClone(doc);
  const target = next.nodes.find((n) => n.id === nodeId);
  if (target) target.label = label;
  return next;
}

export function setPublicationDate(doc: IssueDoc, date: string): IssueDoc {
  const next = structuredClone(doc);
  next.issue.publication_date = issueSaturday(date);
  return next;
}

export function setWindowDays(doc: IssueDoc, days: number): IssueDoc {
  const next = structuredClone(doc);
  next.issue.window_days = Math.max(1, Math.min(60, Math.round(days)));
  return next;
}

export function setIssueNumber(doc: IssueDoc, number: number): IssueDoc {
  const next = structuredClone(doc);
  next.issue.number = Math.max(1, Math.round(number));
  return next;
}

// ── readiness ─────────────────────────────────────────────────────────────

/** What kind of outstanding thing this is — the popover colours by it. */
export type ReadinessKind = 'required' | 'commentary' | 'sync' | 'thingy';

export type ReadinessState = 'done' | 'partial' | 'todo';

export interface ReadinessUnit {
  /** `state === 'done'`, kept for every reader that only asks that. */
  done: boolean;
  /**
   * Three states, not two: a one-sentence intro is not "written", it is
   * started. The strip reads "how close am I" only if a stub does not count
   * as finished (Jamie, 2026-09-20).
   */
  state: ReadinessState;
  title: string;
  anchor: string;
  kind: ReadinessKind;
  /** One line saying what finishing this means. */
  context?: string;
}

/**
 * How much prose makes a section finished rather than started. Calibrated
 * to the issues Jamie actually sends: intros run several paragraphs, the
 * outro a short one, a Notable link's commentary a paragraph, a Briefly
 * link's a line. A stub under the bar reads as in progress.
 */
export const DONE_WORDS = { intro: 50, outro: 20, notable: 20 } as const;

/** A chip's name: the thing itself, short, with Markdown and images stripped. */
export function chipName(item: Item, max = 40): string {
  const raw = item.title ?? item.label ?? String(item.commentary ?? item.body ?? '');
  const text = raw
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '(untitled)';
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const words = (text: string | undefined) => bodyLines(text).join(' ').split(/\s+/).filter(Boolean).length;
const byWords = (text: string | undefined, bar: number): ReadinessState =>
  words(text) >= bar ? 'done' : words(text) > 0 ? 'partial' : 'todo';

export interface Readiness {
  units: ReadinessUnit[];
  /** Started but under the bar — the "in progress" count. */
  partial: number;
  done: number;
  total: number;
  pct: number;
}

/**
 * Bring an older document up to the current skeleton.
 *
 * Photo gained a seeded item once the drop zone needed something to render
 * into. Issues created before that have a Photo section with no items, which
 * renders as nothing at all — the section looks present in the outline and is
 * missing from the page. Returns null when there was nothing to repair, so the
 * caller only writes when it matters.
 */
export function normalizeSkeleton(doc: IssueDoc): IssueDoc | null {
  let next: IssueDoc | null = null;
  const touch = () => (next ??= structuredClone(doc));

  const photo = doc.nodes.find((n) => n.type === 'photo' && n.kind === 'section');
  if (photo && photo.items.length === 0) {
    const n = touch();
    const target = n.nodes.find((x) => x.id === photo.id)!;
    const itemId = `${photo.id}-1`;
    n.items[itemId] = seedItem('photo');
    target.items = [itemId];
  }

  // Echoes was locked out of audio until Thingy had a voice (2026-09-20).
  // Drafts seeded before then carry the lock; lift it and let it speak.
  for (const [id, item] of Object.entries(doc.items)) {
    if (item.type !== 'echoes' || !item.channel_locks?.audio) continue;
    const n = touch();
    const it = n.items[id]!;
    delete it.channel_locks!.audio;
    if (!Object.keys(it.channel_locks!).length) delete it.channel_locks;
    it.channels = { ...it.channels, audio: true };
  }

  // Echoes became a section of `echo` items (2026-09-20). A draft seeded
  // before then carries one empty single-body `echoes` item; drop it so the
  // section is the empty multi-item section the wand appends to. A body
  // that has words is left exactly as it is — WT350 and earlier keep
  // rendering from their one body, and a draft with a picked body keeps it.
  if (doc.issue.status === 'draft') {
    for (const [id, item] of Object.entries(doc.items)) {
      if (item.type !== 'echoes' || bodyLines(item.body).length) continue;
      const n = touch();
      delete n.items[id];
      for (const nd of n.nodes) nd.items = nd.items.filter((x) => x !== id);
    }
  }
  return next;
}

/**
 * The ready checklist. Derived from the document rather than stored, so it can
 * never disagree with what is actually in the issue.
 */
export function readiness(doc: IssueDoc): Readiness {
  const units: ReadinessUnit[] = [];
  const add = (
    state: ReadinessState | boolean, title: string, anchor = 'issue',
    kind: ReadinessKind = 'required', context?: string,
  ) => {
    const st: ReadinessState = typeof state === 'boolean' ? (state ? 'done' : 'todo') : state;
    units.push({ done: st === 'done', state: st, title, anchor, kind, context });
  };

  const w = windowOf(doc);
  const inIssue = (item: Item) =>
    !outOfWindow(item, w) && (['website', 'email', 'audio'] as Channel[]).some((c) => item.channels[c]);

  // The issue's own words come first: it cannot send as "The Weekly Thing N".
  const title = String(doc.issue.title ?? '').trim();
  const dek = String(doc.issue.dek ?? '').trim();
  const titled = Boolean(title) && title !== `The Weekly Thing ${doc.issue.number}`;
  add(titled && dek ? 'done' : titled || dek ? 'partial' : 'todo',
    'Title', 'issue', 'required', 'A title that is the theme, and a one-line dek.');

  // Units come out in the order the issue reads, section by section, so the
  // strip's ticks are a map of the page: the third tick is the third thing.
  // Held-out items (orphans) and fallen-out items owe nothing.
  for (const node of orderedNodes(doc)) {
    if (node.kind === 'section' && (node.type === 'intro' || node.type === 'outro')) {
      const body = node.items.map((id) => doc.items[id]?.body ?? '').join('\n');
      const bar = DONE_WORDS[node.type];
      add(byWords(body, bar), node.type === 'intro' ? 'Intro' : 'Outro',
        node.items[0] ?? node.id, 'required',
        `A sentence is a start; ${node.type === 'intro' ? 'the intro is a few paragraphs' : 'the outro is a short one'} (${bar}+ words).`);
      continue;
    }
    if (node.kind === 'section' && node.type === 'echoes') {
      const echoes = node.items.map((id) => doc.items[id]).filter((i): i is Item => Boolean(i && inIssue(i)));
      // One chip per echo, named for its thread (Jamie, 2026-09-20). An echo
      // exists because it was picked, so its chip is its place on the map —
      // unless its words were taken out. The empty section owes its wand.
      if (!echoes.length) {
        add(false, 'Echoes', node.id, 'thingy', 'Use the wand on the heading to draft echoes, or remove the section.');
        continue;
      }
      for (const id of node.items) {
        const item = doc.items[id];
        if (!item || !inIssue(item)) continue;
        add(bodyLines(item.body).length > 0, item.type === 'echo' ? chipName(item) : 'Echoes', id, 'thingy',
          item.type === 'echo' ? 'Echo — the thread, its citations, and a question for Thingy.' : 'Use the wand in the margin, or write it yourself.');
      }
      continue;
    }
    if (node.kind === 'section' && node.type === 'photo') {
      const item = node.items.map((id) => doc.items[id]).find(Boolean);
      const m = item?.media;
      // The upload seeds alt from the filename; "IMG 6232" is not alt text.
      const altWritten = Boolean(m?.alt) && !/^(img|dsc|dscf|pxl|photo|image)[ _-]?\d+$/i.test(String(m?.alt).trim());
      add(!m?.url ? 'todo' : altWritten && m.caption ? 'done' : 'partial', 'Photo',
        node.items[0] ?? node.id, 'required', 'A photo, alt text in words (not the filename), and a caption — or remove the section.');
      continue;
    }

    for (const id of node.items) {
      const item = doc.items[id];
      if (!item || !inIssue(item)) continue;

      // Chips are named for the thing, not the task: "Unread 5.0", not
      // "Commentary for Unread 5.0". The task is the context line (2026-09-20).
      if (item.type === 'currently') {
        // One tick per line: "Currently filled in" hid which line was empty.
        add(bodyLines(item.body).length > 0, chipName(item), id, 'required',
          'Currently — write the line, or remove the entry.');
      } else if (item.type === 'pinboard_link') {
        const briefly = String(node.label).toLowerCase() === 'briefly';
        add(briefly ? (String(item.commentary ?? '').trim() ? 'done' : 'todo') : byWords(item.commentary, DONE_WORDS.notable),
          chipName(item), id, 'commentary',
          briefly ? 'Briefly — a line of commentary is enough.' : `Notable — a paragraph of commentary (${DONE_WORDS.notable}+ words).`);
        if (item.sync_state === 'failed') {
          add(false, `${chipName(item)} — Pinboard write failed`, id, 'sync',
            item.sync_error ?? 'Your edit is kept. Retry from the inspector.');
        }
      } else if (item.type === 'journal_post') {
        // A post is finished when it was published; the chip is its place on
        // the map. A promoted post is its own section and gets one too.
        add(true, chipName(item), id, 'required', node.kind === 'promoted_item' ? 'Promoted post.' : 'Journal.');
      } else if (item.authorship === 'Thingy') {
        // Picking or writing it is the review; there is no second gate.
        const name = item.type === 'membership' ? 'Membership' : 'Echoes';
        add(bodyLines(item.body).length > 0, name, id, 'thingy',
          'Use the wand in the margin, or write it yourself.');
      } else if (node.type === 'haiku') {
        const lines = bodyLines(item.body).length;
        add(lines >= 3 ? 'done' : lines > 0 ? 'partial' : 'todo', 'Haiku', id, 'required', 'Three lines.');
      }
    }
  }

  // A standard section that is not in the issue is satisfied, not outstanding.
  for (const [type, label] of [
    ['intro', 'Intro'],
    ['outro', 'Outro'],
    ['currently', 'Currently'],
    ['photo', 'Photo'],
  ] as const) {
    if (!doc.nodes.some((n) => n.type === type && n.kind === 'section')) {
      add(true, `${label} — not in this issue`, 'issue', 'required');
    }
  }

  const done = units.filter((u) => u.done).length;
  return {
    units,
    done,
    partial: units.filter((u) => u.state === 'partial').length,
    total: units.length,
    pct: units.length ? Math.round((done / units.length) * 100) : 100,
  };
}

export { issueWindow, addDays };
