/**
 * The canonical issue document.
 *
 * One JSON document per issue (AGENTS.md, Stack). `schema_version` carries
 * migrations; everything else here is the contract in `docs/item-model.md`.
 */

export const SCHEMA_VERSION = 2;

export type Channel = 'website' | 'email' | 'audio';
export const CHANNELS: readonly Channel[] = ['website', 'email', 'audio'] as const;

/** Which editions an item appears in. There is no `included` boolean. */
export type Channels = Record<Channel, boolean>;

/**
 * Where a rendering contract forbids a channel, it is locked false and the
 * reason is shown in the UI rather than silently ignored.
 */
export type ChannelLocks = Partial<Record<Channel, string>>;

export type Authorship = 'Jamie' | 'syndicated' | 'Thingy';
export type SourceKind = 'direct' | 'Pinboard' | 'Micro.blog' | 'Thingy' | 'generated';

export type ItemType =
  | 'intro'
  | 'outro'
  | 'quote'
  | 'currently'
  | 'photo'
  | 'markdown'
  | 'pinboard_link'
  | 'journal_post'
  | 'membership'
  /**
   * One echo: a thread from this issue back through the archive, its
   * citations, and a question for Thingy. The Echoes section is items of
   * this type, like Currently is lines (Jamie, 2026-09-20).
   */
  | 'echo'
  /**
   * The Echoes section as one body — the shape WT350 and earlier carry.
   * Still rendered; never seeded again. New issues get `echo` items.
   */
  | 'echoes'
  | 'haiku';

/**
 * The items the wand can draft for. The server has a prompt (or a vision
 * pass, for photo and journal alts) for exactly these; the canvas shows the
 * wand only on them. Intro, Outro, and Currently are Jamie's own and have
 * never had one — a wand on them could only fail (WT351).
 */
export const DRAFTABLE: ReadonlySet<ItemType> = new Set<ItemType>([
  'pinboard_link', 'journal_post', 'photo', 'membership', 'haiku', 'echo',
]);

/** Pinboard write-back state. Never discards the local edit on a failed write. */
export type SyncState =
  | 'synced'
  | 'syncing'
  | 'failed'
  | 'needs_commentary'
  | 'local'
  /** The source record was deleted after the sweep; the local copy is kept. */
  | 'gone'
  /** Edited both here and at the source since the sweep; the local copy is kept. */
  | 'conflict';

export interface Media {
  url?: string;
  alt?: string;
  caption?: string;
  /** ISO 8601 with offset. Rendered in the photo's own local time. */
  timestamp?: string;
  /** The place as a reader should see it — "Falcon Heights, MN". Editable. */
  location?: string;
  /**
   * The EXIF "lat, lon", kept beside the human name so the published
   * metadata line can link to the exact spot on the map.
   */
  coordinates?: string;
}

/**
 * A source Echoes cited. Weekly Thing issues carry a number; blog posts and
 * podcast episodes carry a title instead. Records from before the widening
 * (2026-09) have neither `kind` nor `title` and read as issues.
 */
export interface ArchiveReference {
  kind?: 'issue' | 'blog' | 'podcast';
  issue?: number;
  url: string;
  title?: string;
  note?: string;
}

export interface Item {
  type: ItemType;
  authorship: Authorship;
  source: SourceKind;
  channels: Channels;
  channel_locks?: ChannelLocks;

  source_id?: string;
  source_url?: string;
  /** What was imported. Editable fields hold the working value. */
  source_snapshot?: Record<string, unknown>;

  title?: string;
  body?: string;
  commentary?: string;
  /** Currently entries carry a label ("Building", "Listening"). */
  label?: string;
  /** The section a Pinboard link was captured for. Placement in the issue wins. */
  section?: string;
  tags?: string[];

  /**
   * Membership only: what an existing Supporting Member sees in the email
   * INSTEAD of the call to action (the Liquid premium branch). Drafted with
   * the CTA as one candidate pair; empty falls back to the static
   * MEMBER_THANKS line appended to the body.
   */
  member_thanks?: string;

  presentation?: 'journal' | 'promoted';
  /**
   * Fields the source owns that write-back must hand back untouched. Pinboard's
   * add endpoint replaces the whole record, so anything not sent is reset to
   * its default — which would silently publish a private bookmark.
   */
  source_flags?: Record<string, string>;
  /**
   * Held out of the issue by Jamie, and the bookmark carries `_exclude` to
   * say so. Cleared when the tag comes off at Pinboard and the link returns.
   */
  excluded?: boolean;
  published_at?: string;
  media?: Media;
  sync_state?: SyncState;
  /** Last write-back error, kept beside the local edit until a retry succeeds. */
  sync_error?: string;
  attribution?: string;
  /**
   * Echo only: the question a curious reader could put to Thingy to go
   * deeper on this thread. Printed after the thread as a link that opens
   * Thingy with it already asked; the renderers build the link.
   */
  ask?: string;
  status?: 'draft' | 'reviewed';
  reviewed?: boolean;
  archive_references?: ArchiveReference[];
  rendering_overrides?: Record<string, unknown>;
}

