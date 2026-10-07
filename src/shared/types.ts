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
  /**
   * The link as the issue prints it, when Jamie applied the link check's
   * suggestion (a shortener resolved, a redirect followed, the page's own
   * canonical, tracking dropped). `source_url` stays the Pinboard key, so
   * write-back and reconcile still find the bookmark; only "Move bookmark"
   * changes both, together (src/server/link-check.ts).
   */
  canonical_url?: string;
  /**
   * Pinboard link: Jamie has edited the title here. The page's own title
   * otherwise prints as fetched, and the row hints when it still ends with
   * the site's name (src/shared/hints.ts); once he has edited it, what is
   * left is his choice. The snapshot cannot say so: a write-back refreshes it.
   */
  title_edited?: boolean;
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
  /**
   * Swept in while the section it belongs in was removed, so held out for
   * want of a place rather than by Jamie. Restoring that section brings it
   * in; nothing else does, so an item X'd out stays out.
   */
  awaits_section?: boolean;
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
  /**
   * What the server found when it checked this echo's citations against
   * the passages it retrieved: one readable flag per citation that does not
   * trace back. Shown in the picker, never stored, never a reason to drop
   * the echo (generation offers; review 2026-09-27, §5).
   */
  grounding?: EchoGrounding;
}

/**
 * An earlier issue that carried the link the wand is drafting for: the link
 * wand's "Linked before in WT274 (2024-01-27)" (src/server/linked-before.ts).
 */
export interface LinkedBefore {
  number: number;
  publication_date: string;
}

export interface EchoGrounding {
  /** Empty when every citation traced to a retrieved passage. */
  flags: string[];
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

/**
 * Sharing a published issue (docs/share-plan.md): LinkedIn, which Jamie
 * posts himself from text WT Builder holds, or a blog post WT Builder makes
 * on micro.blog. Not the draft share above, which is a page of an unsent
 * draft; this is announcing an issue that went out.
 */
export type ShareDestination = 'linkedin' | 'blog';

/**
 * One share: a task with one destination. Kept in its own table, never in
 * the issue document, because put to bed freezes the document and sharing
 * is what happens after it (docs/decisions.md, 2026-10-06).
 */
export interface Share {
  id: number;
  issue_id: string;
  destination: ShareDestination;
  /** draft: still being written. shared: done, and the row is the record. */
  state: 'draft' | 'shared';
  /** The blog post's title, when it has one. LinkedIn posts have none. */
  title?: string;
  /** The words, the issue's link among them. */
  text: string;
  created_at: string;
  updated_at: string;
  shared_at?: string;
  /** Where it landed: the LinkedIn post Jamie pasted back, or the blog post's URL. */
  url?: string;
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
  /** The podcast leg's audio record: the fields the website page embeds. */
  audio?: Record<string, unknown>;
  /**
   * The leg's last successful send, carried through `sending` and `failed`
   * (`recordSend` does it, for every leg). A failed podcast re-render once
   * erased the episode's audio record, and a `sending` Buttondown leg lost
   * its draft id, so a retry created a second draft (review 2026-09-27
   * §2.1). Absent on a `sent` state, which is its own last good send; read
   * it through `lastSent` in src/shared/sends.ts.
   */
  last_sent?: SentRecord;
}

/** A leg as it stood when it last went out. */
export type SentRecord = Omit<SendState, 'last_sent' | 'error'> & { status: 'sent' };

export type Destination = 'buttondown' | 'website' | 'podcast' | 'archive';

/**
 * One thing checked about a leg after it went out, read off the real
 * destination — the CDN, the live page and feed, the Buttondown draft, the
 * audio as whisper hears it. `ok` null is a warning: worth a look, not wrong.
 */
export interface VerifyCheck {
  label: string;
  ok: boolean | null;
  detail: string;
  /** The specifics behind a warning or failure — suspect cues, missing files. */
  items?: string[];
}

/**
 * The audio script read by a model before synthesis, in place of Jamie
 * reading it (he will not, and should not have to — WT351). Tied to the
 * script it read: a change to the script after review asks for another.
 */
export interface ScriptReview {
  at: string;
  /** sha256 of the spoken text the review read. */
  script_hash: string;
  verdict: 'ready' | 'look';
  summary: string;
  /**
   * The mechanical lint's findings (`mechanical`), then the model's
   * (src/shared/render/script-lint.ts). `anchor` and `where` name the item or
   * section the block speaks, when it speaks one.
   */
  findings: { block: number; quote: string; problem: string; suggestion?: string; mechanical?: boolean; anchor?: string; where?: string }[];
  /** Jamie's go-ahead, for this script. */
  approved_at?: string;
}

/** A leg's verification, re-run on demand; the latest replaces the last. */
export interface Verification {
  /**
   * `waiting`: nothing wrong, something not done yet (scheduled, not
   * indexed). With `recheck_at` it re-checks itself, after a restart too.
   * Without it (`refusedNotDraft`, the record a refused Buttondown re-send
   * leaves) the check started beside it replaces it, and if that check is
   * lost nothing reschedules it: "Check again" on the card recovers it.
   */
  status: 'running' | 'passed' | 'waiting' | 'warnings' | 'problems' | 'error';
  at: string;
  checks: VerifyCheck[];
  error?: string;
  /** When the server will look again on its own, while the leg is still landing. */
  recheck_at?: string;
  /**
   * What the destination said the thing is, when it says: Buttondown's email
   * status (`draft`, `scheduled`, `sent`, …). The Send view reads it to drop
   * the Buttondown action once the email is not a draft: only a draft is
   * edited (Jamie, 2026-09-29).
   */
  remote_status?: string;
  /**
   * Counts the destination reported, kept so the next issue can compare:
   * Buttondown's recipients, complaints and unsubscriptions. Issue-level
   * counts only, never per reader.
   */
  metrics?: Record<string, number>;
}

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
   * published text, read-only in the client (Page.tsx isFrozen) — publishing
   * alone no longer freezes an issue. Never parsed into items
   * (docs/decisions.md).
   */
  imported?: boolean;
  /** Where the published issue lives, for imported records. */
  archive_url?: string;
  /**
   * Put to bed: Jamie's own last act on a sent issue (WT351). While set, the
   * server refuses every change — edits, sends, re-scans — until he wakes it.
   * Verification still runs; it only reads.
   */
  put_to_bed_at?: string;
}

