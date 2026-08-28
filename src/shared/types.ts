/**
 * The canonical issue document.
 *
 * One JSON document per issue (AGENTS.md, Stack). `schema_version` carries
 * migrations; everything else here is the contract in `docs/item-model.md`.
 */

export const SCHEMA_VERSION = 2;

export type Channel = 'website' | 'email' | 'audio';
export const CHANNELS: readonly Channel[] = ['website', 'email', 'audio'] as const;

/** Which editions an item appears in. There is no `included` boolean (0015). */
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
  | 'echoes'
  | 'haiku';

/** Pinboard write-back state. Never discards the local edit on a failed write. */
export type SyncState = 'synced' | 'syncing' | 'failed' | 'needs_commentary' | 'local';

export interface Media {
  url?: string;
  alt?: string;
  caption?: string;
  /** ISO 8601 with offset. Rendered in the photo's own local time. */
  timestamp?: string;
  location?: string;
}

export interface ArchiveReference {
  issue: number;
  url: string;
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

  presentation?: 'journal' | 'promoted';
  published_at?: string;
  media?: Media;
  sync_state?: SyncState;
  attribution?: string;
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

export interface SendState {
  status: 'none' | 'sending' | 'sent' | 'failed';
  at?: string;
  /** Buttondown draft id, archive commit sha, etc. */
  external_id?: string;
  url?: string;
  error?: string;
}

export type Destination = 'buttondown' | 'website' | 'podcast' | 'archive';

export interface IssueMeta {
  id: string;
  number: number;
  title: string;
  dek?: string;
  status: IssueStatus;
  /** A Saturday. */
  publication_date: string;
  /** How far back the sweep reaches from the Thursday the window closes on. */
  window_days: number;
  editor?: string;
  output_order?: string[];
}

export interface IssueDoc {
  schema_version: number;
  issue: IssueMeta;
  nodes: IssueNode[];
  items: Record<string, Item>;
  /** Items swept in but not placed in a node. */
  orphans?: string[];
  sends?: Partial<Record<Destination, SendState>>;
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
