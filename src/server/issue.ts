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
  IssueDoc,
  IssueNode,
  Item,
  ItemType,
} from '../shared/types.ts';
import { SCHEMA_VERSION, allChannels, emptyChannels } from '../shared/types.ts';
import { addDays, issueWindow, issueSaturday } from '../shared/dates.ts';
import { bodyLines, orderedNodes } from '../shared/render/plan.ts';
import * as pinboard from './integrations/pinboard.ts';
import * as microblog from './integrations/microblog.ts';

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
  const thingy = type === 'membership' || type === 'echoes';
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
  if (type === 'echoes') {
    base.channels = { website: true, email: true, audio: false };
    base.channel_locks = { audio: 'Echoes is never spoken.' };
  }
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
    const seeded: ItemType[] = [
      'intro', 'currently', 'photo', 'membership', 'outro', 'haiku', 'echoes',
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
  window: { from: string; to: string };
  candidates: Candidate[];
}

/**
 * Sweep both sources for the issue's window and place what is new. Items
 * already present (by source_id) are left alone so a re-sweep is safe.
 */
export async function sweep(doc: IssueDoc): Promise<{ doc: IssueDoc; report: SweepReport }> {
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

  const next = structuredClone(doc);
  const known = new Set(
    Object.values(next.items).map((i) => i.source_id).filter(Boolean) as string[],
  );

  let added = 0;
  let skipped = 0;

  for (const c of links) {
    if (known.has(c.id)) { skipped++; continue; }
    const item = pinboard.candidateToItem(c);
    const id = idFor(next, c);
    next.items[id] = item;
    placeInto(next, id, item.section ?? 'Briefly');
    added++;
  }

  for (const c of posts) {
    if (known.has(c.id)) { skipped++; continue; }
    const item = microblog.candidateToItem(c);
    const id = idFor(next, c);
    next.items[id] = item;
    placeInto(next, id, 'Journal');
    added++;
  }

  sortJournal(next);
  return { doc: next, report: { added, skipped, window, candidates: [...links, ...posts] } };
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
  journal.items.sort((a, b) => {
    const x = doc.items[a]?.published_at ?? '';
    const y = doc.items[b]?.published_at ?? '';
    return x.localeCompare(y);
  });
}

// ── mutations ─────────────────────────────────────────────────────────────

export function updateItem(doc: IssueDoc, itemId: string, patch: Partial<Item>): IssueDoc {
  const next = structuredClone(doc);
  const item = next.items[itemId];
  if (!item) return next;
  const bodyChanged = patch.body !== undefined && patch.body !== item.body;
  Object.assign(item, patch);

  const sourceFieldChanged =
    (item.source === 'Pinboard' && ['title', 'commentary', 'tags'].some((key) => key in patch)) ||
    (item.source === 'Micro.blog' && ['title', 'body'].some((key) => key in patch));
  if (sourceFieldChanged) {
    item.sync_state = 'syncing';
    delete item.sync_error;
  }

  // A Thingy draft must be reviewed again after its words change.
  if (item.authorship === 'Thingy' && bodyChanged) {
    item.reviewed = false;
    item.status = 'draft';
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

export interface ReadinessUnit {
  done: boolean;
  title: string;
  anchor: string;
  kind: ReadinessKind;
  /** One line saying what finishing this means. */
  context?: string;
}

export interface Readiness {
  units: ReadinessUnit[];
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
  const photo = doc.nodes.find((n) => n.type === 'photo' && n.kind === 'section');
  if (!photo || photo.items.length > 0) return null;

  const next = structuredClone(doc);
  const target = next.nodes.find((n) => n.id === photo.id)!;
  const itemId = `${photo.id}-1`;
  next.items[itemId] = seedItem('photo');
  target.items = [itemId];
  return next;
}

/**
 * The ready checklist. Derived from the document rather than stored, so it can
 * never disagree with what is actually in the issue.
 */
export function readiness(doc: IssueDoc): Readiness {
  const units: ReadinessUnit[] = [];
  const add = (
    done: boolean, title: string, anchor = 'issue',
    kind: ReadinessKind = 'required', context?: string,
  ) => units.push({ done, title, anchor, kind, context });

  const nodeOf = (type: string) => doc.nodes.find((n) => n.type === type);
  const present = Object.entries(doc.items).filter(([, i]) =>
    (['website', 'email', 'audio'] as Channel[]).some((c) => i.channels[c]),
  );

  for (const [type, label] of [
    ['intro', 'Intro written'],
    ['outro', 'Outro written'],
    ['currently', 'Currently filled in'],
    ['photo', 'Photo placed'],
  ] as const) {
    const nd = nodeOf(type);
    if (!nd) {
      // A section that is not in the issue is satisfied, not outstanding.
      add(true, `${label} — not in this issue`, 'issue', 'required');
      continue;
    }
    const filled = nd.items.length > 0 && nd.items.every((id) => {
      const item = doc.items[id];
      if (!item) return false;
      return item.type === 'photo'
        ? Boolean(item.media?.url)
        : bodyLines(item.body).length > 0;
    });
    add(filled, label, nd.items[0] ?? nd.id, 'required',
      type === 'photo' ? 'Drop a photo, or remove the section.' : 'Write it, or remove the section.');
  }

  for (const [id, item] of present) {
    if (item.type !== 'pinboard_link') continue;
    const title = (item.title ?? 'untitled').slice(0, 40);
    add(
      Boolean(String(item.commentary ?? '').trim()),
      `Commentary for “${title}”`, id, 'commentary',
      'A link with no commentary is just a headline.',
    );
    if (item.sync_state === 'failed') {
      add(false, `Pinboard write failed for “${title}”`, id, 'sync',
        item.sync_error ?? 'Your edit is kept. Retry from the inspector.');
    }
  }

  for (const [id, item] of present) {
    if (item.authorship !== 'Thingy') continue;
    const name = item.type === 'membership' ? 'Membership' : 'Echoes';
    add(bodyLines(item.body).length > 0, `${name} drafted by Thingy`, id, 'thingy',
      'Use the wand in the margin, or write it yourself.');
    add(Boolean(item.reviewed), `${name} reviewed by you`, id, 'thingy',
      'Thingy wrote it and it goes out under that byline.');
  }

  const haiku = nodeOf('haiku');
  if (haiku) {
    for (const id of haiku.items) {
      add(bodyLines(doc.items[id]?.body).length > 0, 'Haiku chosen', id, 'required');
    }
  }

  const done = units.filter((u) => u.done).length;
  return {
    units,
    done,
    total: units.length,
    pct: units.length ? Math.round((done / units.length) * 100) : 100,
  };
}

export { issueWindow, addDays };