/** What one fetch of one link found. */
export interface LinkResult {
  /**
   * ok: it answered 200 where it says. moved: it answered, from somewhere
   * else (a redirect, a shortener, the page's own canonical, or tracking to
   * drop) and `suggestion` says where. dead: 404, 410, no such host, or a
   * redirect to the site's front page. unchecked: the site would not say
   * (403, 429, 5xx, a timeout) - never read as dead.
   */
  verdict: 'ok' | 'moved' | 'dead' | 'unchecked';
  status?: number;
  final_url?: string;
  /** The page's `<link rel=canonical>`, when it names another page. */
  canonical_hint?: string;
  suggestion?: string;
  /**
   * Whether the https:// address of this page answers (2026-10-04). `fails`
   * on an https link whose certificate or port fails while http works (the
   * suggestion is then the http link: bowlingalone.com's certificate is
   * self-signed), and on an http link whose https address fails, so the
   * email's plain-http warning stays quiet there. `works` on an http link
   * whose https address answers. Absent when nobody asked.
   */
  https?: 'works' | 'fails';
  note?: string;
  checked_at: string;
}

export interface LinkCheck {
  at: string;
  results: Record<string, LinkResult>;
  /**
   * Findings Jamie keeps as they are: dead links sent anyway (`?force=1`) or
   * dismissed with "Keep this link". Neither readiness nor the send asks again.
   */
  accepted?: string[];
}

/**
 * One domain the email prints, as the spam blocklists answered for it
 * (src/server/domain-check.ts). listed: a list named it. clean: every list
 * that answered said nothing. unchecked: no list could be asked — the
 * list's own test domain did not answer as it should, or the lookup failed —
 * never read as clean.
 */
export interface DomainResult {
  verdict: 'clean' | 'listed' | 'unchecked';
  /** What each list said, for a listed domain: "Spamhaus DBL: phishing". */
  lists?: string[];
  /** The lists that answered, so a clean verdict says who it is from. */
  asked?: string[];
  note?: string;
  checked_at: string;
}

export interface DomainCheck {
  at: string;
  results: Record<string, DomainResult>;
  /** Listed domains Jamie sent anyway (`?force=1`); the email does not ask again. */
  accepted?: string[];
}

/** The email's own deliverability findings Jamie has kept as they are, by key. */
export interface DeliverabilityKept {
  kept: string[];
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
  /** The model's read of the audio script, and Jamie's approval of it. */
  script_review?: ScriptReview;
  /** What was checked at each destination after its leg went out. */
  verify?: Partial<Record<Destination, Verification>>;
  /** The issue's links as last fetched, by exact URL (src/server/link-check.ts). */
  link_check?: LinkCheck;
  /** Every domain the email prints, against the spam blocklists (src/server/domain-check.ts). */
  domain_check?: DomainCheck;
  /** Deliverability findings in the email itself that Jamie keeps (src/shared/deliverability.ts). */
  deliverability?: DeliverabilityKept;
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