export type NodeKind = 'section' | 'promoted_item' | 'ad_hoc' | 'mdblock';

export interface IssueNode {
  id: string;
  kind: NodeKind;
  type: ItemType | 'notable' | 'briefly' | 'journal' | 'mdblock' | 'ad_hoc';
  label: string;
  movable: boolean;
  /**
   * Some sections publish their name as a heading and some do not. Photo,
   * Haiku, and Membership carry themselves; printing the label would be an
   * editorial artifact. The builder still shows the name in the gutter.
   */
  publishes_heading: boolean;
  fixed_position?: 'last';
  required?: boolean;
  items: string[];
}

export type IssueStatus = 'draft' | 'published';

/**
 * One echo as the wand offers it: a self-contained sentence or two with its
 * own citations and its question. Each one Jamie ticks becomes an `echo`
 * item, so the section's length follows quality.
 */
export interface EchoOption {
  text: string;
  archive_references: ArchiveReference[];
  /**
   * A question a curious reader could put to Thingy to go deeper on this
   * thread. Rendered as a link that opens Thingy with the question already
   * asked (thingy.thingelstad.com/chat/?prompt=…), 2026-09-20.
   */
  ask?: string;
}

/** A shared draft preview: where it lives and what Jamie said with it. */
export interface DraftShare {
  token: string;
  url: string;
  /** Jamie's note to the person the draft was shared with. */
  note?: string;
  /** When the page was last rendered and uploaded. */
  at: string;
}

export interface SendState {
  status: 'none' | 'sending' | 'sent' | 'failed';
  at?: string;
  /** Buttondown draft id, archive commit sha, etc. */
  external_id?: string;
  url?: string;
  /** Where to open it to act on it, when that differs from `url` (Buttondown's editor). */
  edit_url?: string;
  error?: string;
}

export type Destination = 'buttondown' | 'website' | 'podcast' | 'archive';

export interface IssueMeta {
  id: string;
  number: number;
  title: string;
  dek?: string;
  status: IssueStatus;
  /** Always the Saturday — the issue's identity, no matter when it sends. */
  publication_date: string;
  /** How far back the sweep reaches from the Friday 00:00 CT close. */
  window_days: number;
  editor?: string;
  output_order?: string[];
  /**
   * A pre-Builder issue, imported as a record: one Markdown block holding the
   * published text, read-only by way of its published status. Never parsed
   * into items (docs/decisions.md).
   */
  imported?: boolean;
  /** Where the published issue lives, for imported records. */
  archive_url?: string;
}

export interface IssueDoc {
  schema_version: number;
  issue: IssueMeta;
  nodes: IssueNode[];
  /**
   * Removed nodes are retained intact so every structural removal has a
   * deterministic Put back path (docs/decisions.md). They are not part of any edition.
   */
  held_nodes?: IssueNode[];
  items: Record<string, Item>;
  /**
   * Locally-authored items deleted by section removal, kept beside their held
   * node so Put back is still deterministic (docs/decisions.md). They are not in `items`,
   * so nothing renders them and no edition can reach them.
   */
  held_items?: Record<string, Item>;
  /** Items swept in but not placed in a node. */
  orphans?: string[];
  /**
   * Source image URL → the CDN copy. Applied when an edition renders, never
   * written into an item: a Journal post's body is the mirror of the blog
   * post, and a write-back must hand the blog its own image URLs, not ours
   * (2026-09-20). The site and the email never hotlink.
   */
  image_map?: Record<string, string>;
  sends?: Partial<Record<Destination, SendState>>;
  /**
   * The live draft-preview share, when one exists: a static page at an
   * unguessable CDN URL, loudly labeled DRAFT. Re-sharing refreshes the same
   * URL; unsharing deletes the page (docs/integrations.md).
   */
  draft_share?: DraftShare;
  /**
   * The most recent editorial review. Each review replaces the last, so notes
   * are never merged or aged; a failed review leaves this untouched.
   */
  review?: unknown;
}

/** A candidate returned by a sweep, before it becomes an item. */
export interface Candidate {
  id: string;
  origin: 'Pinboard' | 'Micro.blog';
  title?: string;
  url: string;
  body?: string;
  commentary?: string;
  tags?: string[];
  published_at?: string;
  /** Micro.blog posts with a title are promotion candidates. */
  titled?: boolean;
  /** Source-owned fields carried through so write-back preserves them. */
  flags?: Record<string, string>;
}

export function emptyChannels(): Channels {
  return { website: false, email: false, audio: false };
}

export function allChannels(): Channels {
  return { website: true, email: true, audio: true };
}

/** An item is in the issue when at least one channel is true. */
export function isPresent(item: Item): boolean {
  return CHANNELS.some((c) => item.channels[c]);
}

export function inChannel(item: Item, channel: Channel): boolean {
  return item.channels[channel] === true;
}
